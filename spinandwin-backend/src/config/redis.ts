import { Redis } from '@upstash/redis';

// ─── Client singleton ──────────────────────────────────────────────────────
// Upstash Redis is HTTP-based — no persistent TCP connection needed.
// Works perfectly on serverless/Railway where long-lived connections are unreliable.

let _redis: Redis | null = null;

function createRedisClient(): Redis {
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;

  if (!url || !token) {
    throw new Error(
      '[redis] UPSTASH_REDIS_URL and UPSTASH_REDIS_TOKEN must be set',
    );
  }

  return new Redis({ url, token });
}

export function getRedis(): Redis {
  if (!_redis) {
    _redis = createRedisClient();
  }
  return _redis;
}

export const redis = getRedis();

// ─── TTL constants (seconds) ───────────────────────────────────────────────
export const TTL = {
  SESSION: 60 * 60 * 24 * 7,   // 7 days  — game sessions
  USER_CACHE: 60 * 5,           // 5 min   — cached user profile
  RATE_LIMIT: 60,               // 1 min   — rate limit windows
  NONCE: 60 * 10,               // 10 min  — wallet sign nonces
  LEADERBOARD: 60 * 60,         // 1 hour  — leaderboard cache
  SERVER_SEED: 60 * 60 * 24,    // 24 hrs  — unrevealed server seeds
} as const;

// ─── Key builders ──────────────────────────────────────────────────────────
// Centralised key schema — prevents typos and collisions across the codebase.

export const Keys = {
  // Auth
  userSession: (uid: string) => `session:${uid}`,
  walletNonce: (address: string) => `nonce:${address.toLowerCase()}`,
  blacklistedToken: (jti: string) => `blacklist:${jti}`,

  // Game
  activeSession: (uid: string) => `game:session:${uid}`,
  serverSeed: (sessionId: string) => `seed:${sessionId}`,
  spinLock: (uid: string) => `lock:spin:${uid}`,        // Prevents double-spin

  // Leaderboard (sorted sets)
  leaderboardDaily: () => `lb:daily:${new Date().toISOString().slice(0, 10)}`,
  leaderboardAllTime: () => `lb:alltime`,

  // Rate limiting
  rateLimitSpin: (uid: string) => `rl:spin:${uid}`,     // Max spins/min per user

  // Rooms — tracks connected players per tier
  roomPlayers: (tier: number) => `room:${tier}:players`,

  // Push notifications — Expo push token per user
  pushToken: (uid: string) => `push:token:${uid}`,
} as const;

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Acquire a short-lived Redis lock to prevent race conditions (e.g. double-spin).
 * Returns true if lock acquired, false if already locked.
 */
export async function acquireLock(
  key: string,
  ttlSeconds: number = 5,
): Promise<boolean> {
  // SET key value NX EX ttl — atomic, returns 'OK' or null
  const result = await redis.set(key, '1', { nx: true, ex: ttlSeconds });
  return result === 'OK';
}

/**
 * Release a Redis lock early (e.g. after spin completes).
 */
export async function releaseLock(key: string): Promise<void> {
  await redis.del(key);
}

/**
 * Cache a value with automatic JSON serialization.
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> {
  await redis.set(key, JSON.stringify(value), { ex: ttlSeconds });
}

/**
 * Retrieve and deserialize a cached value.
 * Returns null on cache miss.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await redis.get<string>(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Invalidate one or more cache keys.
 */
export async function cacheDel(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await redis.del(...keys);
}
