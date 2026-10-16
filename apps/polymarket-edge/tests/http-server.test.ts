import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { fetchJson, HttpError } from '../src/clients/http.js';
import { loadConfig } from '../src/config.js';
import { createLogger, silentLogger } from '../src/logger.js';
import { Scanner } from '../src/scanner.js';
import { startServer } from '../src/server.js';
import { MemoryStore } from '../src/store/memory.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fetchJson', () => {
  it('validates the response shape', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ a: 1 }), { status: 200 })));
    await expect(fetchJson('https://x.test/?apiKey=s3cret', z.object({ a: z.number() }))).resolves.toMatchObject({ data: { a: 1 } });
    await expect(fetchJson('https://x.test/?apiKey=s3cret', z.object({ b: z.string() }), { retries: 0 })).rejects.toThrow(/Unexpected response shape.*\[REDACTED\]/);
  });

  it('does not retry client errors and never leaks the key', async () => {
    const f = vi.fn(async () => new Response('no', { status: 401 }));
    vi.stubGlobal('fetch', f);
    const err = await fetchJson('https://x.test/?apiKey=s3cret', z.any()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(401);
    expect((err as Error).message).not.toContain('s3cret');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('retries server errors', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('x', { status: 503 })).mockResolvedValueOnce(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', f);
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0;
    }) as never);
    await expect(fetchJson('https://x.test/', z.array(z.any()), { retries: 1 })).resolves.toMatchObject({ data: [] });
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('logger', () => {
  it('redacts secret-looking fields and URL keys', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = createLogger('info');
    log.debug('hidden');
    log.info('call https://a.test/?apiKey=abc', { apiKey: 'abc', tokenId: '123', err: new Error('boom ?apiKey=abc') });
    log.warn('w');
    log.error('e');
    expect(out).toHaveBeenCalledTimes(1);
    const line = String(out.mock.calls[0]![0]);
    expect(line).not.toContain('abc');
    expect(line).toContain('"tokenId":"123"');
    expect(err).toHaveBeenCalledTimes(2);
  });
});

describe('dashboard server', () => {
  async function serve(env: Record<string, string>) {
    const config = { ...loadConfig({ LEAGUES: 'nba', ...env }), port: 0 };
    const store = new MemoryStore();
    await store.ensureBankroll(1000);
    const scanner = new Scanner({
      config,
      store,
      logger: silentLogger,
      api: { fetchSeriesEvents: async () => [], fetchBook: async () => ({ tokenId: '', asks: [], bids: [], timestamp: null }), fetchSharpOdds: async () => ({ events: [], quota: { remaining: null, used: null, last: null } }), fetchMarket: async () => { throw new Error('x'); } },
    });
    const server = startServer(config, store, scanner, silentLogger);
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { base, close: () => new Promise((r) => server.close(r)) };
  }

  it('serves health, HTML and JSON state, with optional basic auth', async () => {
    const open = await serve({});
    expect((await fetch(`${open.base}/healthz`)).status).toBe(200);
    const html = await (await fetch(`${open.base}/`)).text();
    expect(html).toContain('Polymarket Edge');
    expect(html).toContain('SUPABASE_SECRET_KEY');
    const state = await (await fetch(`${open.base}/api/state`)).json();
    expect(state).toMatchObject({ paperOnly: true, cash: 1000, persistence: 'memory' });
    expect((await fetch(`${open.base}/nope`)).status).toBe(404);
    expect((await fetch(`${open.base}/`, { method: 'POST' })).status).toBe(405);
    await open.close();

    const locked = await serve({ DASHBOARD_PASSWORD: 'pw' });
    expect((await fetch(`${locked.base}/`)).status).toBe(401);
    expect((await fetch(`${locked.base}/healthz`)).status).toBe(200);
    const auth = { authorization: `Basic ${Buffer.from('mateo:pw').toString('base64')}` };
    expect((await fetch(`${locked.base}/`, { headers: auth })).status).toBe(200);
    const wrong = { authorization: `Basic ${Buffer.from('mateo:px').toString('base64')}` };
    expect((await fetch(`${locked.base}/`, { headers: wrong })).status).toBe(401);
    await locked.close();
  });
});
