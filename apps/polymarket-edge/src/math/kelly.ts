/**
 * Full-Kelly fraction for a binary share costing `cost` that pays 1.
 * Net odds b = (1 - cost) / cost, so f* = (b*p - q) / b = (p - cost) / (1 - cost).
 */
export function kellyFraction(fairProb: number, cost: number): number {
  if (cost <= 0 || cost >= 1) return 0;
  const f = (fairProb - cost) / (1 - cost);
  return f > 0 ? f : 0;
}

export interface SizingLimits {
  kellyMultiplier: number;
  maxStakePct: number;
  maxStakeUsd: number;
  minStakeUsd: number;
}

export interface SizingInput {
  fairProb: number;
  cost: number;
  bankroll: number;
  /** Cash available to commit after exposure limits. */
  available: number;
}

export interface SizingResult {
  fullKelly: number;
  stake: number;
  cappedBy: 'kelly' | 'max_pct' | 'max_usd' | 'available' | 'below_min' | 'no_edge';
}

function floorCents(x: number): number {
  return Math.floor(x * 100 + 1e-9) / 100;
}

export function sizeStake(input: SizingInput, limits: SizingLimits): SizingResult {
  const fullKelly = kellyFraction(input.fairProb, input.cost);
  if (fullKelly <= 0 || input.bankroll <= 0) return { fullKelly, stake: 0, cappedBy: 'no_edge' };

  const candidates: Array<[number, SizingResult['cappedBy']]> = [
    [input.bankroll * fullKelly * limits.kellyMultiplier, 'kelly'],
    [input.bankroll * limits.maxStakePct, 'max_pct'],
    [limits.maxStakeUsd, 'max_usd'],
    [Math.max(0, input.available), 'available'],
  ];
  let [stake, cappedBy] = candidates[0]!;
  for (const [value, reason] of candidates.slice(1)) {
    if (value < stake) {
      stake = value;
      cappedBy = reason;
    }
  }
  stake = floorCents(stake);
  if (stake < limits.minStakeUsd) return { fullKelly, stake: 0, cappedBy: 'below_min' };
  return { fullKelly, stake, cappedBy };
}
