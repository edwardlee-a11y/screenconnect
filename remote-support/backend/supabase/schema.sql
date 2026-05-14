-- Remote Support — Supabase Schema
-- Run this in the Supabase SQL editor to create all tables

-- ── Users (agents / admins) ──────────────────────────────────────────────────
create table if not exists public.users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  name          text not null,
  role          text not null default 'agent' check (role in ('admin', 'agent')),
  created_at    timestamptz not null default now()
);

-- ── Devices ──────────────────────────────────────────────────────────────────
create table if not exists public.devices (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  platform      text not null check (platform in ('windows', 'mac', 'linux', 'android', 'ios')),
  os_version    text not null,
  agent_version text not null,
  status        text not null default 'offline' check (status in ('online', 'offline', 'in_session')),
  ip_address    text,
  session_code  text unique,
  last_seen     timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists devices_status_idx on public.devices(status);
create index if not exists devices_last_seen_idx on public.devices(last_seen desc);

-- ── Sessions ─────────────────────────────────────────────────────────────────
create table if not exists public.sessions (
  id               uuid primary key default gen_random_uuid(),
  device_id        uuid not null references public.devices(id) on delete cascade,
  agent_id         uuid references public.users(id) on delete set null,
  type             text not null check (type in ('view_only', 'full_control')),
  status           text not null default 'active' check (status in ('active', 'ended', 'failed')),
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  duration_seconds integer
);

create index if not exists sessions_device_idx on public.sessions(device_id);
create index if not exists sessions_status_idx on public.sessions(status);
create index if not exists sessions_started_idx on public.sessions(started_at desc);

-- ── Session events (audit log) ────────────────────────────────────────────────
create table if not exists public.session_events (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  event_type text not null,
  data       jsonb not null default '{}',
  timestamp  timestamptz not null default now()
);

create index if not exists events_session_idx on public.session_events(session_id);

-- ── Row Level Security ────────────────────────────────────────────────────────
-- We use service role key from backend so RLS is not enforced for our server,
-- but enabling it protects against accidental direct client access.

alter table public.users enable row level security;
alter table public.devices enable row level security;
alter table public.sessions enable row level security;
alter table public.session_events enable row level security;

-- Service role bypasses RLS — no policies needed for backend access.
-- Add policies here if you ever expose tables to the anon/authenticated Supabase client.
