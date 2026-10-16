import type { FeeSchedule } from './math/edge.js';

export interface PmTeam {
  name: string;
  alias?: string;
  abbreviation?: string;
  ordering?: 'home' | 'away';
}

/** What a token pays out on: a team winning, or a draw. */
export type Selection = { kind: 'team'; teamIndex: number } | { kind: 'draw' };

export interface PmToken {
  marketId: string;
  conditionId: string;
  question: string;
  tokenId: string;
  /** Index of this token in the market's `outcomes` / `outcomePrices` arrays. */
  outcomeIndex: number;
  outcomeLabel: string;
  selection: Selection;
  /** True for a "No" token: it wins when the selection does NOT happen. */
  negate: boolean;
  /** Screening ask derived from Gamma bestBid/bestAsk. Confirmed against the CLOB book before any paper trade. */
  gammaAsk: number | null;
  fees: FeeSchedule;
  acceptingOrders: boolean;
}

export interface PmMarket {
  id: string;
  conditionId: string;
  question: string;
  marketType: string;
  outcomes: string[];
  tokenIds: string[];
  outcomePrices: number[];
  closed: boolean;
  resolutionStatus: string | null;
  liquidity: number;
}

export interface PmGame {
  eventId: string;
  slug: string;
  title: string;
  league: string;
  startTime: string;
  teams: PmTeam[];
  markets: PmMarket[];
  tokens: PmToken[];
}

export interface BookOutcome {
  name: string;
  price: number;
}

export interface OddsEvent {
  id: string;
  sportKey: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  bookmaker: string;
  bookmakerLastUpdate: string | null;
  /** h2h outcomes with decimal prices. Names are team names or "Draw". */
  outcomes: BookOutcome[];
}

export interface OrderLevel {
  price: number;
  size: number;
}

export interface OrderBook {
  tokenId: string;
  asks: OrderLevel[];
  bids: OrderLevel[];
  timestamp: number | null;
}
