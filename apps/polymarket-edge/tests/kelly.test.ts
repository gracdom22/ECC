import { describe, expect, it } from 'vitest';
import { kellyFraction, sizeStake, type SizingLimits } from '../src/math/kelly.js';

const limits: SizingLimits = { kellyMultiplier: 0.25, maxStakePct: 0.02, maxStakeUsd: 25, minStakeUsd: 1 };

describe('kellyFraction', () => {
  it('matches (p - c) / (1 - c) for a binary share', () => {
    expect(kellyFraction(0.6, 0.5)).toBeCloseTo(0.2, 12);
    expect(kellyFraction(0.3, 0.2)).toBeCloseTo(0.125, 12);
  });

  it('is equivalent to the classic (bp - q) / b form', () => {
    const p = 0.55;
    const c = 0.48;
    const b = (1 - c) / c;
    expect(kellyFraction(p, c)).toBeCloseTo((b * p - (1 - p)) / b, 12);
  });

  it('never bets without an edge', () => {
    expect(kellyFraction(0.5, 0.5)).toBe(0);
    expect(kellyFraction(0.4, 0.5)).toBe(0);
    expect(kellyFraction(0.5, 0)).toBe(0);
    expect(kellyFraction(0.5, 1)).toBe(0);
  });
});

describe('sizeStake', () => {
  it('applies the Kelly multiplier when it is the binding constraint', () => {
    const r = sizeStake({ fairProb: 0.52, cost: 0.5, bankroll: 1000, available: 1000 }, limits);
    expect(r.fullKelly).toBeCloseTo(0.04, 12);
    expect(r.stake).toBe(10);
    expect(r.cappedBy).toBe('kelly');
  });

  it('caps at max % of bankroll', () => {
    const r = sizeStake({ fairProb: 0.7, cost: 0.5, bankroll: 1000, available: 1000 }, limits);
    expect(r.stake).toBe(20);
    expect(r.cappedBy).toBe('max_pct');
  });

  it('caps at max USD', () => {
    const r = sizeStake({ fairProb: 0.7, cost: 0.5, bankroll: 10_000, available: 10_000 }, limits);
    expect(r.stake).toBe(25);
    expect(r.cappedBy).toBe('max_usd');
  });

  it('caps at the cash available after exposure limits', () => {
    const r = sizeStake({ fairProb: 0.7, cost: 0.5, bankroll: 1000, available: 7.459 }, limits);
    expect(r.stake).toBe(7.45);
    expect(r.cappedBy).toBe('available');
  });

  it('returns zero below the minimum stake or without edge', () => {
    expect(sizeStake({ fairProb: 0.501, cost: 0.5, bankroll: 1000, available: 1000 }, limits)).toMatchObject({ stake: 0, cappedBy: 'below_min' });
    expect(sizeStake({ fairProb: 0.45, cost: 0.5, bankroll: 1000, available: 1000 }, limits)).toMatchObject({ stake: 0, cappedBy: 'no_edge' });
    expect(sizeStake({ fairProb: 0.7, cost: 0.5, bankroll: 0, available: 0 }, limits).stake).toBe(0);
  });
});
