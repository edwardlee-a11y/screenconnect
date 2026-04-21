import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  WHEEL,
  WHEEL_TOTAL_WEIGHT,
  generateServerSeed,
  hashServerSeed,
  computeOutcome,
  calcPayout,
  MIN_WAGER_USD,
  MAX_WAGER_USD,
  MIN_PLAYERS,
  MAX_PLAYERS,
} from './gameLogic';

// ─── WHEEL config ──────────────────────────────────────────────────────────────
describe('WHEEL config', () => {
  test('total weight equals 1000', () => {
    assert.strictEqual(WHEEL_TOTAL_WEIGHT, 1000);
  });

  test('has exactly 12 segments', () => {
    assert.strictEqual(WHEEL.length, 12);
  });

  test('JACKPOT is the last segment with 50x multiplier', () => {
    const last = WHEEL[WHEEL.length - 1];
    assert.strictEqual(last.label, 'JACKPOT');
    assert.strictEqual(last.multiplier, 50);
    assert.strictEqual(last.weight, 3);
  });

  test('all multipliers are non-negative', () => {
    for (const seg of WHEEL) {
      assert.ok(seg.multiplier >= 0, `${seg.label} has negative multiplier`);
    }
  });

  test('all weights are positive integers', () => {
    for (const seg of WHEEL) {
      assert.ok(Number.isInteger(seg.weight) && seg.weight > 0, `${seg.label} weight invalid`);
    }
  });

  test('wager bounds are valid', () => {
    assert.ok(MIN_WAGER_USD > 0);
    assert.ok(MAX_WAGER_USD > MIN_WAGER_USD);
  });

  test('MIN_PLAYERS is 2', () => {
    assert.strictEqual(MIN_PLAYERS, 2);
  });

  test('MAX_PLAYERS is 5', () => {
    assert.strictEqual(MAX_PLAYERS, 5);
  });

  test('MIN_PLAYERS is less than MAX_PLAYERS', () => {
    assert.ok(MIN_PLAYERS < MAX_PLAYERS, `MIN_PLAYERS (${MIN_PLAYERS}) must be < MAX_PLAYERS (${MAX_PLAYERS})`);
  });

  test('session can start with 2 players (MIN_PLAYERS)', () => {
    const playerCount = 2;
    assert.ok(playerCount >= MIN_PLAYERS, 'Session should be startable with 2 players');
  });

  test('session is full at 5 players (MAX_PLAYERS)', () => {
    const playerCount = 5;
    assert.ok(playerCount >= MAX_PLAYERS, 'Room should be full at 5 players');
  });
});

// ─── generateServerSeed ────────────────────────────────────────────────────────
describe('generateServerSeed', () => {
  test('returns 64-char hex string', () => {
    const seed = generateServerSeed();
    assert.match(seed, /^[0-9a-f]{64}$/);
  });

  test('generates unique seeds', () => {
    const seeds = new Set(Array.from({ length: 20 }, generateServerSeed));
    assert.strictEqual(seeds.size, 20);
  });
});

// ─── hashServerSeed ────────────────────────────────────────────────────────────
describe('hashServerSeed', () => {
  test('returns 64-char hex string', () => {
    const hash = hashServerSeed(generateServerSeed());
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  test('is deterministic', () => {
    const seed = 'test-seed-abc123';
    assert.strictEqual(hashServerSeed(seed), hashServerSeed(seed));
  });

  test('different seeds produce different hashes', () => {
    assert.notStrictEqual(hashServerSeed('seed-a'), hashServerSeed('seed-b'));
  });

  test('hash differs from original seed', () => {
    const seed = generateServerSeed();
    assert.notStrictEqual(hashServerSeed(seed), seed);
  });
});

// ─── computeOutcome ────────────────────────────────────────────────────────────
describe('computeOutcome', () => {
  test('returns a valid segment index', () => {
    for (let i = 0; i < 50; i++) {
      const idx = computeOutcome(generateServerSeed(), 'client-seed', i);
      assert.ok(idx >= 0 && idx < WHEEL.length, `Index ${idx} out of range`);
    }
  });

  test('is deterministic with same inputs', () => {
    const serverSeed = 'a'.repeat(64);
    const clientSeed = 'myclient';
    const nonce = 7;
    assert.strictEqual(
      computeOutcome(serverSeed, clientSeed, nonce),
      computeOutcome(serverSeed, clientSeed, nonce),
    );
  });

  test('different nonces produce varied outcomes', () => {
    const serverSeed = generateServerSeed();
    const results = new Set<number>();
    for (let n = 0; n < 100; n++) {
      results.add(computeOutcome(serverSeed, 'seed', n));
    }
    assert.ok(results.size > 2, `Expected varied outcomes, got only ${results.size}`);
  });

  test('outcome changes when client seed changes', () => {
    const serverSeed = generateServerSeed();
    const results = new Set<number>();
    for (let i = 0; i < 20; i++) {
      results.add(computeOutcome(serverSeed, `client-${i}`, 1));
    }
    assert.ok(results.size > 1, 'Client seed variation had no effect');
  });

  test('lose rate is roughly 56% ± 5% over 10000 spins', () => {
    const serverSeed = generateServerSeed();
    let loseCount = 0;
    const SAMPLES = 10_000;
    for (let i = 0; i < SAMPLES; i++) {
      const idx = computeOutcome(serverSeed, `c${i}`, i);
      if (WHEEL[idx].multiplier === 0) loseCount++;
    }
    const loseRate = loseCount / SAMPLES;
    assert.ok(loseRate > 0.51 && loseRate < 0.61,
      `Lose rate ${(loseRate * 100).toFixed(1)}% outside expected 51–61% range`);
  });

  test('JACKPOT appears less than 1% of the time over 10000 spins', () => {
    const serverSeed = generateServerSeed();
    let jackpots = 0;
    const SAMPLES = 10_000;
    for (let i = 0; i < SAMPLES; i++) {
      const idx = computeOutcome(serverSeed, `c${i}`, i);
      if (WHEEL[idx].label === 'JACKPOT') jackpots++;
    }
    const rate = jackpots / SAMPLES;
    assert.ok(rate < 0.01, `Jackpot rate ${(rate * 100).toFixed(2)}% is too high`);
  });
});

// ─── calcPayout ────────────────────────────────────────────────────────────────
describe('calcPayout', () => {
  test('LOSE segment returns 0', () => {
    const loseIdx = WHEEL.findIndex(s => s.multiplier === 0);
    assert.strictEqual(calcPayout(100, loseIdx), 0);
  });

  test('JACKPOT returns 50x wager', () => {
    const jackpotIdx = WHEEL.length - 1;
    assert.strictEqual(calcPayout(10, jackpotIdx), 500);
  });

  test('result is rounded to 2 decimal places', () => {
    const twoXIdx = WHEEL.findIndex(s => s.multiplier === 2);
    const payout = calcPayout(0.15, twoXIdx);
    const decimals = payout.toString().split('.')[1]?.length ?? 0;
    assert.ok(decimals <= 2, `Too many decimals: ${payout}`);
  });
});
