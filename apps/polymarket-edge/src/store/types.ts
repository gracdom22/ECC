import type { Settlement } from '../engine/settle.js';
import type { SignalStatus } from '../engine/signals.js';
import type { BookOutcome, PmGame } from '../types.js';

export interface NewTrade {
  signalId: string | null;
  eventId: string;
  marketId: string;
  tokenId: string;
  question: string;
  selection: string;
  outcomeIndex: number;
  shares: number;
  avgPrice: number;
  fees: number;
  cost: number;
  fairProb: number;
  evAtEntry: number;
}

export interface TradeRecord extends NewTrade {
  id: string;
  status: 'open' | 'settled' | 'void';
  createdAt: string;
  settledAt: string | null;
  payout: number | null;
  pnl: number | null;
  resolutionPrice: number | null;
}

export interface NewOddsSnapshot {
  oddsEventId: string;
  sportKey: string;
  bookmaker: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  outcomes: BookOutcome[];
  fairProbs: Record<string, number> | null;
  overround: number | null;
  devigMethod: string | null;
  bookmakerLastUpdate: string | null;
  eventId: string | null;
  matchScore: number | null;
}

export interface NewSignal {
  eventId: string;
  marketId: string;
  tokenId: string;
  question: string;
  selection: string;
  oddsSnapshotId: string;
  fairProb: number;
  bestAsk: number;
  bestBid: number | null;
  feePerShare: number;
  cost: number;
  ev: number;
  edge: number;
  fullKelly: number;
  suggestedStake: number;
  status: SignalStatus;
  reason: string | null;
}

export interface SignalRecord extends NewSignal {
  id: string;
  createdAt: string;
}

export interface ApiCall {
  provider: 'odds_api' | 'gamma' | 'clob';
  endpoint: string;
  status: number;
  cost: number;
  remaining: number | null;
  used: number | null;
}

export interface Store {
  readonly kind: 'supabase' | 'memory';
  ensureBankroll(starting: number): Promise<void>;
  getCash(): Promise<number>;
  upsertGame(game: PmGame): Promise<void>;
  insertOddsSnapshot(s: NewOddsSnapshot): Promise<string>;
  /** Returns null when the (token, snapshot) pair was already recorded. */
  insertSignal(s: NewSignal): Promise<string | null>;
  openTrade(t: NewTrade): Promise<TradeRecord>;
  settleTrade(id: string, s: Settlement): Promise<void>;
  listTrades(opts?: { status?: TradeRecord['status']; limit?: number }): Promise<TradeRecord[]>;
  recentSignals(limit: number): Promise<SignalRecord[]>;
  recordApiCall(c: ApiCall): Promise<void>;
  oddsCreditsUsedSince(iso: string): Promise<number>;
  lastOddsFetch(sportKey: string): Promise<string | null>;
  lastOddsRemaining(): Promise<number | null>;
}
