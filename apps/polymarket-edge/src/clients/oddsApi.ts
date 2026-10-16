import { z } from 'zod';
import type { OddsEvent } from '../types.js';
import { fetchJson } from './http.js';

const ODDS_BASE = 'https://api.the-odds-api.com/v4';

const OutcomeSchema = z.object({ name: z.string(), price: z.number() });
const MarketSchema = z.object({ key: z.string(), last_update: z.string().nullish(), outcomes: z.array(OutcomeSchema) });
const BookmakerSchema = z.object({ key: z.string(), last_update: z.string().nullish(), markets: z.array(MarketSchema) });
const EventSchema = z.object({
  id: z.string(),
  sport_key: z.string(),
  commence_time: z.string(),
  home_team: z.string(),
  away_team: z.string(),
  bookmakers: z.array(BookmakerSchema).default([]),
});

export interface OddsQuota {
  remaining: number | null;
  used: number | null;
  /** Credits charged for this request. */
  last: number | null;
}

export interface OddsFetchResult {
  events: OddsEvent[];
  quota: OddsQuota;
}

function headerNumber(headers: Headers, name: string): number | null {
  const v = headers.get(name);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface OddsRequest {
  apiKey: string;
  sportKey: string;
  region: string;
  bookmaker: string;
  commenceTo: Date;
}

/** One request = 1 credit (1 market x 1 region). Only h2h (moneyline / 1X2). */
export async function fetchSharpOdds(req: OddsRequest): Promise<OddsFetchResult> {
  const params = new URLSearchParams({
    apiKey: req.apiKey,
    regions: req.region,
    bookmakers: req.bookmaker,
    markets: 'h2h',
    oddsFormat: 'decimal',
    dateFormat: 'iso',
    commenceTimeTo: req.commenceTo.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  });
  const { data, headers } = await fetchJson(`${ODDS_BASE}/sports/${encodeURIComponent(req.sportKey)}/odds?${params}`, z.array(EventSchema), {
    retries: 0,
  });
  const events: OddsEvent[] = [];
  for (const e of data) {
    const book = e.bookmakers.find((b) => b.key === req.bookmaker);
    const market = book?.markets.find((m) => m.key === 'h2h');
    if (!book || !market) continue;
    events.push({
      id: e.id,
      sportKey: e.sport_key,
      commenceTime: e.commence_time,
      homeTeam: e.home_team,
      awayTeam: e.away_team,
      bookmaker: book.key,
      bookmakerLastUpdate: market.last_update ?? book.last_update ?? null,
      outcomes: market.outcomes.map((o) => ({ name: o.name, price: o.price })),
    });
  }
  return {
    events,
    quota: {
      remaining: headerNumber(headers, 'x-requests-remaining'),
      used: headerNumber(headers, 'x-requests-used'),
      last: headerNumber(headers, 'x-requests-last'),
    },
  };
}
