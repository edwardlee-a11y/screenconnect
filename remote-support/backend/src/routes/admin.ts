import type { FastifyInstance } from 'fastify';
import { supabase } from '../services/supabase';
import { requireAdmin } from '../middleware/auth';
import type { Device, User, UserRole } from '../types/models';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/admin/dashboard — summary stats for admin portal
  app.get('/dashboard', { preHandler: requireAdmin }, async (_request, reply) => {
    const [devicesRes, sessionsRes, activeRes] = await Promise.all([
      supabase.from('devices').select('id, status, platform', { count: 'exact' }),
      supabase.from('sessions').select('id', { count: 'exact' }),
      supabase.from('sessions').select('id', { count: 'exact' }).eq('status', 'active'),
    ]);

    const rows = (devicesRes.data ?? []) as Pick<Device, 'id' | 'status' | 'platform'>[];

    const byPlatform = rows.reduce<Record<string, number>>((acc, d) => {
      acc[d.platform] = (acc[d.platform] ?? 0) + 1;
      return acc;
    }, {});

    const byStatus = rows.reduce<Record<string, number>>((acc, d) => {
      acc[d.status] = (acc[d.status] ?? 0) + 1;
      return acc;
    }, {});

    return reply.send({
      stats: {
        total_devices: devicesRes.count ?? 0,
        total_sessions: sessionsRes.count ?? 0,
        active_sessions: activeRes.count ?? 0,
        devices_by_platform: byPlatform,
        devices_by_status: byStatus,
      },
    });
  });

  // GET /api/admin/devices — all devices with full detail
  app.get('/devices', { preHandler: requireAdmin }, async (_request, reply) => {
    const { data, error } = await supabase
      .from('devices')
      .select('*')
      .order('last_seen', { ascending: false });

    if (error) return reply.status(500).send({ error: 'Failed to fetch devices' });
    return reply.send({ devices: (data ?? []) as Device[] });
  });

  // GET /api/admin/users — all agent accounts
  app.get('/users', { preHandler: requireAdmin }, async (_request, reply) => {
    const { data, error } = await supabase
      .from('users')
      .select('id, email, name, role, created_at')
      .order('created_at', { ascending: false });

    if (error) return reply.status(500).send({ error: 'Failed to fetch users' });
    return reply.send({ users: (data ?? []) as Pick<User, 'id' | 'email' | 'name' | 'role' | 'created_at'>[] });
  });

  // PUT /api/admin/users/:id/role
  app.put<{ Params: { id: string }; Body: { role: UserRole } }>(
    '/users/:id/role',
    { preHandler: requireAdmin },
    async (request, reply) => {
      const { error } = await supabase
        .from('users')
        .update({ role: request.body.role } as Partial<User>)
        .eq('id', request.params.id);

      if (error) return reply.status(500).send({ error: 'Failed to update role' });
      return reply.send({ ok: true });
    },
  );
}
