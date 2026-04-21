import 'dotenv/config';
import * as Sentry from '@sentry/node';

// Initialise Sentry as early as possible — before any other imports touch the network.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  });
  console.log('[boot] Sentry ✓');
}

import Fastify, { FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyJwt from '@fastify/jwt';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

import { supabase } from './config/supabase';
import { redis } from './config/redis';
import { initFirebase } from './config/firebase';
import { authRoutes } from './routes/auth';
import { gameRoutes } from './routes/games';
import { walletRoutes } from './routes/wallet';
import { adminRoutes } from './routes/admin';
import { registerAgentRoutes } from './routes/agentRoutes';
import { registerGameSocket } from './socket/gameSocket';
import { initializeAgentSystem } from './agents';

// ─── Environment validation ───────────────────────────────────────────────────
const REQUIRED_ENV = [
  'JWT_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'UPSTASH_REDIS_URL',
  'UPSTASH_REDIS_TOKEN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'ALCHEMY_API_KEY',
  'POLYGON_CONTRACT_ADDRESS',
  'FRONTEND_URL',
] as const;

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[FATAL] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const IS_PROD = process.env.NODE_ENV === 'production';
const FRONTEND_URL = process.env.FRONTEND_URL!;

// ─── Build app ────────────────────────────────────────────────────────────────
async function buildApp(): Promise<{
  fastify: FastifyInstance;
  io: SocketIOServer;
}> {
  const fastify = Fastify({
    logger: {
      level: IS_PROD ? 'warn' : 'info',
      ...(IS_PROD
        ? {}
        : {
            transport: {
              target: 'pino-pretty',
              options: { colorize: true },
            },
          }),
    },
    trustProxy: true, // Railway sits behind a proxy
  });

  // ── Security headers ────────────────────────────────────────────────────────
  await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: false, // Handled by mobile client
  });

  // ── CORS ────────────────────────────────────────────────────────────────────
  await fastify.register(fastifyCors, {
    origin: IS_PROD ? [FRONTEND_URL] : true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // ── Rate limiting ───────────────────────────────────────────────────────────
  await fastify.register(fastifyRateLimit, {
    global: true,
    max: 100,
    timeWindow: '1 minute',
    // Note: @upstash/redis is REST-based and not ioredis-compatible.
    // Rate-limit counters are stored in-memory (sufficient for single-instance).
    keyGenerator: (req) =>
      (req.headers['x-forwarded-for'] as string) ?? req.ip,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Retry after ${context.after}.`,
    }),
  });

  // ── JWT ─────────────────────────────────────────────────────────────────────
  await fastify.register(fastifyJwt, {
    secret: process.env.JWT_SECRET!,
    sign: { expiresIn: '7d' },
  });

  // ── Health check (no auth, no rate-limit) ───────────────────────────────────
  fastify.get('/health', { config: { rateLimit: false } }, async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  }));

  // ── API routes ──────────────────────────────────────────────────────────────
  await fastify.register(authRoutes,   { prefix: '/api/v1/auth' });
  await fastify.register(gameRoutes,   { prefix: '/api/v1/games' });
  await fastify.register(walletRoutes, { prefix: '/api/v1/wallet' });
  await fastify.register(adminRoutes,  { prefix: '/api/v1/admin' });
  await fastify.register(registerAgentRoutes, { prefix: '/api/v1' });

  // ── Global error handler ────────────────────────────────────────────────────
  fastify.setErrorHandler((err, req, reply) => {
    fastify.log.error({ err, url: req.url }, 'Unhandled error');

    const statusCode = (err as Error & { statusCode?: number }).statusCode ?? 500;
    const name = (err as Error).name ?? 'InternalServerError';
    const message = (err as Error).message ?? 'An unexpected error occurred.';

    // Report 5xx errors to Sentry (not client errors)
    if (statusCode >= 500) {
      Sentry.withScope((scope) => {
        scope.setTag('url', req.url);
        scope.setTag('method', req.method);
        Sentry.captureException(err);
      });
    }

    reply.status(statusCode).send({
      statusCode,
      error: name,
      message: IS_PROD && statusCode === 500 ? 'An unexpected error occurred.' : message,
    });
  });

  // ── 404 handler ─────────────────────────────────────────────────────────────
  fastify.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Route not found' });
  });

  // ── Socket.io (attached to the raw HTTP server) ─────────────────────────────
  const httpServer = createServer(fastify.server);
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: IS_PROD ? [FRONTEND_URL] : '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 30000,
    pingInterval: 10000,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerGameSocket(io as any);

  return { fastify, io };
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function start(): Promise<void> {
  // Validate external connections before accepting traffic
  try {
    const { error } = await supabase.from('users').select('id').limit(1);
    if (error) throw error;
    console.log('[boot] Supabase ✓');
  } catch (err) {
    console.error('[FATAL] Supabase connection failed:', err);
    process.exit(1);
  }

  try {
    await redis.ping();
    console.log('[boot] Upstash Redis ✓');
  } catch (err) {
    console.error('[FATAL] Redis connection failed:', err);
    process.exit(1);
  }

  try {
    initFirebase();
    console.log('[boot] Firebase Admin ✓');
  } catch (err) {
    console.error('[FATAL] Firebase init failed:', err);
    process.exit(1);
  }

  const { fastify } = await buildApp();

  await fastify.listen({ port: PORT, host: HOST });
  console.log(`[boot] Server listening on ${HOST}:${PORT} (${process.env.NODE_ENV ?? 'development'})`);

  try {
    await initializeAgentSystem();
    console.log('[boot] Agent system ✓');
  } catch (err) {
    console.error('[agents] Failed to initialize agent system:', err);
    // Non-fatal — game still runs without background agents
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
  console.log('[shutdown] SIGTERM received — closing server');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[shutdown] SIGINT received — closing server');
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  Sentry.captureException(reason);
  process.exit(1);
});

start();
