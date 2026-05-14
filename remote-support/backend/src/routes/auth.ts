import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { supabase } from '../services/supabase';
import type { User } from '../types/models';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/auth/register
  app.post<{
    Body: { email: string; password: string; name: string };
  }>('/register', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password', 'name'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
          name: { type: 'string', minLength: 1 },
        },
      },
    },
  }, async (request, reply) => {
    const { email, password, name } = request.body;

    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existing) {
      return reply.status(409).send({ error: 'Email already registered' });
    }

    const password_hash = await bcrypt.hash(password, 12);

    const { data: user, error } = await supabase
      .from('users')
      .insert({ email, password_hash, name, role: 'agent' })
      .select('id, email, name, role')
      .single();

    if (error || !user) {
      return reply.status(500).send({ error: 'Failed to create account' });
    }

    const u = user as Pick<User, 'id' | 'email' | 'name' | 'role'>;
    const token = app.jwt.sign({ id: u.id, email: u.email, role: u.role }, { expiresIn: '7d' });
    return reply.send({ token, user: { id: u.id, email: u.email, name: u.name, role: u.role } });
  });

  // POST /api/auth/login
  app.post<{
    Body: { email: string; password: string };
  }>('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string' },
          password: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { email, password } = request.body;

    const { data: user } = await supabase
      .from('users')
      .select('id, email, name, role, password_hash')
      .eq('email', email)
      .single();

    if (!user) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const u = user as User;
    const valid = await bcrypt.compare(password, u.password_hash);
    if (!valid) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    const token = app.jwt.sign({ id: u.id, email: u.email, role: u.role }, { expiresIn: '7d' });
    return reply.send({ token, user: { id: u.id, email: u.email, name: u.name, role: u.role } });
  });

  // GET /api/auth/me
  app.get('/me', {
    preHandler: async (request, reply) => {
      try { await request.jwtVerify(); } catch { reply.status(401).send({ error: 'Unauthorized' }); }
    },
  }, async (request, reply) => {
    const payload = request.user as { id: string };
    const { data: user } = await supabase
      .from('users')
      .select('id, email, name, role')
      .eq('id', payload.id)
      .single();

    if (!user) return reply.status(404).send({ error: 'User not found' });
    const u = user as Pick<User, 'id' | 'email' | 'name' | 'role'>;
    return reply.send({ user: u });
  });
}
