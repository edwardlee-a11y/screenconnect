import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../config/supabase';
import { redis, Keys } from '../config/redis';
import { getHotWalletBalance, getPrizePoolBalance } from '../services/blockchainService';
import { sendSecurityAlertEmail } from '../services/emailService';

// ─── Admin auth middleware ─────────────────────────────────────────────────
// Separate from player JWT — uses a static admin secret from env.
// For production, swap this with a proper admin RBAC system.

async function adminAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const secret = req.headers['x-admin-secret'] as string | undefined;
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid admin secret.',
    });
  }
}

// ─── Route plugin ──────────────────────────────────────────────────────────

export async function adminRoutes(fastify: FastifyInstance): Promise<void> {

  // ── GET /api/v1/admin/stats ───────────────────────────────────────────────
  // Platform overview: users, spins, revenue, balances.

  fastify.get(
    '/stats',
    { preHandler: [adminAuth], config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (_req, reply) => {
      const [
        usersResult,
        spinsResult,
        transactionsResult,
        hotWallet,
        prizePool,
      ] = await Promise.allSettled([
        supabase.from('users').select('id', { count: 'exact', head: true }),
        supabase.from('spin_results').select('id', { count: 'exact', head: true }),
        supabase
          .from('transactions')
          .select('amount_usd, type, status')
          .eq('status', 'completed'),
        getHotWalletBalance(),
        getPrizePoolBalance(),
      ]);

      const totalUsers  = usersResult.status  === 'fulfilled' ? (usersResult.value.count  ?? 0) : 0;
      const totalSpins  = spinsResult.status  === 'fulfilled' ? (spinsResult.value.count  ?? 0) : 0;

      let totalWithdrawalsUsd = 0;
      let totalDepositsUsd    = 0;
      if (transactionsResult.status === 'fulfilled' && transactionsResult.value.data) {
        for (const tx of transactionsResult.value.data) {
          if (tx.type === 'withdrawal') totalWithdrawalsUsd += tx.amount_usd;
          if (tx.type === 'deposit')    totalDepositsUsd    += tx.amount_usd;
        }
      }

      return reply.send({
        platform: {
          totalUsers,
          totalSpins,
          totalWithdrawalsUsd: parseFloat(totalWithdrawalsUsd.toFixed(2)),
          totalDepositsUsd:    parseFloat(totalDepositsUsd.toFixed(2)),
        },
        blockchain: {
          hotWallet: hotWallet.status === 'fulfilled' ? hotWallet.value : null,
          prizePool: prizePool.status === 'fulfilled' ? prizePool.value : null,
        },
      });
    },
  );

  // ── GET /api/v1/admin/users ───────────────────────────────────────────────
  // Paginated user list with search.

  fastify.get<{ Querystring: { page?: number; limit?: number; search?: string } }>(
    '/users',
    { preHandler: [adminAuth] },
    async (req, reply) => {
      const page  = Math.max(1, Number(req.query.page  ?? 1));
      const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 25)));
      const from  = (page - 1) * limit;
      const search = req.query.search?.trim();

      let query = supabase
        .from('users')
        .select(
          'id, email, username, balance_usd, total_spins, total_wins, is_banned, kyc_verified, created_at',
          { count: 'exact' },
        )
        .order('created_at', { ascending: false })
        .range(from, from + limit - 1);

      if (search) {
        query = query.or(`username.ilike.%${search}%,email.ilike.%${search}%`);
      }

      const { data, count, error } = await query;

      if (error) {
        return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: error.message });
      }

      return reply.send({
        users: data,
        pagination: { total: count ?? 0, page, limit, totalPages: Math.ceil((count ?? 0) / limit) },
      });
    },
  );

  // ── GET /api/v1/admin/users/:id ───────────────────────────────────────────
  // Full user profile including spin history and transactions.

  fastify.get<{ Params: { id: string } }>(
    '/users/:id',
    { preHandler: [adminAuth] },
    async (req, reply) => {
      const { id } = req.params;

      const [userResult, spinsResult, txResult] = await Promise.all([
        supabase
          .from('users')
          .select('*')
          .eq('id', id)
          .single(),
        supabase
          .from('spin_results')
          .select('*')
          .eq('user_id', id)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('transactions')
          .select('*')
          .eq('user_id', id)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      if (!userResult.data) {
        return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'User not found.' });
      }

      return reply.send({
        user:         userResult.data,
        recentSpins:  spinsResult.data  ?? [],
        recentTx:     txResult.data     ?? [],
      });
    },
  );

  // ── POST /api/v1/admin/users/:id/ban ─────────────────────────────────────
  // Ban or unban a user. Invalidates their active Redis session.

  fastify.post<{ Params: { id: string }; Body: { banned: boolean; reason?: string } }>(
    '/users/:id/ban',
    {
      preHandler: [adminAuth],
      schema: {
        body: {
          type: 'object',
          required: ['banned'],
          properties: {
            banned: { type: 'boolean' },
            reason: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      const { banned, reason } = req.body;

      const { data: user, error: fetchErr } = await supabase
        .from('users')
        .select('email, username')
        .eq('id', id)
        .single();

      if (fetchErr || !user) {
        return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'User not found.' });
      }

      const { error } = await supabase
        .from('users')
        .update({ is_banned: banned })
        .eq('id', id);

      if (error) {
        return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: error.message });
      }

      // Invalidate active session in Redis
      await redis.del(Keys.userSession(id));

      // Notify user by email
      if (banned) {
        sendSecurityAlertEmail({
          to:       user.email,
          username: user.username,
          event:    'Account Suspended',
          detail:   reason ?? 'Your account has been suspended by an administrator.',
        }).catch(() => {});
      }

      return reply.send({
        message: banned ? `User ${user.username} banned.` : `User ${user.username} unbanned.`,
        userId: id,
        banned,
      });
    },
  );

  // ── POST /api/v1/admin/users/:id/balance ─────────────────────────────────
  // Adjust a user's in-app USD balance (deposits, bonuses, manual corrections).

  fastify.post<{ Params: { id: string }; Body: { deltaUsd: number; note: string } }>(
    '/users/:id/balance',
    {
      preHandler: [adminAuth],
      schema: {
        body: {
          type: 'object',
          required: ['deltaUsd', 'note'],
          properties: {
            deltaUsd: { type: 'number' },
            note:     { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const { id }            = req.params;
      const { deltaUsd, note } = req.body;

      const { data: user, error: fetchErr } = await supabase
        .from('users')
        .select('balance_usd, username')
        .eq('id', id)
        .single();

      if (fetchErr || !user) {
        return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'User not found.' });
      }

      const newBalance = parseFloat((user.balance_usd + deltaUsd).toFixed(2));
      if (newBalance < 0) {
        return reply.status(400).send({
          statusCode: 400, error: 'Bad Request',
          message: `Balance would go negative (current: $${user.balance_usd.toFixed(2)}, delta: $${deltaUsd}).`,
        });
      }

      await supabase.from('users').update({ balance_usd: newBalance }).eq('id', id);

      // Record as a transaction
      await supabase.from('transactions').insert({
        user_id:    id,
        type:       deltaUsd >= 0 ? 'deposit' : 'withdrawal',
        amount_usd: Math.abs(deltaUsd),
        status:     'completed',
        metadata:   { admin_note: note, admin_adjustment: true },
      });

      return reply.send({
        userId:     id,
        username:   user.username,
        previousBalance: user.balance_usd,
        newBalance,
        delta:      deltaUsd,
      });
    },
  );

  // ── GET /api/v1/admin/transactions ────────────────────────────────────────
  // Recent platform-wide transactions.

  fastify.get<{ Querystring: { page?: number; status?: string; type?: string } }>(
    '/transactions',
    { preHandler: [adminAuth] },
    async (req, reply) => {
      const page   = Math.max(1, Number(req.query.page ?? 1));
      const limit  = 50;
      const from   = (page - 1) * limit;

      let query = supabase
        .from('transactions')
        .select('*, users(username, email)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, from + limit - 1);

      if (req.query.status) query = query.eq('status', req.query.status);
      if (req.query.type)   query = query.eq('type',   req.query.type);

      const { data, count, error } = await query;
      if (error) {
        return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: error.message });
      }

      return reply.send({
        transactions: data,
        pagination: { total: count ?? 0, page, limit, totalPages: Math.ceil((count ?? 0) / limit) },
      });
    },
  );

  // ── POST /api/v1/admin/leaderboard/reset ─────────────────────────────────
  // Manually reset the daily leaderboard in Redis.

  fastify.post(
    '/leaderboard/reset',
    { preHandler: [adminAuth] },
    async (_req, reply) => {
      await redis.del(Keys.leaderboardDaily());
      return reply.send({ message: 'Daily leaderboard reset.' });
    },
  );
}
