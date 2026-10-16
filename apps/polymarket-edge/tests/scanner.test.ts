import { describe, expect, it } from 'vitest';
import type { GammaEvent, GammaMarket } from '../src/clients/gamma.js';
import { HttpError } from '../src/clients/http.js';
import type { OddsFetchResult, OddsRequest } from '../src/clients/oddsApi.js';
import { loadConfig } from '../src/config.js';
import { silentLogger } from '../src/logger.js';
import { Scanner, type ScannerApi } from '../src/scanner.js';
import { buildState, escapeHtml, renderDashboard } from '../src/server.js';
import { MemoryStore } from '../src/store/memory.js';
import type { OddsEvent, OrderBook } from '../src/types.js';
import { book, nbaEvent, oddsEvent } from './fixtures.js';

const NOW = new Date('2026-10-16T12:00:00Z');
const START = '2026-10-16T23:00:00Z';

interface FakeOpts {
  events?: GammaEvent[];
  odds?: OddsEvent[] | Error;
  books?: Record<string, OrderBook>;
  markets?: Record<string, GammaMarket>;
}

function fakeApi(opts: FakeOpts) {
  const calls = { odds: [] as OddsRequest[], books: [] as string[] };
  const api: ScannerApi = {
    fetchSeriesEvents: async (seriesId) => (seriesId === '10345' ? (opts.events ?? []) : []),
    fetchBook: async (tokenId) => {
      calls.books.push(tokenId);
      return opts.books?.[tokenId] ?? book(tokenId, []);
    },
    fetchSharpOdds: async (req): Promise<OddsFetchResult> => {
      calls.odds.push(req);
      if (opts.odds instanceof Error) throw opts.odds;
      return { events: opts.odds ?? [], quota: { remaining: 400, used: 100, last: 1 } };
    },
    fetchMarket: async (id) => {
      const m = opts.markets?.[id];
      if (!m) throw new Error(`no market ${id}`);
      return m;
    },
  };
  return { api, calls };
}

function config(extra: Record<string, string> = {}) {
  return loadConfig({ LEAGUES: 'nba', ODDS_API_KEY: 'test-key', ...extra });
}

function setup(opts: FakeOpts, env: Record<string, string> = {}) {
  const store = new MemoryStore(() => NOW);
  const { api, calls } = fakeApi(opts);
  const scanner = new Scanner({ config: config(env), store, logger: silentLogger, api, now: () => NOW });
  return { store, scanner, calls };
}

function heatMagic() {
  const event = nbaEvent({ away: 'Heat', home: 'Magic', start: START, bestBid: 0.44, bestAsk: 0.45 });
  const tokens = JSON.parse(event.markets[0]!.clobTokenIds!) as [string, string];
  const odds = oddsEvent({ home: 'Orlando Magic', away: 'Miami Heat', start: START, prices: { 'Miami Heat': 1.87, 'Orlando Magic': 2.02 }, lastUpdate: '2026-10-16T11:55:00Z' });
  return { event, tokens, odds };
}

