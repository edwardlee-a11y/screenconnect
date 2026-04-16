import { createHmac, randomBytes } from 'crypto';
import { randomUUID } from 'crypto';
import { supabase } from '../config/supabase';
import { redis, Keys, TTL } from '../config/redis';

// ─── Wheel config (single source of truth) ────────────────────────────────
// Imported by routes/games.ts and socket/gameSocket.ts

export interface WheelSegment {
  index: number;
  label: string;
  multiplier: number;
  weight: number;
}

export const WHEEL: WheelSegment[] = [
  { index: 0,  label: 'LOSE',    multiplier: 0,    weight: 280 },
  { index: 1,  label: 'LOSE',    multiplier: 0,    weight: 200 },
  { index: 2,  label: '1.2x',    multiplier: 1.2,  weight: 150 },
  { index: 3,  label: '1.5x',    multiplier: 1.5,  weight: 120 },
  { index: 4,  label: 'LOSE',    multiplier: 0,    weight: 80  },
  { index: 5,  label: '2x',      multiplier: 2,    weight: 60  },
  { index: 6,  label: '1.2x',    multiplier: 1.2,  weight: 40  },
  { index: 7,  label: '3x',      multiplier: 3,    weight: 30  },
  { index: 8,  label: '2x',      multiplier: 2,    weight: 20  },
  { index: 9,  label: '5x',      multiplier: 5,    weight: 12  },
  { index: 10, label: '10x',     multiplier: 10,   weight: 5   },
  { index: 11, label: 'JACKPOT', multiplier: 50,   weight: 3   },
];

export const WHEEL_TOTAL_WEIGHT = WHEEL.reduce((s, seg) => s + seg.weight, 0);
export const MIN_WAGER_USD = 0.10;
export const MAX_WAGER_USD = 100.00;

// ─── Provably fair helpers ─────────────────────────────────────────────────

export function generateServerSeed(): string {
  return randomBytes(32).toString('hex');
}

export function hashServerSeed(seed: string): string {
  return createHmac('sha256', seed).digest('hex');
}

