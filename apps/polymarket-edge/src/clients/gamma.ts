import { z } from 'zod';
import { fetchJson } from './http.js';

const GAMMA_BASE = 'https://gamma-api.polymarket.com';

const num = z.union([z.number(), z.string()]).transform((v) => Number(v));

export const GammaTeamSchema = z
  .object({
    name: z.string(),
    alias: z.string().nullish(),
    abbreviation: z.string().nullish(),
    ordering: z.string().nullish(),
  })
  .passthrough();

export const GammaMarketSchema = z
  .object({
    id: z.string(),
    question: z.string(),
    conditionId: z.string(),
    slug: z.string(),
    outcomes: z.string().nullish(),
    outcomePrices: z.string().nullish(),
    clobTokenIds: z.string().nullish(),
    active: z.boolean().nullish(),
    closed: z.boolean().nullish(),
    acceptingOrders: z.boolean().nullish(),
    sportsMarketType: z.string().nullish(),
    groupItemTitle: z.string().nullish(),
    gameStartTime: z.string().nullish(),
    bestBid: num.nullish(),
    bestAsk: num.nullish(),
    liquidityNum: num.nullish(),
    umaResolutionStatus: z.string().nullish(),
    feesEnabled: z.boolean().nullish(),
    feeSchedule: z.object({ rate: z.number(), exponent: z.number() }).passthrough().nullish(),
  })
  .passthrough();

export const GammaEventSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    startTime: z.string().nullish(),
    endDate: z.string().nullish(),
    closed: z.boolean().nullish(),
    teams: z.array(GammaTeamSchema).nullish(),
    markets: z.array(GammaMarketSchema).default([]),
  })
  .passthrough();

export type GammaMarket = z.infer<typeof GammaMarketSchema>;
export type GammaEvent = z.infer<typeof GammaEventSchema>;

/** Open events in a league series whose games end within the lookahead window. */
export async function fetchSeriesEvents(seriesId: string, now: Date, lookaheadHours: number): Promise<GammaEvent[]> {
  const endMin = new Date(now.getTime() - 6 * 3600_000).toISOString();
  const endMax = new Date(now.getTime() + lookaheadHours * 3600_000).toISOString();
  const out: GammaEvent[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const url = `${GAMMA_BASE}/events?series_id=${encodeURIComponent(seriesId)}&closed=false&limit=100&offset=${offset}&end_date_min=${endMin}&end_date_max=${endMax}&order=endDate&ascending=true`;
    const { data } = await fetchJson(url, z.array(GammaEventSchema));
    out.push(...data);
    if (data.length < 100) break;
  }
  return out;
}

export async function fetchMarket(marketId: string): Promise<GammaMarket> {
  const { data } = await fetchJson(`${GAMMA_BASE}/markets/${encodeURIComponent(marketId)}`, GammaMarketSchema);
  return data;
}
