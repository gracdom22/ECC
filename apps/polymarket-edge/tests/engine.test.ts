import { describe, expect, it } from 'vitest';
import { simulateBuy } from '../src/engine/fill.js';
import { applyOpen, buildRiskState, checkRisk, type RiskLimits, type TradeLike } from '../src/engine/risk.js';
import { computeSettlement } from '../src/engine/settle.js';
import { fairBookFor, gateQuote, planTrade, quoteFromBook, tokenFairProb, type StrategyConfig } from '../src/engine/signals.js';
import { LEAGUES } from '../src/leagues.js';
import { NO_FEES } from '../src/math/edge.js';
import { matchGame } from '../src/matching/match.js';
import { parseGame } from '../src/polymarket/parse.js';
import type { PmMarket } from '../src/types.js';
import { book, nbaEvent, oddsEvent, soccerEvent } from './fixtures.js';

const FEES = { rate: 0.05, exponent: 1 };

describe('simulateBuy', () => {
  it('walks the book cheapest first and includes fees', () => {
    const asks = [{ price: 0.42, size: 10 }, { price: 0.4, size: 10 }];
    const f = simulateBuy(asks, 100, NO_FEES)!;
    expect(f.shares).toBe(20);
    expect(f.cost).toBeCloseTo(8.2, 9);
    expect(f.avgPrice).toBeCloseTo(0.41, 9);
    expect(f.levels).toBe(2);
    expect(f.worstPrice).toBe(0.42);
    const withFees = simulateBuy(asks, 100, FEES)!;
    expect(withFees.fees).toBeCloseTo(10 * 0.05 * 0.4 * 0.6 + 10 * 0.05 * 0.42 * 0.58, 9);
  });

  it('stops at the budget', () => {
    const f = simulateBuy([{ price: 0.5, size: 1000 }], 10, NO_FEES)!;
    expect(f.shares).toBeCloseTo(20, 9);
    expect(f.cost).toBeCloseTo(10, 9);
  });

  it('respects the limit price and returns null when nothing fills', () => {
    const f = simulateBuy([{ price: 0.4, size: 5 }, { price: 0.6, size: 100 }], 100, NO_FEES, 0.5)!;
    expect(f.shares).toBe(5);
    expect(simulateBuy([{ price: 0.6, size: 5 }], 100, NO_FEES, 0.5)).toBeNull();
    expect(simulateBuy([], 100, NO_FEES)).toBeNull();
  });
});

const limits: RiskLimits = { startingBankroll: 1000, maxOpenExposurePct: 0.25, maxDailyLossPct: 0.05, maxDrawdownPct: 0.3, maxTradesPerDay: 3 };
const NOW = new Date('2026-10-16T12:00:00Z');

function trade(t: Partial<TradeLike>): TradeLike {
  return { eventId: 'e1', cost: 10, status: 'open', createdAt: '2026-10-15T10:00:00Z', settledAt: null, pnl: null, ...t };
}

describe('risk', () => {
  it('builds state from trades', () => {
    const s = buildRiskState(950, [
      trade({ eventId: 'a', cost: 20 }),
      trade({ eventId: 'b', status: 'settled', settledAt: '2026-10-16T01:00:00Z', pnl: -30 }),
      trade({ eventId: 'c', status: 'settled', settledAt: '2026-10-14T01:00:00Z', pnl: 50, createdAt: '2026-10-16T09:00:00Z' }),
    ], 1000, NOW);
    expect(s.openExposure).toBe(20);
    expect(s.equity).toBe(970);
    expect(s.peakEquity).toBe(1050);
    expect(s.realizedToday).toBe(-30);
    expect(s.tradesToday).toBe(1);
    expect([...s.openEventIds]).toEqual(['a']);
    expect(s.tradedEventIds.has('c')).toBe(true);
  });

  it('allows a trade within exposure room', () => {
    const s = buildRiskState(1000, [], 1000, NOW);
    expect(checkRisk(s, 'x', limits)).toEqual({ ok: true, available: 250 });
  });

  it('blocks on drawdown, daily loss, trade count, duplicate event and exposure', () => {
    const base = buildRiskState(1000, [], 1000, NOW);
    expect(checkRisk({ ...base, equity: 600, peakEquity: 1000 }, 'x', limits).reason).toMatch(/drawdown/);
    expect(checkRisk({ ...base, realizedToday: -60 }, 'x', limits).reason).toMatch(/daily loss/);
    expect(checkRisk({ ...base, tradesToday: 3 }, 'x', limits).reason).toMatch(/per day/);
    expect(checkRisk({ ...base, tradedEventIds: new Set(['x']) }, 'x', limits).reason).toMatch(/already/);
    expect(checkRisk({ ...base, openExposure: 300 }, 'x', limits)).toMatchObject({ ok: false, available: 0 });
  });

  it('applyOpen returns a new state without mutating the old one', () => {
    const s = buildRiskState(1000, [], 1000, NOW);
    const next = applyOpen(s, 'e9', 20);
    expect(next.cash).toBe(980);
    expect(next.openExposure).toBe(20);
    expect(next.tradesToday).toBe(1);
    expect(next.tradedEventIds.has('e9')).toBe(true);
    expect(s.tradedEventIds.has('e9')).toBe(false);
  });
});

