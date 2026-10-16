import { devig, type DevigMethod } from '../math/devig.js';
import { computeEdge, type EdgeResult } from '../math/edge.js';
import { sizeStake, type SizingLimits } from '../math/kelly.js';
import { selectionFairProb, type GameMatch } from '../matching/match.js';
import type { OrderBook, PmToken } from '../types.js';
import { simulateBuy, type SimulatedFill } from './fill.js';
import type { RiskDecision } from './risk.js';

export interface StrategyConfig {
  devigMethod: DevigMethod;
  /** Min expected return per $1 (e.g. 0.02 = +2% EV). */
  minEdge: number;
  /** EV above this is treated as a data error (bad match, stale price), never traded. */
  maxEdge: number;
  maxSpread: number;
  minMinutesToStart: number;
  maxOddsAgeMin: number;
  paperTradingEnabled: boolean;
  sizing: SizingLimits;
}

export type SignalStatus =
  | 'traded'
  | 'below_threshold'
  | 'suspect_edge'
  | 'stale_odds'
  | 'too_close_to_start'
  | 'not_accepting'
  | 'wide_spread'
  | 'risk_blocked'
  | 'insufficient_liquidity'
  | 'signal_only';

export interface FairBook {
  fair: Map<string, number>;
  overround: number;
  method: DevigMethod;
}

export function fairBookFor(match: GameMatch, method: DevigMethod): FairBook | null {
  const outcomes = match.odds.outcomes;
  const expected = match.game.tokens.some((t) => t.selection.kind === 'draw') ? 3 : 2;
  if (outcomes.length !== expected) return null;
  const names = new Set(outcomes.map((o) => o.name));
  if (names.size !== outcomes.length) return null;
  for (const team of match.teamMap) if (!names.has(team)) return null;
  if (expected === 3 && !names.has('Draw')) return null;
  const result = devig(outcomes.map((o) => o.price), method);
  return { fair: new Map(outcomes.map((o, i) => [o.name, result.fair[i]!])), overround: result.overround, method: result.method };
}

export function tokenFairProb(match: GameMatch, token: PmToken, book: FairBook): number | null {
  const p = selectionFairProb(match, token.selection, book.fair);
  if (p === null) return null;
  return token.negate ? 1 - p : p;
}

export interface Quote {
  bestAsk: number;
  bestBid: number | null;
  edge: EdgeResult;
}

export function quoteFromBook(fairProb: number, token: PmToken, book: OrderBook): Quote | null {
  const ask = book.asks[0];
  if (!ask || fairProb <= 0 || fairProb >= 1) return null;
  return { bestAsk: ask.price, bestBid: book.bids[0]?.price ?? null, edge: computeEdge(fairProb, ask.price, token.fees) };
}

export interface GateContext {
  now: Date;
  gameStart: string;
  bookmakerLastUpdate: string | null;
}

/** Data-quality and timing gates, in order of severity. Returns null when the quote may proceed to sizing. */
export function gateQuote(q: Quote, token: PmToken, ctx: GateContext, cfg: StrategyConfig): { status: SignalStatus; reason: string } | null {
  if (q.edge.ev > cfg.maxEdge) return { status: 'suspect_edge', reason: `EV ${(q.edge.ev * 100).toFixed(1)}% above sanity cap; likely bad match or stale data` };
  if (q.edge.ev < cfg.minEdge) return { status: 'below_threshold', reason: `EV ${(q.edge.ev * 100).toFixed(2)}% below min ${(cfg.minEdge * 100).toFixed(2)}%` };
  if (!token.acceptingOrders) return { status: 'not_accepting', reason: 'market not accepting orders' };
  const minutesToStart = (Date.parse(ctx.gameStart) - ctx.now.getTime()) / 60000;
  if (minutesToStart < cfg.minMinutesToStart) return { status: 'too_close_to_start', reason: `starts in ${minutesToStart.toFixed(0)} min` };
  if (ctx.bookmakerLastUpdate) {
    const age = (ctx.now.getTime() - Date.parse(ctx.bookmakerLastUpdate)) / 60000;
    if (age > cfg.maxOddsAgeMin) return { status: 'stale_odds', reason: `sharp line ${age.toFixed(0)} min old` };
  }
  if (q.bestBid === null || q.bestAsk - q.bestBid > cfg.maxSpread) {
    return { status: 'wide_spread', reason: `spread ${q.bestBid === null ? 'n/a' : (q.bestAsk - q.bestBid).toFixed(3)} > ${cfg.maxSpread}` };
  }
  if (!cfg.paperTradingEnabled) return { status: 'signal_only', reason: 'PAPER_TRADING_ENABLED=false' };
  return null;
}

export type TradePlan =
  | { status: 'traded'; stake: number; fullKelly: number; fill: SimulatedFill; evAtFill: number }
  | { status: 'risk_blocked' | 'insufficient_liquidity'; reason: string; fullKelly: number; stake: number };

export function planTrade(fairProb: number, q: Quote, token: PmToken, book: OrderBook, equity: number, risk: RiskDecision, cfg: StrategyConfig): TradePlan {
  const sizing = sizeStake({ fairProb, cost: q.edge.cost, bankroll: equity, available: risk.available }, cfg.sizing);
  if (!risk.ok) return { status: 'risk_blocked', reason: risk.reason ?? 'risk limits', fullKelly: sizing.fullKelly, stake: 0 };
  if (sizing.stake <= 0) return { status: 'insufficient_liquidity', reason: `stake below minimum (${sizing.cappedBy})`, fullKelly: sizing.fullKelly, stake: 0 };
  const maxCostPerShare = fairProb / (1 + cfg.minEdge);
  const fill = simulateBuy(book.asks, sizing.stake, token.fees, maxCostPerShare);
  if (!fill || fill.cost < cfg.sizing.minStakeUsd) {
    return { status: 'insufficient_liquidity', reason: 'not enough depth at +EV prices', fullKelly: sizing.fullKelly, stake: sizing.stake };
  }
  const evAtFill = fairProb / (fill.cost / fill.shares) - 1;
  return { status: 'traded', stake: sizing.stake, fullKelly: sizing.fullKelly, fill, evAtFill };
}
