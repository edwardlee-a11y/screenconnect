import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import { supabase } from '../config/supabase';
import { redis, Keys, TTL, acquireLock, releaseLock } from '../config/redis';
import { authenticate, requireEmailVerified } from '../middleware/authenticate';
import {
  WHEEL,
  MIN_WAGER_USD,
  MAX_WAGER_USD,
  ROOM_TIERS,
  MIN_PLAYERS,
  MAX_PLAYERS,
  generateServerSeed,
  hashServerSeed,
  computeOutcome,
  calcPayout,
} from '../utils/gameLogic';

const MIN_PLAYERS_TO_PLAY = MIN_PLAYERS;

// ─── Route plugin ──────────────────────────────────────────────────────────

export async function gameRoutes(fastify: FastifyInstance): Promise<void> {

  // ── GET /api/v1/games/rooms ───────────────────────────────────────────────
  // Returns all room tiers with current player counts. No auth required.

  fastify.get('/rooms', async (_req, reply) => {
    const rooms = await Promise.all(
      ROOM_TIERS.map(async (tier) => {
        const players = await redis.smembers<string[]>(Keys.roomPlayers(tier));
        return {
          tier,
          playerCount: players.length,
          maxPlayers: MAX_PLAYERS,
          isReady: players.length >= MIN_PLAYERS_TO_PLAY,
          isFull: players.length >= MAX_PLAYERS,
        };
      }),
    );
    return reply.send({ rooms, minPlayers: MIN_PLAYERS_TO_PLAY, maxPlayers: MAX_PLAYERS });
  });

  // ── POST /api/v1/games/rooms/:tier/join ───────────────────────────────────
  // Adds authenticated user to a room. Auto-starts a session when MAX_PLAYERS reached.

  fastify.post<{ Params: { tier: string } }>(
    '/rooms/:tier/join',
    { preHandler: [authenticate, requireEmailVerified] },
    async (req: FastifyRequest<{ Params: { tier: string } }>, reply: FastifyReply) => {
      const uid  = req.user.sub;
      const tier = parseInt(req.params.tier, 10);

      if (!ROOM_TIERS.includes(tier)) {
        return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid room tier.' });
      }

      const roomKey = Keys.roomPlayers(tier);
      await redis.sadd(roomKey, uid);
      await redis.expire(roomKey, TTL.SERVER_SEED);

      const players = await redis.smembers<string[]>(roomKey);
      const playerCount = players.length;
      const isReady = playerCount >= MIN_PLAYERS_TO_PLAY;
      const isFull  = playerCount >= MAX_PLAYERS;

      // When room is full, auto-start a session and clear it for the next batch
      if (isFull) {
        const sessionId = randomUUID();
        await (supabase as any).from('game_sessions').insert({
          id: sessionId,
          status: 'active',
          room_tier: tier,
          player_ids: players,
          total_spins: 0,
          total_wagered_usd: 0,
          total_payout_usd: 0,
        });
        // Clear room so next group of players can join
        await redis.del(roomKey);

        // Broadcast session start via pub/sub
        await redis.publish(`room:${tier}:session`, JSON.stringify({ sessionId, players, tier }));

        return reply.status(201).send({
          sessionStarted: true,
          sessionId,
          playerCount,
          players,
          tier,
        });
      }

      return reply.status(200).send({
        sessionStarted: false,
        playerCount,
        maxPlayers: MAX_PLAYERS,
        isReady,
        isFull,
        tier,
      });
    },
  );

  // ── POST /api/v1/games/rooms/:tier/leave ──────────────────────────────────
  // Removes user from a room.

  fastify.post<{ Params: { tier: string } }>(
    '/rooms/:tier/leave',
    { preHandler: [authenticate] },
    async (req: FastifyRequest<{ Params: { tier: string } }>, reply: FastifyReply) => {
      const uid  = req.user.sub;
      const tier = parseInt(req.params.tier, 10);

      if (!ROOM_TIERS.includes(tier)) {
        return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid room tier.' });
      }

      await redis.srem(Keys.roomPlayers(tier), uid);
      const players = await redis.smembers<string[]>(Keys.roomPlayers(tier));

      return reply.status(200).send({ playerCount: players.length, tier });
    },
  );

  // ── GET /api/v1/games/wheel-config ────────────────────────────────────────
  // Returns the public wheel layout — no auth required.
  // Client uses this to render the wheel and show odds.

  fastify.get('/wheel-config', async (_req, reply) => {
    return reply.send({
      segments: WHEEL.map((s, i) => ({
        index: i,
        label: s.label,
        multiplier: s.multiplier,
      })),
      minWager: MIN_WAGER_USD,
      maxWager: MAX_WAGER_USD,
    });
  });

  // ── POST /api/v1/games/session/start ─────────────────────────────────────
  // Creates a new game session + pre-generates the server seed.
  // Returns the server seed HASH (not the seed itself) so client can verify later.

  fastify.post(
    '/session/start',
    { preHandler: [authenticate, requireEmailVerified] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const uid = req.user.sub;

      // Only one active session per user
      const existing = await redis.get(Keys.activeSession(uid));
      if (existing) {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'You already have an active session. End it before starting a new one.',
        });
      }

      const sessionId = randomUUID();
      const serverSeed = generateServerSeed();
      const serverSeedHash = hashServerSeed(serverSeed);

      // Persist session in Supabase
      const { error } = await supabase.from('game_sessions').insert({
        id: sessionId,
        user_id: uid,
        status: 'active',
        total_spins: 0,
        total_wagered_usd: 0,
        total_payout_usd: 0,
      });

      if (error) {
        fastify.log.error({ err: error }, 'Failed to create game session');
        return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Failed to start session.' });
      }

      // Store server seed (secret) in Redis — not in DB until revealed
      await redis.set(Keys.serverSeed(sessionId), serverSeed, { ex: TTL.SERVER_SEED });

      // Store active session reference
      await redis.set(Keys.activeSession(uid), sessionId, { ex: TTL.SERVER_SEED });

      return reply.status(201).send({
        sessionId,
        serverSeedHash, // Client saves this to verify fairness after session ends
      });
    },
  );

  // ── POST /api/v1/games/spin ───────────────────────────────────────────────
  // Core spin endpoint. Validates wager, computes outcome, updates balances.

  fastify.post<{ Body: { wagerUsd: number; clientSeed: string } }>(
    '/spin',
    {
      preHandler: [authenticate, requireEmailVerified],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['wagerUsd', 'clientSeed'],
          properties: {
            wagerUsd: { type: 'number', minimum: MIN_WAGER_USD, maximum: MAX_WAGER_USD },
            clientSeed: { type: 'string', minLength: 8, maxLength: 64 },
          },
        },
      },
    },
    async (
      req: FastifyRequest<{ Body: { wagerUsd: number; clientSeed: string } }>,
      reply: FastifyReply,
    ) => {
      const uid = req.user.sub;
      const { wagerUsd, clientSeed } = req.body;

      // 1. Acquire spin lock — prevents double-spin race condition
      const lockKey = Keys.spinLock(uid);
      const locked = await acquireLock(lockKey, 10);
      if (!locked) {
        return reply.status(429).send({
          statusCode: 429,
          error: 'Too Many Requests',
          message: 'A spin is already in progress.',
        });
      }

      try {
        // 2. Validate active session
        const sessionId = await redis.get<string>(Keys.activeSession(uid));
        if (!sessionId) {
          return reply.status(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'No active session. Call /session/start first.',
          });
        }

        // 3. Fetch user balance
        const { data: user, error: userErr } = await supabase
          .from('users')
          .select('balance_usd, total_spins, total_wins, total_wagered_usd')
          .eq('id', uid)
          .single();

        if (userErr || !user) {
          return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'User not found.' });
        }

        if (user.balance_usd < wagerUsd) {
          return reply.status(402).send({
            statusCode: 402,
            error: 'Payment Required',
            message: `Insufficient balance. You have $${user.balance_usd.toFixed(2)}.`,
          });
        }

        // 4. Retrieve server seed + compute nonce from spin count
        const serverSeed = await redis.get<string>(Keys.serverSeed(sessionId));
        if (!serverSeed) {
          return reply.status(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'Session seed expired. Please start a new session.',
          });
        }

        const nonce = user.total_spins + 1;
        const outcomeIndex = computeOutcome(serverSeed, clientSeed, nonce);
        const segment = WHEEL[outcomeIndex];
        const payoutUsd = calcPayout(wagerUsd, outcomeIndex);
        const netChange = parseFloat((payoutUsd - wagerUsd).toFixed(2));

        // 5. Update user balance + stats
        const { error: updateErr } = await supabase
          .from('users')
          .update({
            balance_usd: parseFloat((user.balance_usd + netChange).toFixed(2)),
            total_spins: nonce,
            total_wins: segment.multiplier > 0 ? user.total_wins + 1 : user.total_wins,
            total_wagered_usd: parseFloat((user.total_wagered_usd + wagerUsd).toFixed(2)),
          })
          .eq('id', uid);

        if (updateErr) {
          fastify.log.error({ err: updateErr }, 'Failed to update user balance');
          return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Spin failed. Your balance was not charged.' });
        }

        // 6. Record spin result
        const { error: spinErr } = await supabase.from('spin_results').insert({
          user_id: uid,
          session_id: sessionId,
          wager_usd: wagerUsd,
          outcome_index: outcomeIndex,
          outcome_label: segment.label,
          multiplier: segment.multiplier,
          payout_usd: payoutUsd,
          server_seed_hash: hashServerSeed(serverSeed),
          client_seed: clientSeed,
          nonce,
          tx_hash: null,
        });

        if (spinErr) {
          fastify.log.error({ err: spinErr }, 'Failed to record spin result');
          // Non-fatal — balance already updated, don't fail the response
        }

        // 7. Update session totals
        await supabase
          .from('game_sessions')
          .update({
            total_spins: nonce,
            total_wagered_usd: parseFloat((wagerUsd).toFixed(2)),
            total_payout_usd: payoutUsd,
          })
          .eq('id', sessionId);

        return reply.status(200).send({
          outcomeIndex,
          outcomeLabel: segment.label,
          multiplier: segment.multiplier,
          wagerUsd,
          payoutUsd,
          netChangeUsd: netChange,
          newBalanceUsd: parseFloat((user.balance_usd + netChange).toFixed(2)),
          nonce,
          serverSeedHash: hashServerSeed(serverSeed), // Client can verify after session ends
        });

      } finally {
        // Always release lock, even on error
        await releaseLock(lockKey);
      }
    },
  );

  // ── POST /api/v1/games/session/end ────────────────────────────────────────
  // Ends session and REVEALS the server seed so client can verify all spins.

  fastify.post(
    '/session/end',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const uid = req.user.sub;

      const sessionId = await redis.get<string>(Keys.activeSession(uid));
      if (!sessionId) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'No active session found.',
        });
      }

      // Reveal server seed — client can now verify every spin
      const serverSeed = await redis.get<string>(Keys.serverSeed(sessionId));

      // Mark session complete in DB
      await supabase
        .from('game_sessions')
        .update({ status: 'completed', ended_at: new Date().toISOString() })
        .eq('id', sessionId);

      // Clean up Redis
      await redis.del(Keys.activeSession(uid));
      await redis.del(Keys.serverSeed(sessionId));

      return reply.status(200).send({
        sessionId,
        serverSeed,  // Now revealed — client verifies HMAC against saved hash
        message: 'Session ended. Use the serverSeed to verify your spins.',
      });
    },
  );

  // ── GET /api/v1/games/history ─────────────────────────────────────────────
  // Returns paginated spin history for the authenticated user.

  fastify.get<{ Querystring: { page?: number; limit?: number } }>(
    '/history',
    { preHandler: [authenticate] },
    async (req, reply) => {
      const page = Math.max(1, req.query.page ?? 1);
      const limit = Math.min(50, req.query.limit ?? 20);
      const offset = (page - 1) * limit;

      const { data, error, count } = await supabase
        .from('spin_results')
        .select('*', { count: 'exact' })
        .eq('user_id', req.user.sub)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Failed to fetch history.' });
      }

      return reply.send({
        spins: data,
        pagination: {
          page,
          limit,
          total: count ?? 0,
          totalPages: Math.ceil((count ?? 0) / limit),
        },
      });
    },
  );

  // ── GET /api/v1/games/leaderboard ─────────────────────────────────────────
  // Top 20 winners today — cached in Redis.

  fastify.get('/leaderboard', async (_req, reply) => {
    const cacheKey = Keys.leaderboardDaily();
    const cached = await redis.get<unknown[]>(cacheKey);

    if (cached) {
      return reply.send({ leaderboard: cached, cached: true });
    }

    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from('spin_results')
      .select('user_id, users!inner(username), payout_usd')
      .gte('created_at', `${today}T00:00:00Z`)
      .order('payout_usd', { ascending: false })
      .limit(20);

    if (error) {
      return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Failed to fetch leaderboard.' });
    }

    await redis.set(cacheKey, JSON.stringify(data), { ex: TTL.LEADERBOARD });

    return reply.send({ leaderboard: data, cached: false });
  });
}
