import type { FastifyInstance } from 'fastify';
import { supabase } from '../services/supabase';
import { requireAuth } from '../middleware/auth';

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/sessions — session history
  app.get('/', { preHandler: requireAuth }, async (request, reply) => {
    const query = request.query as { limit?: string; offset?: string; device_id?: string };
    const limit = Math.min(parseInt(query.limit ?? '50', 10), 200);
    const offset = parseInt(query.offset ?? '0', 10);

    let q = supabase
      .from('sessions')
      .select('*, devices(name, platform)')
      .order('started_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (query.device_id) {
      q = q.eq('device_id', query.device_id);
    }

    const { data, error } = await q;
    if (error) return reply.status(500).send({ error: 'Failed to fetch sessions' });
    return reply.send({ sessions: data });
  });

  // GET /api/sessions/:id
  app.get<{ Params: { id: string } }>('/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { data, error } = await supabase
      .from('sessions')
      .select('*, devices(name, platform, os_version), session_events(*)')
      .eq('id', request.params.id)
      .single();

    if (error || !data) return reply.status(404).send({ error: 'Session not found' });
    return reply.send({ session: data });
  });
}
