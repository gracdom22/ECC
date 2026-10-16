import { describe, expect, it } from 'vitest';
import { redactUrl } from '../src/clients/http.js';
import { loadConfig } from '../src/config.js';
import { resolveLeagues } from '../src/leagues.js';
import { MemoryStore } from '../src/store/memory.js';

describe('loadConfig', () => {
  it('uses safe paper-trading defaults', () => {
    const c = loadConfig({});
    expect(c.risk.startingBankroll).toBe(1000);
    expect(c.strategy.sizing.kellyMultiplier).toBe(0.25);
    expect(c.strategy.paperTradingEnabled).toBe(true);
    expect(c.odds.apiKey).toBeUndefined();
    expect(c.odds.region).toBe('eu');
    expect(c.odds.bookmaker).toBe('pinnacle');
    expect(c.leagues.map((l) => l.key)).toEqual(['nba', 'nfl', 'epl', 'laliga', 'bundesliga', 'seriea', 'ligue1', 'ucl']);
  });

  it('treats blank secrets as missing and rejects invalid values', () => {
    expect(loadConfig({ ODDS_API_KEY: '  ', SUPABASE_SECRET_KEY: '' }).supabase.secretKey).toBeUndefined();
    expect(() => loadConfig({ KELLY_FRACTION: '2' })).toThrow(/KELLY_FRACTION/);
    expect(() => loadConfig({ LEAGUES: 'nba,cricket' })).toThrow(/Unknown league/);
    expect(loadConfig({ PAPER_TRADING_ENABLED: 'false' }).strategy.paperTradingEnabled).toBe(false);
  });

  it('resolves leagues case-insensitively', () => {
    expect(resolveLeagues([' EPL ']).map((l) => l.oddsSportKey)).toEqual(['soccer_epl']);
  });
});

describe('redactUrl', () => {
  it('removes API keys from URLs', () => {
    expect(redactUrl('https://api.the-odds-api.com/v4/sports/x/odds?apiKey=abc123&regions=eu')).toBe(
      'https://api.the-odds-api.com/v4/sports/x/odds?apiKey=[REDACTED]&regions=eu',
    );
  });
});

describe('MemoryStore', () => {
  it('keeps an append-only ledger and refuses overspending', async () => {
    const s = new MemoryStore();
    await s.ensureBankroll(100);
    await s.ensureBankroll(500);
    expect(await s.getCash()).toBe(100);
    const base = { signalId: null, eventId: 'e', marketId: 'm', tokenId: 't', question: 'q', selection: 'A', outcomeIndex: 0, shares: 10, avgPrice: 0.5, fees: 0, fairProb: 0.6, evAtEntry: 0.2 };
    await expect(s.openTrade({ ...base, cost: 200 })).rejects.toThrow(/Insufficient/);
    const t = await s.openTrade({ ...base, cost: 5 });
    expect(await s.getCash()).toBe(95);
    await s.settleTrade(t.id, { payout: 10, pnl: 5, resolutionPrice: 1 });
    await s.settleTrade(t.id, { payout: 10, pnl: 5, resolutionPrice: 1 });
    expect(await s.getCash()).toBe(105);
    expect(s.ledger.map((l) => l.kind)).toEqual(['deposit', 'trade_open', 'trade_settle']);
    expect(await s.listTrades({ status: 'open' })).toHaveLength(0);
    expect(await s.listTrades({ limit: 1 })).toHaveLength(1);
  });

  it('dedupes signals per token and snapshot and tracks odds usage', async () => {
    const s = new MemoryStore();
    const sig = { eventId: 'e', marketId: 'm', tokenId: 't', question: 'q', selection: 'A', oddsSnapshotId: '1', fairProb: 0.5, bestAsk: 0.45, bestBid: 0.44, feePerShare: 0, cost: 0.45, ev: 0.1, edge: 0.05, fullKelly: 0.1, suggestedStake: 5, status: 'traded' as const, reason: null };
    expect(await s.insertSignal(sig)).not.toBeNull();
    expect(await s.insertSignal(sig)).toBeNull();
    expect(await s.recentSignals(10)).toHaveLength(1);
    await s.recordApiCall({ provider: 'odds_api', endpoint: 'basketball_nba', status: 200, cost: 1, remaining: 499, used: 1 });
    await s.recordApiCall({ provider: 'odds_api', endpoint: 'soccer_epl', status: 500, cost: 1, remaining: null, used: null });
    expect(await s.oddsCreditsUsedSince('2000-01-01T00:00:00Z')).toBe(2);
    expect(await s.lastOddsRemaining()).toBe(499);
    expect(await s.lastOddsFetch('basketball_nba')).not.toBeNull();
    expect(await s.lastOddsFetch('soccer_italy_serie_a')).toBeNull();
  });
});
