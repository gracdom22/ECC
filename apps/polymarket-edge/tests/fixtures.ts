import type { GammaEvent, GammaMarket } from '../src/clients/gamma.js';
import type { OddsEvent, OrderBook } from '../src/types.js';

let marketSeq = 1000;

export function gammaMarket(overrides: Partial<GammaMarket> & { slug: string }): GammaMarket {
  marketSeq += 1;
  return {
    id: String(marketSeq),
    question: overrides.question ?? overrides.slug,
    conditionId: `0xcond${marketSeq}`,
    outcomes: '["Yes", "No"]',
    outcomePrices: '["0.5", "0.5"]',
    clobTokenIds: `["tok${marketSeq}a", "tok${marketSeq}b"]`,
    active: true,
    closed: false,
    acceptingOrders: true,
    sportsMarketType: 'moneyline',
    bestBid: 0.49,
    bestAsk: 0.5,
    liquidityNum: 10000,
    feesEnabled: true,
    feeSchedule: { rate: 0.05, exponent: 1 },
    ...overrides,
  } as GammaMarket;
}

/** NBA-style event: one moneyline market whose outcomes are team names. */
export function nbaEvent(opts: { id?: string; away: string; home: string; start: string; bestBid?: number; bestAsk?: number }): GammaEvent {
  const slug = `nba-${opts.away.slice(0, 3).toLowerCase()}-${opts.home.slice(0, 3).toLowerCase()}`;
  return {
    id: opts.id ?? `ev-${slug}`,
    slug,
    title: `${opts.away} vs. ${opts.home}`,
    startTime: opts.start,
    teams: [
      { name: opts.away, alias: opts.away, abbreviation: opts.away.slice(0, 3).toLowerCase(), ordering: 'away' },
      { name: opts.home, alias: opts.home, abbreviation: opts.home.slice(0, 3).toLowerCase(), ordering: 'home' },
    ],
    markets: [
      gammaMarket({
        slug,
        question: `${opts.away} vs. ${opts.home}`,
        outcomes: JSON.stringify([opts.away, opts.home]),
        bestBid: opts.bestBid ?? 0.42,
        bestAsk: opts.bestAsk ?? 0.43,
      }),
      gammaMarket({ slug: `${slug}-first`, sportsMarketType: 'basketball_team_to_score_first', outcomes: JSON.stringify([opts.away, opts.home]) }),
    ],
  } as GammaEvent;
}

/** Soccer-style event: three Yes/No moneyline markets (home, draw, away). */
export function soccerEvent(opts: { id?: string; home: [string, string]; away: [string, string]; start: string; asks?: [number, number, number] }): GammaEvent {
  const [homeName, homeAbbr] = opts.home;
  const [awayName, awayAbbr] = opts.away;
  const slug = `epl-${homeAbbr}-${awayAbbr}-2026-10-17`;
  const asks = opts.asks ?? [0.3, 0.27, 0.45];
  return {
    id: opts.id ?? `ev-${slug}`,
    slug,
    title: `${homeName} vs. ${awayName}`,
    startTime: opts.start,
    teams: [
      { name: homeName, abbreviation: homeAbbr, ordering: 'home' },
      { name: awayName, abbreviation: awayAbbr, ordering: 'away' },
    ],
    markets: [
      gammaMarket({ slug: `${slug}-${homeAbbr}`, question: `Will ${homeName} win?`, groupItemTitle: homeName, bestAsk: asks[0], bestBid: asks[0] - 0.01 }),
      gammaMarket({ slug: `${slug}-draw`, question: `Will ${homeName} vs. ${awayName} end in a draw?`, groupItemTitle: `Draw (${homeName} vs. ${awayName})`, bestAsk: asks[1], bestBid: asks[1] - 0.01 }),
      gammaMarket({ slug: `${slug}-${awayAbbr}`, question: `Will ${awayName} win?`, groupItemTitle: awayName, bestAsk: asks[2], bestBid: asks[2] - 0.01 }),
    ],
  } as GammaEvent;
}

export function oddsEvent(opts: { id?: string; home: string; away: string; start: string; prices: Record<string, number>; sportKey?: string; lastUpdate?: string }): OddsEvent {
  return {
    id: opts.id ?? `odds-${opts.home}-${opts.away}`,
    sportKey: opts.sportKey ?? 'basketball_nba',
    commenceTime: opts.start,
    homeTeam: opts.home,
    awayTeam: opts.away,
    bookmaker: 'pinnacle',
    bookmakerLastUpdate: opts.lastUpdate ?? null,
    outcomes: Object.entries(opts.prices).map(([name, price]) => ({ name, price })),
  };
}

export function book(tokenId: string, asks: Array<[number, number]>, bids: Array<[number, number]> = []): OrderBook {
  return {
    tokenId,
    asks: asks.map(([price, size]) => ({ price, size })).sort((a, b) => a.price - b.price),
    bids: bids.map(([price, size]) => ({ price, size })).sort((a, b) => b.price - a.price),
    timestamp: null,
  };
}
