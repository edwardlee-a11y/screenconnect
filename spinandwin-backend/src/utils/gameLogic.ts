import { createHmac, randomBytes } from 'node:crypto';

export interface WheelSegment {
  label: string;
  multiplier: number;
  weight: number;
}

export const WHEEL: WheelSegment[] = [
  { label: 'LOSE',    multiplier: 0,   weight: 280 },
  { label: 'LOSE',    multiplier: 0,   weight: 200 },
  { label: '1.2x',   multiplier: 1.2, weight: 150 },
  { label: '1.5x',   multiplier: 1.5, weight: 120 },
  { label: 'LOSE',    multiplier: 0,   weight: 80  },
  { label: '2x',     multiplier: 2,   weight: 60  },
  { label: '1.2x',   multiplier: 1.2, weight: 40  },
  { label: '3x',     multiplier: 3,   weight: 30  },
  { label: '2x',     multiplier: 2,   weight: 20  },
  { label: '5x',     multiplier: 5,   weight: 12  },
  { label: '10x',    multiplier: 10,  weight: 5   },
  { label: 'JACKPOT', multiplier: 50, weight: 3   },
];

export const WHEEL_TOTAL_WEIGHT = WHEEL.reduce((sum, s) => sum + s.weight, 0); // 1000

export const MIN_WAGER_USD  = 0.10;
export const MAX_WAGER_USD  = 10_000.00;
export const ROOM_TIERS     = [5, 25, 50, 100, 200, 500, 1000, 5000, 10000];
export const MIN_PLAYERS    = 2;
export const MAX_PLAYERS    = 5;

export function generateServerSeed(): string {
  return randomBytes(32).toString('hex');
}

export function hashServerSeed(seed: string): string {
  return createHmac('sha256', seed).digest('hex');
}

/**
 * Deterministic, provably-fair outcome.
 * Client verifies after server seed is revealed at session end.
 */
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
  for (let i = 0; i < WHEEL.length; i++) {
    cumulative += WHEEL[i].weight;
    if (roll < cumulative) return i;
  }
  return WHEEL.length - 1;
}

export function calcPayout(wagerUsd: number, segmentIndex: number): number {
  return parseFloat((wagerUsd * WHEEL[segmentIndex].multiplier).toFixed(2));
}
