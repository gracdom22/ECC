import { describe, expect, it } from 'vitest';
import { computeEdge, effectivePrice, expectedValue, feePerShare, NO_FEES } from '../src/math/edge.js';

const SPORTS_FEES = { rate: 0.05, exponent: 1 };

describe('feePerShare', () => {
  it('follows rate * p * (1 - p)', () => {
    expect(feePerShare(0.5, SPORTS_FEES)).toBeCloseTo(0.0125, 12);
    expect(feePerShare(0.2, SPORTS_FEES)).toBeCloseTo(0.008, 12);
  });

  it('applies the exponent', () => {
    expect(feePerShare(0.5, { rate: 0.1, exponent: 2 })).toBeCloseTo(0.1 * 0.0625, 12);
  });

  it('is zero when fees are disabled', () => {
    expect(feePerShare(0.5, NO_FEES)).toBe(0);
    expect(effectivePrice(0.42, NO_FEES)).toBe(0.42);
  });
});

describe('expectedValue', () => {
  it('is fairProb / cost - 1', () => {
    expect(expectedValue(0.55, 0.5)).toBeCloseTo(0.1, 12);
    expect(expectedValue(0.45, 0.5)).toBeCloseTo(-0.1, 12);
  });

  it('returns -1 for impossible costs', () => {
    expect(expectedValue(0.5, 0)).toBe(-1);
    expect(expectedValue(0.5, 1)).toBe(-1);
  });
});

describe('computeEdge', () => {
  it('includes the taker fee in cost', () => {
    const r = computeEdge(0.55, 0.5, SPORTS_FEES);
    expect(r.fee).toBeCloseTo(0.0125, 12);
    expect(r.cost).toBeCloseTo(0.5125, 12);
    expect(r.edge).toBeCloseTo(0.0375, 12);
    expect(r.ev).toBeCloseTo(0.55 / 0.5125 - 1, 12);
  });

  it('fees can turn a small raw edge negative', () => {
    expect(computeEdge(0.505, 0.5, NO_FEES).ev).toBeGreaterThan(0);
    expect(computeEdge(0.505, 0.5, SPORTS_FEES).ev).toBeLessThan(0);
  });

  it('validates inputs', () => {
    expect(() => computeEdge(1, 0.5, NO_FEES)).toThrow(/fairProb/);
    expect(() => computeEdge(0.5, 0, NO_FEES)).toThrow(/askPrice/);
  });
});
