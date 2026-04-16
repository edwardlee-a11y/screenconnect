import { FastifyRequest, FastifyReply } from 'fastify';
import { redis, Keys } from '../config/redis';
import { supabase } from '../config/supabase';

// ─── JWT payload shape ─────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;
  email: string;
  username: string;
  jti: string;
  iat?: number;
  exp?: number;
}

// @fastify/jwt v10 module augmentation — sets the type for req.user
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

// ─── authenticate hook ─────────────────────────────────────────────────────

export async function authenticate(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Missing or malformed Authorization header.',
    });
  }

  const token = authHeader.slice(7);

  // Verify JWT signature and expiry
  let payload: JwtPayload;
  try {
    payload = await req.jwtVerify<JwtPayload>();
  } catch (err: unknown) {
    const isExpired =
      err instanceof Error && err.message.toLowerCase().includes('expired');
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: isExpired ? 'Token expired. Please log in again.' : 'Invalid token.',
    });
  }

  // Check blacklist
  const isBlacklisted = await redis.exists(Keys.blacklistedToken(payload.jti));
  if (isBlacklisted) {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Token has been revoked. Please log in again.',
    });
  }

  // Check ban (with Redis cache)
  const cached = await redis.get<{ is_banned: boolean }>(Keys.userSession(payload.sub));

  if (cached) {
    if (cached.is_banned) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Your account has been suspended.',
      });
    }
  } else {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, is_banned')
      .eq('id', payload.sub)
      .single();

    if (error || !user) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'User not found.',
      });
    }

    if (user.is_banned) {
      return reply.status(403).send({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Your account has been suspended.',
      });
    }

    await redis.set(Keys.userSession(payload.sub), JSON.stringify({ is_banned: false }), { ex: 300 });
  }

  // req.user is set automatically by jwtVerify — no manual assignment needed in v10
  void token; // token variable used only for header extraction above
}

// ─── requireEmailVerified hook ─────────────────────────────────────────────

export async function requireEmailVerified(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { data: user } = await supabase
    .from('users')
    .select('kyc_verified')
    .eq('id', req.user.sub)
    .single();

  if (!user?.kyc_verified) {
    return reply.status(403).send({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Email verification required before playing.',
    });
  }
}
