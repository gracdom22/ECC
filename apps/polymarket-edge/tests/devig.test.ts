import { describe, expect, it } from 'vitest';
import { devig, impliedProbabilities } from '../src/math/devig.js';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('impliedProbabilities', () => {
  it('inverts decimal odds', () => {
    expect(impliedProbabilities([2, 4])).toEqual([0.5, 0.25]);
  });

  it('rejects invalid odds and single outcomes', () => {
    expect(() => impliedProbabilities([2])).toThrow(/two outcomes/);
    expect(() => impliedProbabilities([1, 2])).toThrow(/Invalid/);
    expect(() => impliedProbabilities([Number.NaN, 2])).toThrow(/Invalid/);
  });
});

describe('devig', () => {
  const twoWay = [1.909, 1.909];
  const favLong = [1.25, 4.2];
  const soccer = [2.6, 3.4, 2.9];

  it.each(['multiplicative', 'power', 'shin'] as const)('%s returns probabilities that sum to 1', (method) => {
    for (const odds of [twoWay, favLong, soccer]) {
      const r = devig(odds, method);
      expect(sum(r.fair)).toBeCloseTo(1, 9);
      expect(r.fair.every((p) => p > 0 && p < 1)).toBe(true);
      expect(r.method).toBe(method);
    }
  });

  it('splits a symmetric market 50/50 for every method', () => {
    for (const method of ['multiplicative', 'power', 'shin'] as const) {
      const r = devig(twoWay, method);
      expect(r.fair[0]).toBeCloseTo(0.5, 9);
      expect(r.overround).toBeCloseTo(2 / 1.909 - 1, 9);
    }
  });

  it('multiplicative normalises implied probabilities proportionally', () => {
    const r = devig([1.5, 2.6], 'multiplicative');
    const implied = [1 / 1.5, 1 / 2.6];
    const total = implied[0]! + implied[1]!;
    expect(r.fair[0]).toBeCloseTo(implied[0]! / total, 12);
  });

  it('power and shin give the favourite more probability than multiplicative (favourite-longshot bias)', () => {
    const m = devig(favLong, 'multiplicative').fair[0]!;
    expect(devig(favLong, 'power').fair[0]!).toBeGreaterThan(m);
    expect(devig(favLong, 'shin').fair[0]!).toBeGreaterThan(m);
  });

  it('falls back to normalisation when there is no margin', () => {
    const r = devig([2, 2], 'shin');
    expect(r.overround).toBeCloseTo(0, 12);
    expect(r.method).toBe('multiplicative');
    expect(r.fair).toEqual([0.5, 0.5]);
  });

  it('defaults to the power method', () => {
    expect(devig(favLong).method).toBe('power');
  });
});
