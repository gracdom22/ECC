import { describe, expect, it } from 'vitest';
import { LEAGUES } from '../src/leagues.js';
import { NO_FEES } from '../src/math/edge.js';
import { FALLBACK_FEES, gammaAsk, marketFees, parseGame, toPmMarket } from '../src/polymarket/parse.js';
import { gammaMarket, nbaEvent, soccerEvent } from './fixtures.js';

const START = '2026-10-16T23:00:00Z';

describe('parseGame (two-way)', () => {
  it('builds one token per team from the moneyline market only', () => {
    const g = parseGame(nbaEvent({ away: 'Heat', home: 'Magic', start: START, bestBid: 0.42, bestAsk: 0.43 }), LEAGUES.nba!)!;
    expect(g.markets).toHaveLength(1);
    expect(g.tokens).toHaveLength(2);
    expect(g.tokens[0]).toMatchObject({ outcomeLabel: 'Heat', selection: { kind: 'team', teamIndex: 0 }, negate: false, gammaAsk: 0.43 });
    expect(g.tokens[1]).toMatchObject({ outcomeLabel: 'Magic', selection: { kind: 'team', teamIndex: 1 }, gammaAsk: 0.58 });
    expect(g.startTime).toBe('2026-10-16T23:00:00.000Z');
  });

  it('rejects outcomes that do not map to the event teams', () => {
    const e = nbaEvent({ away: 'Heat', home: 'Magic', start: START });
    e.markets[0]!.outcomes = '["Heat", "Lakers"]';
    expect(parseGame(e, LEAGUES.nba!)).toBeNull();
  });

  it('rejects events without two teams, a moneyline or a start time', () => {
    const noTeams = { ...nbaEvent({ away: 'Heat', home: 'Magic', start: START }), teams: [] };
    expect(parseGame(noTeams, LEAGUES.nba!)).toBeNull();
    const e = nbaEvent({ away: 'Heat', home: 'Magic', start: START });
    expect(parseGame({ ...e, markets: e.markets.slice(1) }, LEAGUES.nba!)).toBeNull();
    const m = e.markets[0]!;
    expect(parseGame({ ...e, startTime: null, endDate: null, markets: [{ ...m, gameStartTime: null }] }, LEAGUES.nba!)).toBeNull();
  });

  it('falls back to the market gameStartTime', () => {
    const e = nbaEvent({ away: 'Heat', home: 'Magic', start: START });
    const m = { ...e.markets[0]!, gameStartTime: '2026-10-16 23:00:00+00' };
    expect(parseGame({ ...e, startTime: null, markets: [m] }, LEAGUES.nba!)!.startTime).toBe('2026-10-16T23:00:00.000Z');
  });
});

describe('parseGame (three-way soccer)', () => {
  const e = soccerEvent({ home: ['Everton FC', 'eve'], away: ['Chelsea FC', 'che'], start: '2026-10-17T11:30:00Z', asks: [0.3, 0.27, 0.45] });

  it('builds Yes and No tokens for home, draw and away', () => {
    const g = parseGame(e, LEAGUES.epl!)!;
    expect(g.tokens).toHaveLength(6);
    const yes = g.tokens.filter((t) => !t.negate);
    expect(yes.map((t) => t.selection)).toEqual([{ kind: 'team', teamIndex: 0 }, { kind: 'draw' }, { kind: 'team', teamIndex: 1 }]);
    expect(yes.map((t) => t.gammaAsk)).toEqual([0.3, 0.27, 0.45]);
    const noHome = g.tokens.find((t) => t.negate && t.selection.kind === 'team' && t.selection.teamIndex === 0)!;
    expect(noHome.outcomeIndex).toBe(1);
    expect(noHome.gammaAsk).toBeCloseTo(0.71, 9);
  });

  it('falls back to groupItemTitle when the slug suffix is not an abbreviation', () => {
    const m = e.markets.map((x, i) => (i === 0 ? { ...x, slug: `${x.slug}-home` } : x));
    expect(parseGame({ ...e, markets: m }, LEAGUES.epl!)).not.toBeNull();
  });

  it('rejects incomplete or duplicated 1X2 sets', () => {
    expect(parseGame({ ...e, markets: e.markets.slice(0, 2) }, LEAGUES.epl!)).toBeNull();
    expect(parseGame({ ...e, markets: [e.markets[0]!, e.markets[0]!, e.markets[1]!] }, LEAGUES.epl!)).toBeNull();
    const badOutcome = e.markets.map((x, i) => (i === 0 ? { ...x, outcomes: '["Over", "Under"]' } : x));
    expect(parseGame({ ...e, markets: badOutcome }, LEAGUES.epl!)).toBeNull();
    const unknown = e.markets.map((x, i) => (i === 0 ? { ...x, slug: `${x.slug}-zzz`, groupItemTitle: 'Arsenal' } : x));
    expect(parseGame({ ...e, markets: unknown }, LEAGUES.epl!)).toBeNull();
  });
});

describe('market helpers', () => {
  it('reads the fee schedule, defaulting conservatively', () => {
    expect(marketFees(gammaMarket({ slug: 'a', feesEnabled: false }))).toEqual(NO_FEES);
    expect(marketFees(gammaMarket({ slug: 'a', feeSchedule: { rate: 0.03, exponent: 1 } }))).toEqual({ rate: 0.03, exponent: 1 });
    expect(marketFees(gammaMarket({ slug: 'a', feeSchedule: null }))).toEqual(FALLBACK_FEES);
  });

  it('derives asks for both outcomes and rejects out-of-range values', () => {
    const m = gammaMarket({ slug: 'a', bestBid: 0.42, bestAsk: 0.43 });
    expect(gammaAsk(m, 0)).toBe(0.43);
    expect(gammaAsk(m, 1)).toBe(0.58);
    expect(gammaAsk(gammaMarket({ slug: 'a', bestBid: null, bestAsk: 1 }), 0)).toBeNull();
    expect(gammaAsk(gammaMarket({ slug: 'a', bestBid: null }), 1)).toBeNull();
  });

  it('tolerates malformed JSON arrays', () => {
    const pm = toPmMarket(gammaMarket({ slug: 'a', outcomes: 'not json', outcomePrices: '{"a":1}', clobTokenIds: null }));
    expect(pm.outcomes).toEqual([]);
    expect(pm.outcomePrices).toEqual([]);
    expect(pm.tokenIds).toEqual([]);
  });
});
