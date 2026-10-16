import { fetchBook } from './clients/clob.js';
import { fetchMarket, fetchSeriesEvents } from './clients/gamma.js';
import { fetchSharpOdds } from './clients/oddsApi.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { Scanner } from './scanner.js';
import { startServer } from './server.js';
import { MemoryStore } from './store/memory.js';
import { SupabaseStore } from './store/supabase.js';
import type { Store } from './store/types.js';

async function main(): Promise<void> {
  const logger = createLogger(process.env.LOG_LEVEL === 'debug' ? 'debug' : 'info');
  const config = loadConfig();
  const once = process.argv.includes('--once');

  let store: Store;
  if (config.supabase.secretKey) {
    store = new SupabaseStore(config.supabase.url, config.supabase.secretKey);
  } else {
    logger.warn('SUPABASE_SECRET_KEY not set: using in-memory store (data is lost on restart)');
    store = new MemoryStore();
  }
  if (!config.odds.apiKey) logger.warn('ODDS_API_KEY not set: scanner runs Polymarket-only and will not create signals');

  logger.info('starting polymarket-edge (PAPER TRADING ONLY, no real orders)', {
    leagues: config.leagues.map((l) => l.key),
    persistence: store.kind,
    paperTradingEnabled: config.strategy.paperTradingEnabled,
    scanIntervalMin: config.scanIntervalMin,
  });

  const scanner = new Scanner({ config, store, logger, api: { fetchSeriesEvents, fetchBook, fetchSharpOdds, fetchMarket } });
  await scanner.init();

  if (once) {
    const report = await scanner.runCycle();
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const server = startServer(config, store, scanner, logger);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await scanner.runCycle();
    } catch (err) {
      logger.error('cycle crashed', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      running = false;
    }
  };
  await tick();
  const timer = setInterval(tick, config.scanIntervalMin * 60_000);
  const shutdown = () => {
    clearInterval(timer);
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'error', msg: 'fatal', error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