function market(p: Partial<PmMarket>): PmMarket {
  return { id: 'm', conditionId: 'c', question: 'q', marketType: 'moneyline', outcomes: ['A', 'B'], tokenIds: ['a', 'b'], outcomePrices: [1, 0], closed: true, resolutionStatus: 'resolved', liquidity: 0, ...p };
}

describe('computeSettlement', () => {
  const t = { shares: 20, cost: 10.25, outcomeIndex: 0 };

  it('pays $1 per winning share', () => {
    expect(computeSettlement(t, market({}))).toEqual({ resolutionPrice: 1, payout: 20, pnl: 9.75 });
  });

  it('pays nothing on a loss and half on a 50-50 cancellation', () => {
    expect(computeSettlement(t, market({ outcomePrices: [0, 1] }))).toEqual({ resolutionPrice: 0, payout: 0, pnl: -10.25 });
    expect(computeSettlement(t, market({ outcomePrices: [0.5, 0.5] }))).toEqual({ resolutionPrice: 0.5, payout: 10, pnl: -0.25 });
  });

  it('waits while the market is open or prices are not final', () => {
    expect(computeSettlement(t, market({ closed: false }))).toBeNull();
    expect(computeSettlement(t, market({ outcomePrices: [0.97, 0.03] }))).toBeNull();
    expect(computeSettlement(t, market({ outcomePrices: [1, 1] }))).toBeNull();
    expect(computeSettlement(t, market({ outcomePrices: [1] , outcomes: ['A'] }))).toBeNull();
    expect(computeSettlement({ ...t, outcomeIndex: 4 }, market({}))).toBeNull();
  });
});

const strategy: StrategyConfig = {
  devigMethod: 'multiplicative',
  minEdge: 0.02,
  maxEdge: 0.15,
  maxSpread: 0.05,
  minMinutesToStart: 15,
  maxOddsAgeMin: 360,
  paperTradingEnabled: true,
  sizing: { kellyMultiplier: 0.25, maxStakePct: 0.02, maxStakeUsd: 25, minStakeUsd: 1 },
};

const START = '2026-10-16T23:00:00Z';

function nbaMatch(prices = { 'Miami Heat': 2.1, 'Orlando Magic': 1.8 }) {
  const game = parseGame(nbaEvent({ away: 'Heat', home: 'Magic', start: START }), LEAGUES.nba!)!;
  const odds = oddsEvent({ home: 'Orlando Magic', away: 'Miami Heat', start: START, prices });
  return matchGame(game, [odds])!;
}