describe('Scanner', () => {
  it('opens one paper trade on a +EV sharp-vs-Polymarket gap and debits the bankroll', async () => {
    const { event, tokens, odds } = heatMagic();
    const { store, scanner, calls } = setup({
      events: [event],
      odds: [odds],
      books: { [tokens[0]]: book(tokens[0], [[0.45, 500]], [[0.44, 500]]), [tokens[1]]: book(tokens[1], [[0.56, 500]], [[0.55, 500]]) },
    });
    await scanner.init();
    const r = await scanner.runCycle();

    expect(r).toMatchObject({ oddsMode: 'enabled', matched: 1, trades: 1, signals: 1, errors: [] });
    expect(calls.odds[0]).toMatchObject({ sportKey: 'basketball_nba', region: 'eu', bookmaker: 'pinnacle' });
    const [trade] = await store.listTrades();
    expect(trade).toMatchObject({ selection: 'Heat', status: 'open', outcomeIndex: 0 });
    expect(trade!.cost).toBeLessThanOrEqual(20);
    expect(await store.getCash()).toBeCloseTo(1000 - trade!.cost, 6);
    expect(store.signals[0]!.status).toBe('traded');
    expect(store.snapshots[0]!.eventId).toBe(event.id);
  });

  it('does not spend Odds API credits again before the refresh interval', async () => {
    const { event, odds } = heatMagic();
    const { scanner, calls } = setup({ events: [event], odds: [odds] });
    await scanner.init();
    await scanner.runCycle();
    await scanner.runCycle();
    expect(calls.odds).toHaveLength(1);
  });

  it('runs Polymarket-only without an API key', async () => {
    const { event } = heatMagic();
    const store = new MemoryStore(() => NOW);
    const { api, calls } = fakeApi({ events: [event] });
    const scanner = new Scanner({ config: loadConfig({ LEAGUES: 'nba' }), store, logger: silentLogger, api, now: () => NOW });
    await scanner.init();
    const r = await scanner.runCycle();
    expect(r.oddsMode).toBe('missing_key');
    expect(r.gamesByLeague.nba).toBe(1);
    expect(calls.odds).toHaveLength(0);
    expect(store.games.size).toBe(1);
  });

  it('records a signal but no trade when paper trading is disabled', async () => {
    const { event, tokens, odds } = heatMagic();
    const { store, scanner } = setup(
      { events: [event], odds: [odds], books: { [tokens[0]]: book(tokens[0], [[0.45, 500]], [[0.44, 500]]) } },
      { PAPER_TRADING_ENABLED: 'false' },
    );
    await scanner.init();
    const r = await scanner.runCycle();
    expect(r.trades).toBe(0);
    expect(store.signals[0]!.status).toBe('signal_only');
  });

  it('stops using odds after the key is rejected', async () => {
    const { event } = heatMagic();
    const { scanner, store } = setup({ events: [event], odds: new HttpError('HTTP 401', 401) });
    await scanner.init();
    const r = await scanner.runCycle();
    expect(r.errors).toEqual([]);
    expect(store.apiCalls[0]).toMatchObject({ status: 401, cost: 0 });
    expect((await scanner.runCycle()).oddsMode).toBe('invalid_key');
  });

  it('reports non-auth odds failures as cycle errors', async () => {
    const { event } = heatMagic();
    const { scanner } = setup({ events: [event], odds: new HttpError('HTTP 500', 500) });
    await scanner.init();
    expect((await scanner.runCycle()).errors[0]).toMatch(/^odds:/);
  });

  it('marks the budget exhausted when no credits remain', async () => {
    const { event } = heatMagic();
    const { scanner, calls } = setup({ events: [event] }, { ODDS_MONTHLY_BUDGET: '0' });
    await scanner.init();
    expect((await scanner.runCycle()).oddsMode).toBe('budget_exhausted');
    expect(calls.odds).toHaveLength(0);
  });

  it('settles a resolved trade and credits the payout', async () => {
    const { event, tokens, odds } = heatMagic();
    const markets: Record<string, GammaMarket> = {};
    const { store, scanner } = setup({
      events: [event],
      odds: [odds],
      books: { [tokens[0]]: book(tokens[0], [[0.45, 500]], [[0.44, 500]]) },
      markets,
    });
    await scanner.init();
    await scanner.runCycle();
    const [open] = await store.listTrades();
    markets[open!.marketId] = { ...event.markets[0]!, closed: true, outcomePrices: '["1", "0"]' };
    expect(await scanner.settleOpenTrades()).toBe(1);
    const [settled] = await store.listTrades();
    expect(settled).toMatchObject({ status: 'settled', resolutionPrice: 1 });
    expect(await store.getCash()).toBeCloseTo(1000 - open!.cost + settled!.payout!, 6);
  });

  it('renders a dashboard with escaped external text', async () => {
    const { event, tokens, odds } = heatMagic();
    const { store, scanner } = setup({ events: [event], odds: [odds], books: { [tokens[0]]: book(tokens[0], [[0.45, 500]], [[0.44, 500]]) } });
    await scanner.init();
    await scanner.runCycle();
    const state = await buildState(store, scanner, config());
    expect(state.openTrades).toHaveLength(1);
    expect(state.equity).toBeCloseTo(1000, 6);
    const html = renderDashboard({ ...state, signals: [{ ...state.signals[0]!, question: '<script>x</script>' }] });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>x');
    expect(escapeHtml(`a"b'c&`)).toBe('a&quot;b&#39;c&amp;');
  });
});
