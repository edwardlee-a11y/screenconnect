import { Server as SocketIOServer, Socket } from 'socket.io';
import { createHmac } from 'crypto';
import { redis, Keys } from '../config/redis';
import { supabase } from '../config/supabase';

// ─── Event type definitions ────────────────────────────────────────────────

// Client → Server
interface ClientEvents {
  'game:join':    (payload: { sessionId: string }) => void;
  'game:leave':   () => void;
  'game:spin':    (payload: SpinPayload) => void;
  'chat:message': (payload: { message: string }) => void;
  'room:join':    (payload: { tier: number }) => void;
  'room:leave':   () => void;
}

// Server → Client
interface ServerEvents {
  'game:spin:result':   (payload: SpinResultPayload) => void;
  'game:spin:error':    (payload: ErrorPayload) => void;
  'game:jackpot':       (payload: JackpotPayload) => void;
  'game:player:joined': (payload: PlayerPayload) => void;
  'game:player:left':   (payload: PlayerPayload) => void;
  'leaderboard:update': (payload: LeaderboardEntry[]) => void;
  'chat:message':       (payload: ChatPayload) => void;
  'room:update':        (payload: RoomUpdatePayload) => void;
  'error':              (payload: ErrorPayload) => void;
}

// Shared socket data (attached per connection)
interface SocketData {
  uid: string;
  username: string;
  sessionId: string | null;
  currentRoom: number | null;
}

interface SpinPayload {
  wagerUsd: number;
  clientSeed: string;
}

interface SpinResultPayload {
  outcomeIndex: number;
  outcomeLabel: string;
  multiplier: number;
  wagerUsd: number;
  payoutUsd: number;
  netChangeUsd: number;
  newBalanceUsd: number;
  nonce: number;
  serverSeedHash: string;
}

interface JackpotPayload {
  username: string;
  payoutUsd: number;
  outcomeLabel: string;
  timestamp: string;
}

interface PlayerPayload {
  username: string;
  sessionId: string;
}

interface LeaderboardEntry {
  username: string;
  payoutUsd: number;
}

interface ChatPayload {
  username: string;
  message: string;
  timestamp: string;
}

interface ErrorPayload {
  message: string;
  code?: string;
}

interface RoomUpdatePayload {
  tier: number;
  playerCount: number;
  players: string[];
  isReady: boolean;
}

// ─── Room config ───────────────────────────────────────────────────────────

const ROOM_TIERS = [5, 25, 50, 100, 200, 500, 1000, 5000, 10000];
const MIN_PLAYERS_TO_PLAY = 5;

// ─── Wheel config (must match games.ts) ───────────────────────────────────

interface WheelSegment {
  label: string;
  multiplier: number;
  weight: number;
}

const WHEEL: WheelSegment[] = [
  { label: 'LOSE',    multiplier: 0,    weight: 280 },
  { label: 'LOSE',    multiplier: 0,    weight: 200 },
  { label: '1.2x',    multiplier: 1.2,  weight: 150 },
  { label: '1.5x',    multiplier: 1.5,  weight: 120 },
  { label: 'LOSE',    multiplier: 0,    weight: 80  },
  { label: '2x',      multiplier: 2,    weight: 60  },
  { label: '1.2x',    multiplier: 1.2,  weight: 40  },
  { label: '3x',      multiplier: 3,    weight: 30  },
  { label: '2x',      multiplier: 2,    weight: 20  },
  { label: '5x',      multiplier: 5,    weight: 12  },
  { label: '10x',     multiplier: 10,   weight: 5   },
  { label: 'JACKPOT', multiplier: 50,   weight: 3   },
];

const WHEEL_TOTAL_WEIGHT = WHEEL.reduce((s, seg) => s + seg.weight, 0);

const MIN_WAGER_USD = 0.10;
const MAX_WAGER_USD = 10000.00;
const CHAT_MAX_LENGTH = 120;
const CHAT_RATE_LIMIT = 5; // messages per 10 seconds

