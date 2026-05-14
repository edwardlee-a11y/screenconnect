import 'dotenv/config';
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyJwt from '@fastify/jwt';
import { Server as SocketServer } from 'socket.io';

import { config } from './config';
import { authRoutes } from './routes/auth';
import { deviceRoutes } from './routes/devices';
import { sessionRoutes } from './routes/sessions';
import { adminRoutes } from './routes/admin';
import { registerSignaling } from './socket/signaling';

async function main(): Promise<void> {
  const app = Fastify({
    logger: { level: config.nodeEnv === 'development' ? 'info' : 'warn' },
  });

  // ── Plugins ────────────────────────────────────────────────────────────────
  await app.register(fastifyHelmet, { contentSecurityPolicy: false });

  await app.register(fastifyCors, {
    origin: config.frontendUrl.split(',').map((o) => o.trim()),
    credentials: true,
  });

  await app.register(fastifyRateLimit, { max: 100, timeWindow: '1 minute' });

  await app.register(fastifyJwt, { secret: config.jwtSecret });

  // ── Routes ─────────────────────────────────────────────────────────────────
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(deviceRoutes, { prefix: '/api/devices' });
  await app.register(sessionRoutes, { prefix: '/api/sessions' });
  await app.register(adminRoutes, { prefix: '/api/admin' });

  app.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }));

  // ── Attach Socket.IO directly to Fastify's HTTP server ───────────────────
  const io = new SocketServer(app.server, {
    cors: {
      origin: config.frontendUrl.split(',').map((o) => o.trim()),
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  registerSignaling(io);

  // ── Start ──────────────────────────────────────────────────────────────────
  await app.listen({ port: config.port, host: '0.0.0.0' });

  console.log(`
====================================
 Remote Support Backend
====================================
 Port : ${config.port}
 Env  : ${config.nodeEnv}
 HTTP : http://localhost:${config.port}
 WS   : ws://localhost:${config.port}
====================================
  `);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
