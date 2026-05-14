import type { FastifyInstance } from 'fastify';
import { supabase } from '../services/supabase';
import { requireAuth } from '../middleware/auth';
import { assignSessionCode, releaseCode } from '../services/sessionService';
import type { Device, DevicePlatform } from '../types/models';

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/devices — list all devices (agents/admin)
  app.get('/', { preHandler: requireAuth }, async (_request, reply) => {
    const { data, error } = await supabase
      .from('devices')
      .select('*')
      .order('last_seen', { ascending: false });

    if (error) return reply.status(500).send({ error: 'Failed to fetch devices' });
    return reply.send({ devices: (data ?? []) as Device[] });
  });

  // POST /api/devices/register — called by desktop/mobile agent on startup
  app.post<{
    Body: {
      name: string;
      platform: DevicePlatform;
      os_version: string;
      agent_version: string;
    };
  }>('/register', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'platform', 'os_version', 'agent_version'],
        properties: {
          name: { type: 'string' },
          platform: { type: 'string', enum: ['windows', 'mac', 'linux', 'android', 'ios'] },
          os_version: { type: 'string' },
          agent_version: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { name, platform, os_version, agent_version } = request.body;
    const ip_address = request.ip ?? null;

    const { data: device, error } = await supabase
      .from('devices')
      .insert({
        name,
        platform,
        os_version,
        agent_version,
        status: 'online',
        ip_address,
        session_code: null,
        last_seen: new Date().toISOString(),
      })
      .select()
      .single();

    if (error || !device) return reply.status(500).send({ error: 'Failed to register device' });

    const d = device as Device;
    const code = await assignSessionCode(d.id);
    return reply.status(201).send({ device: d, session_code: code });
  });

  // PUT /api/devices/:id/heartbeat — agent sends every 30s to stay "online"
  app.put<{ Params: { id: string } }>('/:id/heartbeat', async (request, reply) => {
    const { id } = request.params;

    const { error } = await supabase
      .from('devices')
      .update({ last_seen: new Date().toISOString(), status: 'online' } as Partial<Device>)
      .eq('id', id);

    if (error) return reply.status(404).send({ error: 'Device not found' });
    return reply.send({ ok: true });
  });

  // DELETE /api/devices/:id — device disconnects / agent uninstalled
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;

    const { data: device } = await supabase
      .from('devices')
      .select('session_code')
      .eq('id', id)
      .single();

    const d = device as Pick<Device, 'session_code'> | null;
    if (d?.session_code) {
      releaseCode(d.session_code);
    }

    await supabase
      .from('devices')
      .update({ status: 'offline', session_code: null } as Partial<Device>)
      .eq('id', id);

    return reply.send({ ok: true });
  });
}
