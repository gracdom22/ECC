export interface TradeLike {
  eventId: string;
  cost: number;
  status: 'open' | 'settled' | 'void';
  createdAt: string;
  settledAt: string | null;
  pnl: number | null;
}

export interface RiskLimits {
  startingBankroll: number;
  maxOpenExposurePct: number;
  maxDailyLossPct: number;
  maxDrawdownPct: number;
  maxTradesPerDay: number;
}

export interface RiskState {
  cash: number;
  openExposure: number;
  /** Cash plus open positions at cost. */
  equity: number;
  peakEquity: number;
  realizedToday: number;
  tradesToday: number;
  openEventIds: Set<string>;
  tradedEventIds: Set<string>;
}

function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

export function buildRiskState(cash: number, trades: readonly TradeLike[], startingBankroll: number, now: Date): RiskState {
  const today = now.toISOString().slice(0, 10);
  const open = trades.filter((t) => t.status === 'open');
  const openExposure = open.reduce((s, t) => s + t.cost, 0);
  const settled = trades
    .filter((t) => t.status === 'settled' && t.settledAt && t.pnl !== null)
    .sort((a, b) => Date.parse(a.settledAt!) - Date.parse(b.settledAt!));
  let realized = startingBankroll;
  let peak = startingBankroll;
  let realizedToday = 0;
  for (const t of settled) {
    realized += t.pnl!;
    peak = Math.max(peak, realized);
    if (utcDay(t.settledAt!) === today) realizedToday += t.pnl!;
  }
  return {
    cash,
    openExposure,
    equity: cash + openExposure,
    peakEquity: peak,
    realizedToday,
    tradesToday: trades.filter((t) => utcDay(t.createdAt) === today).length,
    openEventIds: new Set(open.map((t) => t.eventId)),
    tradedEventIds: new Set(trades.map((t) => t.eventId)),
  };
}

export interface RiskDecision {
  ok: boolean;
  reason?: string;
  /** Max USD that may be committed to a new position. */
  available: number;
}

/** Circuit breakers run independently of any signal logic. */
export function checkRisk(state: RiskState, eventId: string, limits: RiskLimits): RiskDecision {
  const block = (reason: string): RiskDecision => ({ ok: false, reason, available: 0 });
  if (state.peakEquity > 0 && state.equity < state.peakEquity * (1 - limits.maxDrawdownPct)) {
    return block(`drawdown breaker: equity ${state.equity.toFixed(2)} below ${(100 * (1 - limits.maxDrawdownPct)).toFixed(0)}% of peak ${state.peakEquity.toFixed(2)}`);
  }
  if (state.realizedToday < -limits.maxDailyLossPct * limits.startingBankroll) {
    return block(`daily loss breaker: ${state.realizedToday.toFixed(2)} today`);
  }
  if (state.tradesToday >= limits.maxTradesPerDay) return block(`max trades per day (${limits.maxTradesPerDay}) reached`);
  if (state.tradedEventIds.has(eventId)) return block('already holds a paper position on this event');
  const exposureRoom = limits.maxOpenExposurePct * state.equity - state.openExposure;
  const available = Math.min(state.cash, exposureRoom);
  if (available <= 0) return block('max open exposure reached');
  return { ok: true, available };
}

/** Records a newly opened position so later candidates in the same cycle see it. */
export function applyOpen(state: RiskState, eventId: string, cost: number): RiskState {
  return {
    ...state,
    cash: state.cash - cost,
    openExposure: state.openExposure + cost,
    tradesToday: state.tradesToday + 1,
    openEventIds: new Set([...state.openEventIds, eventId]),
    tradedEventIds: new Set([...state.tradedEventIds, eventId]),
  };
}
