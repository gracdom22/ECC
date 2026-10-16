import type { PmMarket } from '../types.js';

export interface SettlementInput {
  shares: number;
  cost: number;
  outcomeIndex: number;
}

export interface Settlement {
  resolutionPrice: number;
  payout: number;
  pnl: number;
}

const VALID_FINAL = [0, 0.5, 1];

function isFinalPrice(p: number): boolean {
  return VALID_FINAL.some((v) => Math.abs(p - v) < 1e-6);
}

/** Only settles once the market is closed with final prices (1/0, or 0.5/0.5 for a cancelled game). */
export function computeSettlement(trade: SettlementInput, market: PmMarket): Settlement | null {
  if (!market.closed) return null;
  const prices = market.outcomePrices;
  if (prices.length < 2 || prices.length !== market.outcomes.length) return null;
  if (!prices.every(isFinalPrice)) return null;
  if (Math.abs(prices.reduce((a, b) => a + b, 0) - 1) > 1e-6) return null;
  const price = prices[trade.outcomeIndex];
  if (price === undefined) return null;
  const resolutionPrice = VALID_FINAL.find((v) => Math.abs(price - v) < 1e-6)!;
  const payout = Math.round(trade.shares * resolutionPrice * 100) / 100;
  return { resolutionPrice, payout, pnl: Math.round((payout - trade.cost) * 100) / 100 };
}
