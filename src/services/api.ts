import Constants from 'expo-constants';
import { useAuthStore } from '../store/authStore';

const BASE_URL = (Constants.expoConfig?.extra?.apiUrl as string) ?? 'http://localhost:3000';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

export interface User {
  id: string;
  email: string;
  username: string;
  walletAddress: string | null;
  balanceUsd: number;
  balanceSpin: number;
  totalSpins: number;
  totalWins: number;
  kycVerified: boolean;
}

export interface SpinResult {
  outcomeIndex: number;
  outcomeLabel: string;
  multiplier: number;
  wagerUsd: number;
  payoutUsd: number;
  netChangeUsd: number;
  newBalanceUsd: number;
  nonce: number;
  serverSeedHash: string;
}

export interface GameSession {
  sessionId: string;
  serverSeedHash: string;
}

export interface WheelSegment {
  index: number;
  label: string;
  multiplier: number;
}

export interface RoomInfo {
  tier: number;
  playerCount: number;
  isReady: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  username: string;
  payoutUsd: number;
}

// ─── Core fetch wrapper ────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const token = useAuthStore.getState().token;

  const headers: Record<string, string> = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> ?? {}),
  };

  try {
    const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
    const json = await res.json();

    if (!res.ok) {
      return { data: null, error: json.message ?? `HTTP ${res.status}` };
    }

    return { data: json as T, error: null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error';
    return { data: null, error: msg };
  }
}

// ─── Auth API ──────────────────────────────────────────────────────────────

export const roomsApi = {
  getRooms: () =>
    apiFetch<{ rooms: RoomInfo[] }>('/api/v1/games/rooms'),
};

export const authApi = {
  login: (firebaseToken: string, username?: string) =>
    apiFetch<{ token: string; user: User }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ firebaseToken, username }),
    }),

  logout: () =>
    apiFetch<{ message: string }>('/api/v1/auth/logout', { method: 'POST' }),

  updateProfile: (username: string) =>
    apiFetch<{ username: string }>('/api/v1/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify({ username }),
    }),

  me: () =>
    apiFetch<{ user: User }>('/api/v1/auth/me'),

  refresh: () =>
    apiFetch<{ token: string }>('/api/v1/auth/refresh', { method: 'POST' }),
};

// ─── Game API ──────────────────────────────────────────────────────────────

export const gameApi = {
  getWheelConfig: () =>
    apiFetch<{ segments: WheelSegment[]; minWager: number; maxWager: number }>(
      '/api/v1/games/wheel-config',
    ),

  startSession: () =>
    apiFetch<GameSession>('/api/v1/games/session/start', { method: 'POST' }),

  spin: (wagerUsd: number, clientSeed: string) =>
    apiFetch<SpinResult>('/api/v1/games/spin', {
      method: 'POST',
      body: JSON.stringify({ wagerUsd, clientSeed }),
    }),

  endSession: () =>
    apiFetch<{ sessionId: string; serverSeed: string }>(
      '/api/v1/games/session/end',
      { method: 'POST' },
    ),

  getHistory: (page = 1, limit = 20) =>
    apiFetch<{ spins: SpinResult[]; pagination: { total: number; totalPages: number } }>(
      `/api/v1/games/history?page=${page}&limit=${limit}`,
    ),

  getLeaderboard: () =>
    apiFetch<{ leaderboard: LeaderboardEntry[] }>('/api/v1/games/leaderboard'),
};

// ─── Wallet API ────────────────────────────────────────────────────────────

export const walletApi = {
  getNonce: (address: string) =>
    apiFetch<{ nonce: string; message: string }>(
      `/api/v1/wallet/nonce?address=${address}`,
    ),

  connect: (address: string, signature: string) =>
    apiFetch<{ message: string; address: string }>('/api/v1/wallet/connect', {
      method: 'POST',
      body: JSON.stringify({ address, signature }),
    }),

  disconnect: () =>
    apiFetch<{ message: string }>('/api/v1/wallet/disconnect', { method: 'DELETE' }),

  getBalance: () =>
    apiFetch<{ inApp: { balanceUsd: number; balanceSpin: number }; walletAddress: string | null }>(
      '/api/v1/wallet/balance',
    ),

  withdraw: (amountUsd: number) =>
    apiFetch<{ txHash: string; netAmountUsd: number; polygonscanUrl: string }>(
      '/api/v1/wallet/withdraw',
      { method: 'POST', body: JSON.stringify({ amountUsd }) },
    ),

  getTransactions: (page = 1) =>
    apiFetch<{ transactions: unknown[]; pagination: unknown }>(
      `/api/v1/wallet/transactions?page=${page}`,
    ),

  getDepositAddress: () =>
    apiFetch<{ address: string }>('/api/v1/wallet/deposit-address'),

  checkDeposit: () =>
    apiFetch<{ credited: number; newBalance: number; message: string }>(
      '/api/v1/wallet/check-deposit',
      { method: 'POST' },
    ),
};
