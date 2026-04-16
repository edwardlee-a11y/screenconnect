import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import { verifyFirebaseToken } from '../config/firebase';
import { supabase } from '../config/supabase';
import { redis, Keys, TTL } from '../config/redis';
import { authenticate, JwtPayload } from '../middleware/authenticate';
import { sendWelcomeEmail } from '../services/emailService';

// ─── Request body schemas ──────────────────────────────────────────────────

interface LoginBody {
  firebaseToken: string;
  username?: string;   // Required only on first login (registration)
}

interface LogoutBody {
  // JWT is read from Authorization header — no body needed
}

interface RefreshBody {
  // Token is read from Authorization header
}

// ─── Route plugin ──────────────────────────────────────────────────────────

export async function authRoutes(fastify: FastifyInstance): Promise<void> {

  // ── POST /api/v1/auth/login ──────────────────────────────────────────────
  // Called after Firebase sign-in on the mobile client.
  // Verifies the Firebase ID token, upserts the user in Supabase,
  // and returns a signed JWT for all subsequent API calls.

  fastify.post<{ Body: LoginBody }>(
    '/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['firebaseToken'],
          properties: {
            firebaseToken: { type: 'string', minLength: 10 },
            username: { type: 'string', minLength: 3, maxLength: 20 },
          },
        },
      },
    },
    async (req: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
      const { firebaseToken, username } = req.body;

      // 1. Verify Firebase token
      let firebaseUser;
      try {
        firebaseUser = await verifyFirebaseToken(firebaseToken);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Token verification failed';
        return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: msg });
      }

      const { uid, email, emailVerified, name } = firebaseUser;

      if (!email) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Firebase account must have an associated email.',
        });
      }

      // 2. Check if user exists in Supabase
      const { data: existingUser } = await supabase
        .from('users')
        .select('id, username, is_banned, kyc_verified')
        .eq('id', uid)
        .single();

      // 3. New user — require username
      if (!existingUser) {
        if (!username) {
          return reply.status(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'Username is required for new accounts.',
          });
        }

        // Validate username format
        if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
          return reply.status(400).send({
            statusCode: 400,
            error: 'Bad Request',
            message: 'Username must be 3-20 characters: letters, numbers, underscores only.',
          });
        }

        // Check username uniqueness
        const { data: taken } = await supabase
          .from('users')
          .select('id')
          .eq('username', username)
          .single();

        if (taken) {
          return reply.status(409).send({
            statusCode: 409,
            error: 'Conflict',
            message: 'Username already taken.',
          });
        }

        // Insert new user
        const { error: insertError } = await supabase.from('users').insert({
          id: uid,
          email,
          username,
          wallet_address: null,
          balance_usd: 0,
          balance_spin: 0,
          total_spins: 0,
          total_wins: 0,
          total_wagered_usd: 0,
          is_banned: false,
          kyc_verified: emailVerified,
        });

        if (insertError) {
          fastify.log.error({ err: insertError }, 'Failed to create user');
          return reply.status(500).send({
            statusCode: 500,
            error: 'Internal Server Error',
            message: 'Failed to create account.',
          });
        }

        // Send welcome email (fire-and-forget — don't block response)
        sendWelcomeEmail(email, username).catch((err) =>
          fastify.log.warn({ err }, 'Failed to send welcome email'),
        );
      } else {
        // Existing user — check ban
        if (existingUser.is_banned) {
          return reply.status(403).send({
            statusCode: 403,
            error: 'Forbidden',
            message: 'Your account has been suspended.',
          });
        }

        // Sync email verification status if it changed
        if (emailVerified && !existingUser.kyc_verified) {
          await supabase
            .from('users')
            .update({ kyc_verified: true })
            .eq('id', uid);
        }
      }

      // 4. Issue our own JWT
      const jti = randomUUID();
      const token = fastify.jwt.sign({
        sub: uid,
        email,
        username: existingUser?.username ?? username!,
        jti,
      });

      // 5. Cache session in Redis
      await redis.set(
        Keys.userSession(uid),
        JSON.stringify({ is_banned: false }),
        { ex: TTL.SESSION },
      );

      return reply.status(200).send({
        token,
        user: {
          id: uid,
          email,
          username: existingUser?.username ?? username,
          emailVerified,
          isNewUser: !existingUser,
        },
      });
    },
  );

  // ── PATCH /api/v1/auth/profile ──────────────────────────────────────────
  // Update mutable profile fields (currently: username).

  fastify.patch<{ Body: { username: string } }>(
    '/profile',
    {
      preHandler: [authenticate],
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
      schema: {
        body: {
          type: 'object',
          required: ['username'],
          properties: {
            username: { type: 'string', minLength: 3, maxLength: 20 },
          },
        },
      },
    },
    async (req, reply) => {
      const { username } = req.body;
      const uid = req.user.sub;

      if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Username must be 3-20 characters: letters, numbers, underscores only.',
        });
      }

      // Check uniqueness (excluding current user)
      const { data: taken } = await supabase
        .from('users')
        .select('id')
        .eq('username', username)
        .neq('id', uid)
        .single();

      if (taken) {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'Username already taken.',
        });
      }

      const { error } = await supabase
        .from('users')
        .update({ username })
        .eq('id', uid);

      if (error) {
        fastify.log.error({ err: error }, 'Failed to update username');
        return reply.status(500).send({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'Failed to update profile.',
        });
      }

      return reply.status(200).send({ username });
    },
  );

  // ── POST /api/v1/auth/logout ─────────────────────────────────────────────
  // Blacklists the current JWT so it can't be reused even before expiry.

  fastify.post(
    '/logout',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { jti, exp, sub } = req.user;

      // Time remaining until natural expiry
      const ttl = (exp ?? 0) - Math.floor(Date.now() / 1000);

      if (ttl > 0) {
        await redis.set(Keys.blacklistedToken(jti), '1', { ex: ttl });
      }

      // Clear session cache
      await redis.del(Keys.userSession(sub));

      return reply.status(200).send({ message: 'Logged out successfully.' });
    },
  );

  // ── GET /api/v1/auth/me ──────────────────────────────────────────────────
  // Returns the current user's profile from Supabase.

  fastify.get(
    '/me',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { data: user, error } = await supabase
        .from('users')
        .select(
          'id, email, username, wallet_address, balance_usd, balance_spin, total_spins, total_wins, kyc_verified, created_at',
        )
        .eq('id', req.user.sub)
        .single();

      if (error || !user) {
        return reply.status(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'User not found.',
        });
      }

      return reply.status(200).send({ user });
    },
  );

  // ── POST /api/v1/auth/refresh ────────────────────────────────────────────
  // Issues a new JWT using a still-valid existing JWT.
  // Blacklists the old token immediately after issuing the new one.

  fastify.post(
    '/refresh',
    { preHandler: [authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { sub, email, username, jti: oldJti, exp } = req.user;

      // Blacklist old token for its remaining TTL
      const ttl = (exp ?? 0) - Math.floor(Date.now() / 1000);
      if (ttl > 0) {
        await redis.set(Keys.blacklistedToken(oldJti), '1', { ex: ttl });
      }

      // Issue new token
      const newJti = randomUUID();
      const token = fastify.jwt.sign({ sub, email, username, jti: newJti });

      return reply.status(200).send({ token });
    },
  );
}
