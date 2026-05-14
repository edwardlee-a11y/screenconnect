import type { FastifyRequest, FastifyReply } from 'fastify';

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    reply.status(401).send({ error: 'Unauthorized' });
  }
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
    const payload = request.user as { role: string };
    if (payload.role !== 'admin') {
      reply.status(403).send({ error: 'Admin access required' });
    }
  } catch {
    reply.status(401).send({ error: 'Unauthorized' });
  }
}