export function computeOutcome(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): number {
  const hmac = createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}`)
    .digest('hex');

  const roll = parseInt(hmac.slice(0, 8), 16) % WHEEL_TOTAL_WEIGHT;

  let cumulative = 0;
  for (const seg of WHEEL) {
    cumulative += seg.weight;
    if (roll < cumulative) return seg.index;
  }
  return WHEEL.length - 1;
}

// ─── Session management ────────────────────────────────────────────────────

export interface GameSession {
  sessionId: string;
  serverSeedHash: string;
}

export async function startSession(uid: string): Promise<GameSession> {
  const existing = await redis.get(Keys.activeSession(uid));
  if (existing) {
    throw Object.assign(new Error('Active session already exists.'), { statusCode: 409 });
  }

  const sessionId = randomUUID();
  const serverSeed = generateServerSeed();
  const serverSeedHash = hashServerSeed(serverSeed);

  const { error } = await supabase.from('game_sessions').insert({
    id: sessionId,
    user_id: uid,
    status: 'active',
    total_spins: 0,
    total_wagered_usd: 0,
    total_payout_usd: 0,
  });

  if (error) throw Object.assign(new Error('Failed to create session.'), { statusCode: 500 });

  await redis.set(Keys.serverSeed(sessionId), serverSeed, { ex: TTL.SERVER_SEED });
  await redis.set(Keys.activeSession(uid), sessionId, { ex: TTL.SERVER_SEED });

  return { sessionId, serverSeedHash };
}

export async function endSession(
  uid: string,
): Promise<{ sessionId: string; serverSeed: string }> {
  const sessionId = await redis.get<string>(Keys.activeSession(uid));
  if (!sessionId) {
    throw Object.assign(new Error('No active session.'), { statusCode: 400 });
  }

  const serverSeed = await redis.get<string>(Keys.serverSeed(sessionId)) ?? '';

  await supabase
    .from('game_sessions')
    .update({ status: 'completed', ended_at: new Date().toISOString() })
    .eq('id', sessionId);

  await redis.del(Keys.activeSession(uid));
  await redis.del(Keys.serverSeed(sessionId));

  return { sessionId, serverSeed };
}

// ─── Core spin logic ───────────────────────────────────────────────────────

export interface SpinInput {
  uid: string;
  wagerUsd: number;
  clientSeed: string;
}

export interface SpinOutput {
  outcomeIndex: number;
  outcomeLabel: string;
  multiplier: number;
  wagerUsd: number;
  payoutUsd: number;
  netChangeUsd: number;
  newBalanceUsd: number;
  nonce: number;
  serverSeedHash: string;
  spinResultId?: string;
}

export async function executeSpin(input: SpinInput): Promise<SpinOutput> {
  const { uid, wagerUsd, clientSeed } = input;

  const sessionId = await redis.get<string>(Keys.activeSession(uid));
  if (!sessionId) {
    throw Object.assign(new Error('No active session. Call /session/start first.'), { statusCode: 400 });
  }

  const { data: user, error: userErr } = await supabase
    .from('users')
    .select('balance_usd, total_spins')
    .eq('id', uid)
    .single();

  if (userErr || !user) {
    throw Object.assign(new Error('User not found.'), { statusCode: 404 });
  }

  if (user.balance_usd < wagerUsd) {
    throw Object.assign(
      new Error(`Insufficient balance. You have $${user.balance_usd.toFixed(2)}.`),
      { statusCode: 402 },
    );
  }

  const serverSeed = await redis.get<string>(Keys.serverSeed(sessionId));
  if (!serverSeed) {
    throw Object.assign(new Error('Session seed expired. Start a new session.'), { statusCode: 400 });
  }

  const nonce = user.total_spins + 1;
  const outcomeIndex = computeOutcome(serverSeed, clientSeed, nonce);
  const segment = WHEEL[outcomeIndex];
  const payoutUsd = parseFloat((wagerUsd * segment.multiplier).toFixed(2));
  const netChangeUsd = parseFloat((payoutUsd - wagerUsd).toFixed(2));
  const newBalanceUsd = parseFloat((user.balance_usd + netChangeUsd).toFixed(2));
  const serverSeedHash = hashServerSeed(serverSeed);

  // Update user balance + spin count
  await supabase
    .from('users')
    .update({ balance_usd: newBalanceUsd, total_spins: nonce })
    .eq('id', uid);

  // Record spin result
  const { data: spinRecord } = await supabase
    .from('spin_results')
    .insert({
      user_id: uid,
      session_id: sessionId,
      wager_usd: wagerUsd,
      outcome_index: outcomeIndex,
      outcome_label: segment.label,
      multiplier: segment.multiplier,
      payout_usd: payoutUsd,
      server_seed_hash: serverSeedHash,
      client_seed: clientSeed,
      nonce,
      tx_hash: null,
    })
    .select('id')
    .single();

  // Update session totals (fire-and-forget, non-critical)
  supabase
    .from('game_sessions')
    .update({
      total_spins: nonce,
      total_wagered_usd: parseFloat((wagerUsd).toFixed(2)),
      total_payout_usd: payoutUsd,
    })
    .eq('id', sessionId)
    .then(() => {});

  // Update daily leaderboard in Redis
  await redis.zadd(Keys.leaderboardDaily(), { score: payoutUsd, member: uid });

  return {
    outcomeIndex,
    outcomeLabel: segment.label,
    multiplier: segment.multiplier,
    wagerUsd,
    payoutUsd,
    netChangeUsd,
    newBalanceUsd,
    nonce,
    serverSeedHash,
    spinResultId: spinRecord?.id,
  };
}

// ─── Leaderboard ───────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  rank: number;
  username: string;
  payoutUsd: number;
}

export async function getDailyLeaderboard(limit = 20): Promise<LeaderboardEntry[]> {
  const cacheKey = Keys.leaderboardDaily();

  // Get top N from sorted set (score = payout, desc)
  const raw = await redis.zrange(cacheKey, 0, limit - 1, { rev: true, withScores: true });

  if (!raw || raw.length === 0) return [];

  // Resolve uid → username from Supabase
  const uids: string[] = [];
  const scores: Record<string, number> = {};

  for (let i = 0; i < raw.length; i += 2) {
    const uid = raw[i] as string;
    const score = parseFloat(raw[i + 1] as string);
    uids.push(uid);
    scores[uid] = score;
  }

  const { data: users } = await supabase
    .from('users')
    .select('id, username')
    .in('id', uids);

  const usernameMap: Record<string, string> = {};
  for (const u of users ?? []) usernameMap[u.id] = u.username;

  return uids.map((uid, i) => ({
    rank: i + 1,
    username: usernameMap[uid] ?? 'Anonymous',
    payoutUsd: scores[uid],
  }));
}
