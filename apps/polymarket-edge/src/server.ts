import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { AppConfig } from './config.js';
import type { Logger } from './logger.js';
import type { Scanner } from './scanner.js';
import type { SignalRecord, Store, TradeRecord } from './store/types.js';

export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const usd = (x: number | null) => (x === null ? '-' : `$${x.toFixed(2)}`);
const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

export interface DashboardState {
  generatedAt: string;
  paperOnly: true;
  persistence: Store['kind'];
  startingBankroll: number;
  cash: number;
  openExposure: number;
  equity: number;
  realizedPnl: number;
  openTrades: TradeRecord[];
  settledTrades: TradeRecord[];
  signals: SignalRecord[];
  lastCycle: Scanner['lastReport'];
}

export async function buildState(store: Store, scanner: Scanner, config: AppConfig): Promise<DashboardState> {
  const [cash, trades, signals] = await Promise.all([store.getCash(), store.listTrades({ limit: 500 }), store.recentSignals(50)]);
  const openTrades = trades.filter((t) => t.status === 'open');
  const settledTrades = trades.filter((t) => t.status === 'settled');
  const openExposure = openTrades.reduce((s, t) => s + t.cost, 0);
  return {
    generatedAt: new Date().toISOString(),
    paperOnly: true,
    persistence: store.kind,
    startingBankroll: config.risk.startingBankroll,
    cash,
    openExposure,
    equity: cash + openExposure,
    realizedPnl: settledTrades.reduce((s, t) => s + (t.pnl ?? 0), 0),
    openTrades,
    settledTrades: settledTrades.slice(0, 50),
    signals,
    lastCycle: scanner.lastReport,
  };
}

const ODDS_MODE_ES: Record<string, string> = {
  enabled: 'activas',
  missing_key: 'SIN CLAVE (solo Polymarket, no se generan señales)',
  invalid_key: 'CLAVE RECHAZADA por The Odds API',
  budget_exhausted: 'presupuesto mensual agotado (se reanuda solo)',
};

function tradeRows(trades: TradeRecord[], settled: boolean): string {
  if (trades.length === 0) return `<tr><td colspan="7">Ninguna todavía</td></tr>`;
  return trades
    .map(
      (t) => `<tr><td>${escapeHtml(t.createdAt.slice(0, 16).replace('T', ' '))}</td><td>${escapeHtml(t.question)}</td><td>${escapeHtml(t.selection)}</td>
<td>${t.avgPrice.toFixed(3)}</td><td>${usd(t.cost)}</td><td>${pct(t.evAtEntry)}</td><td>${settled ? usd(t.pnl) : '-'}</td></tr>`,
    )
    .join('');
}

function signalRows(signals: SignalRecord[]): string {
  if (signals.length === 0) return `<tr><td colspan="7">Ninguna todavía</td></tr>`;
  return signals
    .map(
      (s) => `<tr><td>${escapeHtml(s.createdAt.slice(0, 16).replace('T', ' '))}</td><td>${escapeHtml(s.question)}</td><td>${escapeHtml(s.selection)}</td>
<td>${pct(s.fairProb)}</td><td>${s.bestAsk.toFixed(3)}</td><td>${pct(s.ev)}</td><td>${escapeHtml(s.status)}${s.reason ? ` - ${escapeHtml(s.reason)}` : ''}</td></tr>`,
    )
    .join('');
}

export function renderDashboard(s: DashboardState): string {
  const c = s.lastCycle;
  const roi = (s.equity - s.startingBankroll) / s.startingBankroll;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60"><title>Polymarket Edge (simulación)</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;background:#0f172a;color:#e2e8f0}h1{margin:0 0 4px}small{color:#94a3b8}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}.card{background:#1e293b;padding:12px 16px;border-radius:8px;min-width:150px}
.card b{display:block;font-size:22px}table{width:100%;border-collapse:collapse;margin:8px 0 24px;font-size:13px}
th,td{padding:6px 8px;border-bottom:1px solid #334155;text-align:left}th{color:#94a3b8}.warn{background:#7c2d12;padding:8px 12px;border-radius:6px}</style></head>
<body><h1>Polymarket Edge</h1><small>Simulación (paper trading). Ningún dinero real. Ninguna orden se envía a Polymarket.</small>
${s.persistence === 'memory' ? '<p class="warn">Sin base de datos: falta SUPABASE_SECRET_KEY. Los datos se pierden al reiniciar.</p>' : ''}
<div class="cards">
<div class="card">Banca inicial<b>${usd(s.startingBankroll)}</b></div>
<div class="card">Efectivo<b>${usd(s.cash)}</b></div>
<div class="card">En juego<b>${usd(s.openExposure)}</b></div>
<div class="card">Patrimonio<b>${usd(s.equity)}</b></div>
<div class="card">Resultado cerrado<b>${usd(s.realizedPnl)}</b></div>
<div class="card">Rentabilidad<b>${pct(roi)}</b></div>
</div>
<p>Último ciclo: ${c ? escapeHtml(c.finishedAt.slice(0, 19).replace('T', ' ')) + ' UTC' : 'pendiente'} |
Cuotas Pinnacle: ${escapeHtml(ODDS_MODE_ES[c?.oddsMode ?? ''] ?? '-')} |
Partidos vistos: ${c ? Object.values(c.gamesByLeague).reduce((a, b) => a + b, 0) : 0} |
Emparejados: ${c?.matched ?? 0} | Errores: ${c?.errors.length ?? 0}</p>
<h2>Apuestas simuladas abiertas</h2><table><tr><th>Fecha</th><th>Mercado</th><th>Selección</th><th>Precio</th><th>Coste</th><th>EV</th><th>PnL</th></tr>${tradeRows(s.openTrades, false)}</table>
<h2>Apuestas simuladas cerradas</h2><table><tr><th>Fecha</th><th>Mercado</th><th>Selección</th><th>Precio</th><th>Coste</th><th>EV</th><th>PnL</th></tr>${tradeRows(s.settledTrades, true)}</table>
<h2>Últimas señales +EV</h2><table><tr><th>Fecha</th><th>Mercado</th><th>Selección</th><th>Prob. justa</th><th>Ask</th><th>EV</th><th>Estado</th></tr>${signalRows(s.signals)}</table>
</body></html>`;
}

function authorized(req: IncomingMessage, password: string | undefined): boolean {
  if (!password) return true;
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const given = Buffer.from(decoded.slice(decoded.indexOf(':') + 1));
  const expected = Buffer.from(password);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function startServer(config: AppConfig, store: Store, scanner: Scanner, logger: Logger): Server {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'");
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, lastCycle: scanner.lastReport?.finishedAt ?? null }));
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    if (!authorized(req, config.dashboardPassword)) {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="polymarket-edge"' }).end();
      return;
    }
    try {
      if (url.pathname === '/api/state') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(await buildState(store, scanner, config)));
      } else if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(renderDashboard(await buildState(store, scanner, config)));
      } else {
        res.writeHead(404).end();
      }
    } catch (err) {
      logger.error('dashboard error', { error: err instanceof Error ? err.message : String(err) });
      res.writeHead(500).end('error');
    }
  });
  server.listen(config.port, () => logger.info('dashboard listening', { port: config.port }));
  return server;
}
