import { z } from 'zod';
import type { OrderBook, OrderLevel } from '../types.js';
import { fetchJson } from './http.js';

const CLOB_BASE = 'https://clob.polymarket.com';

const LevelSchema = z.object({ price: z.string(), size: z.string() });
const BookSchema = z
  .object({
    asset_id: z.string(),
    timestamp: z.string().nullish(),
    bids: z.array(LevelSchema).default([]),
    asks: z.array(LevelSchema).default([]),
  })
  .passthrough();

function toLevels(levels: Array<{ price: string; size: string }>): OrderLevel[] {
  return levels
    .map((l) => ({ price: Number(l.price), size: Number(l.size) }))
    .filter((l) => Number.isFinite(l.price) && Number.isFinite(l.size) && l.price > 0 && l.price < 1 && l.size > 0);
}

/** Read-only public order book. Asks sorted cheapest first, bids highest first. */
export async function fetchBook(tokenId: string): Promise<OrderBook> {
  const { data } = await fetchJson(`${CLOB_BASE}/book?token_id=${encodeURIComponent(tokenId)}`, BookSchema);
  if (data.asset_id !== tokenId) throw new Error(`CLOB returned book for a different token`);
  return {
    tokenId,
    asks: toLevels(data.asks).sort((a, b) => a.price - b.price),
    bids: toLevels(data.bids).sort((a, b) => b.price - a.price),
    timestamp: data.timestamp ? Number(data.timestamp) : null,
  };
}
