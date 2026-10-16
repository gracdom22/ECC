import { feePerShare, type FeeSchedule } from '../math/edge.js';
import type { OrderLevel } from '../types.js';

export interface SimulatedFill {
  shares: number;
  /** Volume-weighted average share price, excluding fees. */
  avgPrice: number;
  fees: number;
  /** Total USD spent including fees. */
  cost: number;
  worstPrice: number;
  levels: number;
}

/**
 * Walks the ask side like a marketable limit order: buys cheapest levels first,
 * never paying more than `maxCostPerShare` (price + fee) and never spending more than `budget`.
 */
export function simulateBuy(asks: readonly OrderLevel[], budget: number, fees: FeeSchedule, maxCostPerShare = 1): SimulatedFill | null {
  let remaining = budget;
  let shares = 0;
  let spentPrice = 0;
  let spentFees = 0;
  let worstPrice = 0;
  let levels = 0;
  for (const level of [...asks].sort((a, b) => a.price - b.price)) {
    if (remaining <= 1e-9) break;
    const fee = feePerShare(level.price, fees);
    const unitCost = level.price + fee;
    if (unitCost > maxCostPerShare) break;
    const take = Math.min(level.size, remaining / unitCost);
    if (take <= 0) continue;
    shares += take;
    spentPrice += take * level.price;
    spentFees += take * fee;
    remaining -= take * unitCost;
    worstPrice = level.price;
    levels++;
  }
  if (shares <= 0) return null;
  return {
    shares,
    avgPrice: spentPrice / shares,
    fees: spentFees,
    cost: spentPrice + spentFees,
    worstPrice,
    levels,
  };
}