// ─── Helpers ───────────────────────────────────────────────────────────────

function computeOutcome(serverSeed: string, clientSeed: string, nonce: number): number {
  const hmac = createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest('hex');
  const roll = parseInt(hmac.slice(0, 8), 16) % WHEEL_TOTAL_WEIGHT;
  let cumulative = 0;
  for (let i = 0; i < WHEEL.length; i++) {
    cumulative += WHEEL[i].weight;
    if (roll < cumulative) return i;
  }
  return WHEEL.length - 1;
}

function sanitizeChat(message: string): string {
  return message.trim().slice(0, CHAT_MAX_LENGTH).replace(/[<>]/g, '');
}

// ─── Main socket registration ──────────────────────────────────────────────

export function registerGameSocket(
  io: SocketIOServer<ClientEvents, ServerEvents, Record<string, never>, SocketData>,
): void {

  // ── JWT auth middleware ────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;

    if (!token) {
      return next(new Error('Authentication token required.'));
    }

    try {
      // Decode JWT manually (same secret as Fastify)
      const secret = process.env.JWT_SECRET!;
      const [, payloadB64] = token.split('.');
      const payload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8'),
      ) as { sub: string; username: string; jti: string; exp: number };

      // Check expiry
      if (payload.exp < Math.floor(Date.now() / 1000)) {
        return next(new Error('Token expired.'));
      }

      // Check blacklist
      const isBlacklisted = await redis.exists(Keys.blacklistedToken(payload.jti));
      if (isBlacklisted) {
        return next(new Error('Token revoked.'));
      }

      // Check ban
      const { data: user } = await supabase
        .from('users')
        .select('is_banned')
        .eq('id', payload.sub)
        .single();

      if (user?.is_banned) {
        return next(new Error('Account suspended.'));
      }

      socket.data.uid = payload.sub;
      socket.data.username = payload.username;
      socket.data.sessionId = null;
      socket.data.currentRoom = null;

      next();
    } catch {
      next(new Error('Invalid token.'));
    }
  });

  // ── Connection handler ─────────────────────────────────────────────────────
  io.on('connection', (socket: Socket<ClientEvents, ServerEvents, Record<string, never>, SocketData>) => {
    const { uid, username } = socket.data;

    console.log(`[socket] connected: ${username} (${uid}) — ${socket.id}`);

    // ── game:join ──────────────────────────────────────────────────────────
    socket.on('game:join', async ({ sessionId }) => {
      // Verify session belongs to this user
      const storedSessionId = await redis.get<string>(Keys.activeSession(uid));

      if (!storedSessionId || storedSessionId !== sessionId) {
        socket.emit('error', { message: 'Invalid or expired session.', code: 'INVALID_SESSION' });
        return;
      }

      socket.data.sessionId = sessionId;
      await socket.join(`session:${sessionId}`);
      await socket.join('lobby'); // Global room for jackpot broadcasts

      socket.to('lobby').emit('game:player:joined', { username, sessionId });
    });

    // ── game:leave ─────────────────────────────────────────────────────────
    socket.on('game:leave', () => {
      const { sessionId } = socket.data;
      if (sessionId) {
        socket.leave(`session:${sessionId}`);
        socket.to('lobby').emit('game:player:left', { username, sessionId });
        socket.data.sessionId = null;
      }
    });

    // ── game:spin ──────────────────────────────────────────────────────────
    socket.on('game:spin', async ({ wagerUsd, clientSeed }) => {
      const { sessionId } = socket.data;

      // Input validation
      if (!sessionId) {
        socket.emit('game:spin:error', { message: 'Join a session first.', code: 'NO_SESSION' });
        return;
      }

      if (typeof wagerUsd !== 'number' || wagerUsd < MIN_WAGER_USD || wagerUsd > MAX_WAGER_USD) {
        socket.emit('game:spin:error', {
          message: `Wager must be between $${MIN_WAGER_USD} and $${MAX_WAGER_USD}.`,
          code: 'INVALID_WAGER',
        });
        return;
      }

      if (typeof clientSeed !== 'string' || clientSeed.length < 8 || clientSeed.length > 64) {
        socket.emit('game:spin:error', { message: 'Invalid client seed.', code: 'INVALID_SEED' });
        return;
      }

      // Acquire spin lock
      const lockKey = Keys.spinLock(uid);
      const locked = await redis.set(lockKey, '1', { nx: true, ex: 10 });
      if (!locked) {
        socket.emit('game:spin:error', { message: 'Spin already in progress.', code: 'SPIN_LOCKED' });
        return;
      }

      try {
        // Fetch user balance + spin count
        const { data: user, error: userErr } = await supabase
          .from('users')
          .select('balance_usd, total_spins')
          .eq('id', uid)
          .single();

        if (userErr || !user) {
          socket.emit('game:spin:error', { message: 'User not found.', code: 'USER_NOT_FOUND' });
          return;
        }

        if (user.balance_usd < wagerUsd) {
          socket.emit('game:spin:error', {
            message: `Insufficient balance. You have $${user.balance_usd.toFixed(2)}.`,
            code: 'INSUFFICIENT_BALANCE',
          });
          return;
        }

        // Get server seed
        const serverSeed = await redis.get<string>(Keys.serverSeed(sessionId));
        if (!serverSeed) {
          socket.emit('game:spin:error', { message: 'Session seed expired. Start a new session.', code: 'SEED_EXPIRED' });
          return;
        }

        const nonce = user.total_spins + 1;
        const outcomeIndex = computeOutcome(serverSeed, clientSeed, nonce);
        const segment = WHEEL[outcomeIndex];
        const payoutUsd = parseFloat((wagerUsd * segment.multiplier).toFixed(2));
        const netChange = parseFloat((payoutUsd - wagerUsd).toFixed(2));
        const newBalance = parseFloat((user.balance_usd + netChange).toFixed(2));
        const serverSeedHash = createHmac('sha256', serverSeed).digest('hex');

        // Update balance
        await supabase
          .from('users')
          .update({ balance_usd: newBalance, total_spins: nonce })
          .eq('id', uid);

        // Record result
        await supabase.from('spin_results').insert({
          user_id: uid,
          session_id: sessionId,
          wager_usd: wagerUsd,
          outcome_index: outcomeIndex,
          outcome_label: segment.label,
          multiplier: segment.multiplier,
          payout_usd: payoutUsd,
          server_seed_hash: serverSeedHash,
          client_seed: clientSeed,
          nonce,
          tx_hash: null,
        });

        const result: SpinResultPayload = {
          outcomeIndex,
          outcomeLabel: segment.label,
          multiplier: segment.multiplier,
          wagerUsd,
          payoutUsd,
          netChangeUsd: netChange,
          newBalanceUsd: newBalance,
          nonce,
          serverSeedHash,
        };

        // Emit result to this socket only
        socket.emit('game:spin:result', result);

        // Broadcast jackpot to entire lobby
        if (segment.label === 'JACKPOT') {
          const jackpotPayload: JackpotPayload = {
            username,
            payoutUsd,
            outcomeLabel: segment.label,
            timestamp: new Date().toISOString(),
          };
          io.to('lobby').emit('game:jackpot', jackpotPayload);

          // Persist jackpot to leaderboard sorted set
          await redis.zadd(Keys.leaderboardAllTime(), {
            score: payoutUsd,
            member: username,
          });
        }

        // Update daily leaderboard
        await redis.zadd(Keys.leaderboardDaily(), {
          score: payoutUsd,
          member: username,
        });

        // Broadcast updated top-5 leaderboard to lobby every 10 spins
        if (nonce % 10 === 0) {
          const top5 = await redis.zrange(Keys.leaderboardDaily(), 0, 4, {
            rev: true,
            withScores: true,
          });
          // Parse interleaved [member, score, member, score, ...] array
          const entries: LeaderboardEntry[] = [];
          for (let i = 0; i < top5.length; i += 2) {
            entries.push({
              username: top5[i] as string,
              payoutUsd: parseFloat(top5[i + 1] as string),
            });
          }
          io.to('lobby').emit('leaderboard:update', entries);
        }

      } finally {
        await redis.del(lockKey);
      }
    });

    // ── chat:message ───────────────────────────────────────────────────────
    socket.on('chat:message', async ({ message }) => {
      // Rate limit: max 5 messages per 10s per user
      const chatRateKey = `chat:rl:${uid}`;
      const count = await redis.incr(chatRateKey);
      if (count === 1) await redis.expire(chatRateKey, 10);

      if (count > CHAT_RATE_LIMIT) {
        socket.emit('error', { message: 'Slow down! Chat rate limit reached.', code: 'CHAT_RATE_LIMIT' });
        return;
      }

      const clean = sanitizeChat(message);
      if (!clean) return;

      io.to('lobby').emit('chat:message', {
        username,
        message: clean,
        timestamp: new Date().toISOString(),
      });
    });

    // ── room:join ──────────────────────────────────────────────────────────
    socket.on('room:join', async ({ tier }) => {
      if (!ROOM_TIERS.includes(tier)) {
        socket.emit('error', { message: 'Invalid room tier.', code: 'INVALID_ROOM' });
        return;
      }

      // Leave current room first
      const prev = socket.data.currentRoom;
      if (prev !== null) {
        await redis.srem(Keys.roomPlayers(prev), username);
        socket.leave(`room:${prev}`);
        const prevPlayers = await redis.smembers<string[]>(Keys.roomPlayers(prev));
        io.to(`room:${prev}`).emit('room:update', {
          tier: prev,
          playerCount: prevPlayers.length,
          players: prevPlayers,
          isReady: prevPlayers.length >= MIN_PLAYERS_TO_PLAY,
        });
      }

      await redis.sadd(Keys.roomPlayers(tier), username);
      socket.data.currentRoom = tier;
      await socket.join(`room:${tier}`);

      const players = await redis.smembers<string[]>(Keys.roomPlayers(tier));
      const update: RoomUpdatePayload = {
        tier,
        playerCount: players.length,
        players,
        isReady: players.length >= MIN_PLAYERS_TO_PLAY,
      };
      io.to(`room:${tier}`).emit('room:update', update);
    });

    // ── room:leave ─────────────────────────────────────────────────────────
    socket.on('room:leave', async () => {
      const tier = socket.data.currentRoom;
      if (tier === null) return;

      await redis.srem(Keys.roomPlayers(tier), username);
      socket.data.currentRoom = null;
      socket.leave(`room:${tier}`);

      const players = await redis.smembers<string[]>(Keys.roomPlayers(tier));
      io.to(`room:${tier}`).emit('room:update', {
        tier,
        playerCount: players.length,
        players,
        isReady: players.length >= MIN_PLAYERS_TO_PLAY,
      });
    });

    // ── disconnect ─────────────────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      const { sessionId, currentRoom } = socket.data;
      console.log(`[socket] disconnected: ${username} — ${reason}`);

      if (sessionId) {
        socket.to('lobby').emit('game:player:left', { username, sessionId });
      }

      // Clean up room membership on disconnect
      if (currentRoom !== null) {
        await redis.srem(Keys.roomPlayers(currentRoom), username);
        const players = await redis.smembers<string[]>(Keys.roomPlayers(currentRoom));
        io.to(`room:${currentRoom}`).emit('room:update', {
          tier: currentRoom,
          playerCount: players.length,
          players,
          isReady: players.length >= MIN_PLAYERS_TO_PLAY,
        });
      }
    });
  });
}
