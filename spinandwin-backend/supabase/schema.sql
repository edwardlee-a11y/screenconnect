-- ============================================================
-- Spin & Win — Supabase PostgreSQL Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- Safe to re-run: all statements are idempotent.
-- ============================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ─── USERS ────────────────────────────────────────────────────────────────────
create table if not exists public.users (
  id                 text        primary key,          -- Firebase UID
  email              text        not null unique,
  username           text        not null unique,
  wallet_address     text        unique,
  balance_usd        numeric(12,2) not null default 0,
  balance_spin       numeric(18,8) not null default 0, -- SPIN token balance
  total_spins        integer     not null default 0,
  total_wins         integer     not null default 0,
  total_wagered_usd  numeric(12,2) not null default 0,
  is_banned          boolean     not null default false,
  kyc_verified       boolean     not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Auto-update updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_updated_at on public.users;
create trigger users_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- ─── GAME SESSIONS ────────────────────────────────────────────────────────────
create table if not exists public.game_sessions (
  id                 uuid        primary key default gen_random_uuid(),
  user_id            text        not null references public.users(id) on delete cascade,
  status             text        not null default 'active'
                                 check (status in ('active', 'completed', 'expired')),
  total_spins        integer     not null default 0,
  total_wagered_usd  numeric(12,2) not null default 0,
  total_payout_usd   numeric(12,2) not null default 0,
  started_at         timestamptz not null default now(),
  ended_at           timestamptz
);

create index if not exists idx_game_sessions_user_id on public.game_sessions(user_id);
create index if not exists idx_game_sessions_status  on public.game_sessions(status);

-- ─── SPIN RESULTS ─────────────────────────────────────────────────────────────
create table if not exists public.spin_results (
  id               uuid        primary key default gen_random_uuid(),
  user_id          text        not null references public.users(id) on delete cascade,
  session_id       uuid        not null references public.game_sessions(id) on delete cascade,
  wager_usd        numeric(12,2) not null,
  outcome_index    smallint    not null check (outcome_index between 0 and 11),
  outcome_label    text        not null,
  multiplier       numeric(8,2) not null,
  payout_usd       numeric(12,2) not null,
  server_seed_hash text        not null,   -- SHA-256 of server seed (provably fair)
  client_seed      text        not null,
  nonce            integer     not null,
  tx_hash          text,                   -- Polygon tx hash (nullable until on-chain)
  created_at       timestamptz not null default now()
);

create index if not exists idx_spin_results_user_id    on public.spin_results(user_id);
create index if not exists idx_spin_results_session_id on public.spin_results(session_id);
create index if not exists idx_spin_results_created_at on public.spin_results(created_at desc);
create index if not exists idx_spin_results_payout     on public.spin_results(payout_usd desc);

-- ─── TRANSACTIONS ─────────────────────────────────────────────────────────────
create table if not exists public.transactions (
  id           uuid        primary key default gen_random_uuid(),
  user_id      text        not null references public.users(id) on delete cascade,
  type         text        not null check (type in ('deposit','withdrawal','payout','wager','bonus')),
  amount_usd   numeric(12,2) not null,
  status       text        not null default 'pending'
               check (status in ('pending','completed','failed')),
  tx_hash      text,
  metadata     jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists idx_transactions_user_id    on public.transactions(user_id);
create index if not exists idx_transactions_status     on public.transactions(status);
create index if not exists idx_transactions_created_at on public.transactions(created_at desc);

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────────────────────
-- Backend uses service role key (bypasses RLS) so these policies
-- only protect against direct client access / accidental anon key use.

alter table public.users         enable row level security;
alter table public.game_sessions enable row level security;
alter table public.spin_results  enable row level security;
alter table public.transactions  enable row level security;

-- Drop policies before recreating (no IF NOT EXISTS for policies in older PG)
drop policy if exists "users: read own"    on public.users;
drop policy if exists "sessions: read own" on public.game_sessions;
drop policy if exists "spins: read own"    on public.spin_results;
drop policy if exists "transactions: read own" on public.transactions;

create policy "users: read own"
  on public.users for select
  using (auth.uid()::text = id);

create policy "sessions: read own"
  on public.game_sessions for select
  using (auth.uid()::text = user_id);

create policy "spins: read own"
  on public.spin_results for select
  using (auth.uid()::text = user_id);

create policy "transactions: read own"
  on public.transactions for select
  using (auth.uid()::text = user_id);

-- ─── HELPER VIEWS ─────────────────────────────────────────────────────────────

-- Daily leaderboard view
create or replace view public.daily_leaderboard as
  select
    u.username,
    sum(s.payout_usd) as total_payout_usd,
    count(*)          as total_spins,
    max(s.payout_usd) as biggest_win
  from public.spin_results s
  join public.users u on u.id = s.user_id
  where s.created_at >= date_trunc('day', now())
    and s.payout_usd > 0
  group by u.username
  order by total_payout_usd desc
  limit 20;

-- All-time leaderboard view
create or replace view public.alltime_leaderboard as
  select
    u.username,
    u.total_wins,
    u.total_spins,
    u.total_wagered_usd,
    max(s.payout_usd) as biggest_win
  from public.users u
  left join public.spin_results s on s.user_id = u.id
  group by u.id, u.username, u.total_wins, u.total_spins, u.total_wagered_usd
  order by u.total_wins desc
  limit 50;