describe('signals', () => {
  it('de-vigs the matched sharp line and maps it onto tokens', () => {
    const m = nbaMatch();
    const fb = fairBookFor(m, 'multiplicative')!;
    const heat = tokenFairProb(m, m.game.tokens[0]!, fb)!;
    const magic = tokenFairProb(m, m.game.tokens[1]!, fb)!;
    expect(heat + magic).toBeCloseTo(1, 12);
    expect(heat).toBeCloseTo((1 / 2.1) / (1 / 2.1 + 1 / 1.8), 12);
  });

  it('inverts the probability for No tokens in 1X2 markets', () => {
    const game = parseGame(soccerEvent({ home: ['Everton FC', 'eve'], away: ['Chelsea FC', 'che'], start: START }), LEAGUES.epl!)!;
    const odds = oddsEvent({ home: 'Everton', away: 'Chelsea', start: START, prices: { Everton: 3.4, Draw: 3.6, Chelsea: 2.2 }, sportKey: 'soccer_epl' });
    const m = matchGame(game, [odds])!;
    const fb = fairBookFor(m, 'power')!;
    const yes = tokenFairProb(m, game.tokens[0]!, fb)!;
    const no = tokenFairProb(m, game.tokens[1]!, fb)!;
    expect(yes + no).toBeCloseTo(1, 12);
    expect(fb.fair.get('Draw')).toBeGreaterThan(0.2);
  });

  it('refuses a sharp line whose outcomes do not fit the game', () => {
    expect(fairBookFor(nbaMatch({ 'Miami Heat': 2.1, 'Orlando Magic': 1.8, Draw: 15 } as never), 'power')).toBeNull();
    const m = nbaMatch();
    expect(fairBookFor({ ...m, odds: { ...m.odds, outcomes: [{ name: 'Miami Heat', price: 2 }, { name: 'Somebody', price: 2 }] } }, 'power')).toBeNull();
    expect(fairBookFor({ ...m, odds: { ...m.odds, outcomes: [{ name: 'Miami Heat', price: 2 }, { name: 'Miami Heat', price: 2 }] } }, 'power')).toBeNull();
  });

  const token = nbaMatch().game.tokens[0]!;
  const ctx = { now: new Date('2026-10-16T12:00:00Z'), gameStart: START, bookmakerLastUpdate: '2026-10-16T11:50:00Z' };

  it('quotes from the CLOB best ask', () => {
    expect(quoteFromBook(0.5, token, book(token.tokenId, []))).toBeNull();
    const q = quoteFromBook(0.5, token, book(token.tokenId, [[0.45, 100]], [[0.44, 100]]))!;
    expect(q.bestAsk).toBe(0.45);
    expect(q.bestBid).toBe(0.44);
    expect(q.edge.ev).toBeGreaterThan(0.08);
  });

  it('gates suspicious, small, stale, late, wide and closed quotes', () => {
    const q = (ask: number, bid: number | null = ask - 0.01) => quoteFromBook(0.5, token, book(token.tokenId, [[ask, 100]], bid === null ? [] : [[bid, 100]]))!;
    expect(gateQuote(q(0.4), token, ctx, strategy)?.status).toBe('suspect_edge');
    expect(gateQuote(q(0.49), token, ctx, strategy)?.status).toBe('below_threshold');
    expect(gateQuote(q(0.46), { ...token, acceptingOrders: false }, ctx, strategy)?.status).toBe('not_accepting');
    expect(gateQuote(q(0.46), token, { ...ctx, gameStart: '2026-10-16T12:05:00Z' }, strategy)?.status).toBe('too_close_to_start');
    expect(gateQuote(q(0.46), token, { ...ctx, bookmakerLastUpdate: '2026-10-15T12:00:00Z' }, strategy)?.status).toBe('stale_odds');
    expect(gateQuote(q(0.46, 0.3), token, ctx, strategy)?.status).toBe('wide_spread');
    expect(gateQuote(q(0.46, null), token, ctx, strategy)?.status).toBe('wide_spread');
    expect(gateQuote(q(0.46), token, ctx, { ...strategy, paperTradingEnabled: false })?.status).toBe('signal_only');
    expect(gateQuote(q(0.46), token, { ...ctx, bookmakerLastUpdate: null }, strategy)).toBeNull();
  });

  it('plans a sized paper trade at +EV prices only', () => {
    const b = book(token.tokenId, [[0.46, 30], [0.5, 1000]], [[0.45, 10]]);
    const q = quoteFromBook(0.52, token, b)!;
    const plan = planTrade(0.52, q, token, b, 1000, { ok: true, available: 250 }, strategy);
    expect(plan.status).toBe('traded');
    if (plan.status !== 'traded') return;
    expect(plan.stake).toBe(20);
    expect(plan.fill.worstPrice).toBe(0.46);
    expect(plan.evAtFill).toBeGreaterThanOrEqual(strategy.minEdge);
  });

  it('reports risk blocks and thin books', () => {
    const b = book(token.tokenId, [[0.46, 1]], [[0.45, 10]]);
    const q = quoteFromBook(0.52, token, b)!;
    expect(planTrade(0.52, q, token, b, 1000, { ok: false, reason: 'nope', available: 0 }, strategy)).toMatchObject({ status: 'risk_blocked', reason: 'nope' });
    expect(planTrade(0.52, q, token, b, 1000, { ok: true, available: 250 }, strategy).status).toBe('insufficient_liquidity');
    expect(planTrade(0.52, q, token, b, 1000, { ok: true, available: 0.5 }, strategy)).toMatchObject({ status: 'insufficient_liquidity' });
  });
});
