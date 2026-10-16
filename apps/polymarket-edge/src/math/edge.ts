export interface FeeSchedule {
  /** Polymarket `feeSchedule.rate` (e.g. 0.05). 0 when fees are disabled. */
  rate: number;
  /** Polymarket `feeSchedule.exponent` (usually 1). */
  exponent: number;
}

export const NO_FEES: FeeSchedule = { rate: 0, exponent: 1 };

/**
 * Taker fee per share bought at `price`, per Polymarket docs:
 * fee = shares * rate * (p * (1 - p)) ^ exponent
 */
export function feePerShare(price: number, fees: FeeSchedule): number {
  if (fees.rate <= 0) return 0;
  return fees.rate * (price * (1 - price)) ** fees.exponent;
}

/** All-in cost of one share that pays $1 if it wins. */
export function effectivePrice(price: number, fees: FeeSchedule): number {
  return price + feePerShare(price, fees);
}

/** Expected profit per $1 staked: p / cost - 1. */
export function expectedValue(fairProb: number, cost: number): number {
  if (cost <= 0 || cost >= 1) return -1;
  return fairProb / cost - 1;
}

export interface EdgeResult {
  fee: number;
  cost: number;
  /** Probability points: fairProb - cost. */
  edge: number;
  /** Expected return per $1 staked. */
  ev: number;
}

export function computeEdge(fairProb: number, askPrice: number, fees: FeeSchedule): EdgeResult {
  if (!(fairProb > 0 && fairProb < 1)) throw new Error(`fairProb out of range: ${fairProb}`);
  if (!(askPrice > 0 && askPrice < 1)) throw new Error(`askPrice out of range: ${askPrice}`);
  const fee = feePerShare(askPrice, fees);
  const cost = askPrice + fee;
  return { fee, cost, edge: fairProb - cost, ev: expectedValue(fairProb, cost) };
}
