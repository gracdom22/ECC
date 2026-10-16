import type { Settlement } from '../engine/settle.js';
import type { PmGame } from '../types.js';
import type { ApiCall, NewOddsSnapshot, NewSignal, NewTrade, SignalRecord, Store, TradeRecord } from './types.js';

interface LedgerRow {
  kind: 'deposit' | 'trade_open' | 'trade_settle';
  amount: number;
  balanceAfter: number;
  tradeId: string | null;
}

/** Non-persistent store used when SUPABASE_SECRET_KEY is missing, and in tests. */
export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  readonly games = new Map<string, PmGame>();
  readonly snapshots: Array<NewOddsSnapshot & { id: string }> = [];
  readonly signals: SignalRecord[] = [];
  readonly trades: TradeRecord[] = [];
  readonly ledger: LedgerRow[] = [];
  readonly apiCalls: Array<ApiCall & { createdAt: string }> = [];
  private seq = 0;

  constructor(private readonly clock: () => Date = () => new Date()) {}

  private nextId(): string {
    this.seq += 1;
    return String(this.seq);
  }

  private round(x: number): number {
    return Math.round(x * 1e6) / 1e6;
  }

  async ensureBankroll(starting: number): Promise<void> {
    if (this.ledger.length === 0) this.ledger.push({ kind: 'deposit', amount: starting, balanceAfter: starting, tradeId: null });
  }

  async getCash(): Promise<number> {
    return this.ledger.at(-1)?.balanceAfter ?? 0;
  }

  async upsertGame(game: PmGame): Promise<void> {
    this.games.set(game.eventId, game);
  }

  async insertOddsSnapshot(s: NewOddsSnapshot): Promise<string> {
    const id = this.nextId();
    this.snapshots.push({ ...s, id });
    return id;
  }

  async insertSignal(s: NewSignal): Promise<string | null> {
    if (this.signals.some((x) => x.tokenId === s.tokenId && x.oddsSnapshotId === s.oddsSnapshotId)) return null;
    const id = this.nextId();
    this.signals.push({ ...s, id, createdAt: this.clock().toISOString() });
    return id;
  }

  async openTrade(t: NewTrade): Promise<TradeRecord> {
    const cash = await this.getCash();
    if (t.cost <= 0 || t.cost > cash + 1e-9) throw new Error(`Insufficient paper cash: need ${t.cost}, have ${cash}`);
    const trade: TradeRecord = {
      ...t,
      id: this.nextId(),
      status: 'open',
      createdAt: this.clock().toISOString(),
      settledAt: null,
      payout: null,
      pnl: null,
      resolutionPrice: null,
    };
    this.trades.push(trade);
    this.ledger.push({ kind: 'trade_open', amount: -t.cost, balanceAfter: this.round(cash - t.cost), tradeId: trade.id });
    return trade;
  }

  async settleTrade(id: string, s: Settlement): Promise<void> {
    const idx = this.trades.findIndex((t) => t.id === id);
    const trade = this.trades[idx];
    if (!trade || trade.status !== 'open') return;
    this.trades[idx] = { ...trade, status: 'settled', settledAt: this.clock().toISOString(), payout: s.payout, pnl: s.pnl, resolutionPrice: s.resolutionPrice };
    const cash = await this.getCash();
    this.ledger.push({ kind: 'trade_settle', amount: s.payout, balanceAfter: this.round(cash + s.payout), tradeId: id });
  }

  async listTrades(opts: { status?: TradeRecord['status']; limit?: number } = {}): Promise<TradeRecord[]> {
    const rows = this.trades.filter((t) => !opts.status || t.status === opts.status).slice().reverse();
    return opts.limit ? rows.slice(0, opts.limit) : rows;
  }

  async recentSignals(limit: number): Promise<SignalRecord[]> {
    return this.signals.slice(-limit).reverse();
  }

  async recordApiCall(c: ApiCall): Promise<void> {
    this.apiCalls.push({ ...c, createdAt: this.clock().toISOString() });
  }

  async oddsCreditsUsedSince(iso: string): Promise<number> {
    const t = Date.parse(iso);
    return this.apiCalls.filter((c) => c.provider === 'odds_api' && Date.parse(c.createdAt) >= t).reduce((s, c) => s + c.cost, 0);
  }

  async lastOddsFetch(sportKey: string): Promise<string | null> {
    const calls = this.apiCalls.filter((c) => c.provider === 'odds_api' && c.endpoint === sportKey);
    return calls.at(-1)?.createdAt ?? null;
  }

  async lastOddsRemaining(): Promise<number | null> {
    const calls = this.apiCalls.filter((c) => c.provider === 'odds_api' && c.remaining !== null);
    return calls.at(-1)?.remaining ?? null;
  }
}
