import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Settlement } from '../engine/settle.js';
import type { PmGame } from '../types.js';
import type { ApiCall, NewOddsSnapshot, NewSignal, NewTrade, SignalRecord, Store, TradeRecord } from './types.js';

type Row = Record<string, unknown>;

function check<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Supabase ${what} failed: ${res.error.message}`);
  return (res.data ?? []) as T;
}

const n = (v: unknown): number => Number(v);
const nOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toTrade(r: Row): TradeRecord {
  return {
    id: String(r.id),
    signalId: r.signal_id == null ? null : String(r.signal_id),
    eventId: String(r.event_id),
    marketId: String(r.market_id),
    tokenId: String(r.token_id),
    question: String(r.question),
    selection: String(r.selection),
    outcomeIndex: n(r.outcome_index),
    shares: n(r.shares),
    avgPrice: n(r.avg_price),
    fees: n(r.fees),
    cost: n(r.cost),
    fairProb: n(r.fair_prob),
    evAtEntry: n(r.ev_at_entry),
    status: r.status as TradeRecord['status'],
    createdAt: String(r.created_at),
    settledAt: r.settled_at == null ? null : String(r.settled_at),
    payout: nOrNull(r.payout),
    pnl: nOrNull(r.pnl),
    resolutionPrice: nOrNull(r.resolution_price),
  };
}

function toSignal(r: Row): SignalRecord {
  return {
    id: String(r.id),
    createdAt: String(r.created_at),
    eventId: String(r.event_id),
    marketId: String(r.market_id),
    tokenId: String(r.token_id),
    question: String(r.question),
    selection: String(r.selection),
    oddsSnapshotId: String(r.odds_snapshot_id),
    fairProb: n(r.fair_prob),
    bestAsk: n(r.best_ask),
    bestBid: nOrNull(r.best_bid),
    feePerShare: n(r.fee_per_share),
    cost: n(r.cost),
    ev: n(r.ev),
    edge: n(r.edge),
    fullKelly: n(r.full_kelly),
    suggestedStake: n(r.suggested_stake),
    status: r.status as SignalRecord['status'],
    reason: r.reason == null ? null : String(r.reason),
  };
}

/** Server-side only: uses the secret (service_role) key, which bypasses RLS. Never ship this key to a browser. */
export class SupabaseStore implements Store {
  readonly kind = 'supabase' as const;
  private readonly db: SupabaseClient;

  constructor(url: string, secretKey: string) {
    this.db = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async ensureBankroll(starting: number): Promise<void> {
    check(await this.db.rpc('ensure_bankroll', { p_starting: starting }), 'ensure_bankroll');
  }

  async getCash(): Promise<number> {
    const rows = check(await this.db.from('bankroll').select('balance_after').order('id', { ascending: false }).limit(1), 'getCash');
    return rows[0] ? n(rows[0].balance_after) : 0;
  }

  async upsertGame(game: PmGame): Promise<void> {
    const now = new Date().toISOString();
    check(
      await this.db.from('events').upsert({
        id: game.eventId,
        slug: game.slug,
        title: game.title,
        league: game.league,
        start_time: game.startTime,
        teams: game.teams,
        updated_at: now,
      }),
      'upsert events',
    );
    check(
      await this.db.from('markets').upsert(
        game.markets.map((m) => ({
          id: m.id,
          event_id: game.eventId,
          condition_id: m.conditionId,
          question: m.question,
          market_type: m.marketType,
          outcomes: m.outcomes,
          clob_token_ids: m.tokenIds,
          outcome_prices: m.outcomePrices,
          closed: m.closed,
          resolution_status: m.resolutionStatus,
          liquidity: m.liquidity,
          updated_at: now,
        })),
      ),
      'upsert markets',
    );
  }

  async insertOddsSnapshot(s: NewOddsSnapshot): Promise<string> {
    const rows = check(
      await this.db
        .from('odds_snapshots')
        .insert({
          odds_event_id: s.oddsEventId,
          sport_key: s.sportKey,
          bookmaker: s.bookmaker,
          commence_time: s.commenceTime,
          home_team: s.homeTeam,
          away_team: s.awayTeam,
          outcomes: s.outcomes,
          fair_probs: s.fairProbs,
          overround: s.overround,
          devig_method: s.devigMethod,
          bookmaker_last_update: s.bookmakerLastUpdate,
          event_id: s.eventId,
          match_score: s.matchScore,
        })
        .select('id'),
      'insert odds_snapshots',
    );
    return String(rows[0]!.id);
  }

  async insertSignal(s: NewSignal): Promise<string | null> {
    const rows = check(
      await this.db
        .from('signals')
        .upsert(
          {
            event_id: s.eventId,
            market_id: s.marketId,
            token_id: s.tokenId,
            question: s.question,
            selection: s.selection,
            odds_snapshot_id: Number(s.oddsSnapshotId),
            fair_prob: s.fairProb,
            best_ask: s.bestAsk,
            best_bid: s.bestBid,
            fee_per_share: s.feePerShare,
            cost: s.cost,
            ev: s.ev,
            edge: s.edge,
            full_kelly: s.fullKelly,
            suggested_stake: s.suggestedStake,
            status: s.status,
            reason: s.reason,
          },
          { onConflict: 'token_id,odds_snapshot_id', ignoreDuplicates: true },
        )
        .select('id'),
      'insert signals',
    );
    return rows[0] ? String(rows[0].id) : null;
  }

  async openTrade(t: NewTrade): Promise<TradeRecord> {
    const row = check(
      await this.db.rpc('open_paper_trade', {
        p: {
          signal_id: t.signalId,
          event_id: t.eventId,
          market_id: t.marketId,
          token_id: t.tokenId,
          question: t.question,
          selection: t.selection,
          outcome_index: t.outcomeIndex,
          shares: t.shares,
          avg_price: t.avgPrice,
          fees: t.fees,
          cost: t.cost,
          fair_prob: t.fairProb,
          ev_at_entry: t.evAtEntry,
        },
      }),
      'open_paper_trade',
    );
    return toTrade(row as Row);
  }

  async settleTrade(id: string, s: Settlement): Promise<void> {
    check(
      await this.db.rpc('settle_paper_trade', { p_trade_id: Number(id), p_payout: s.payout, p_pnl: s.pnl, p_resolution_price: s.resolutionPrice }),
      'settle_paper_trade',
    );
  }

  async listTrades(opts: { status?: TradeRecord['status']; limit?: number } = {}): Promise<TradeRecord[]> {
    let q = this.db.from('paper_trades').select('*').order('id', { ascending: false }).limit(opts.limit ?? 5000);
    if (opts.status) q = q.eq('status', opts.status);
    return check(await q, 'list paper_trades').map(toTrade);
  }

  async recentSignals(limit: number): Promise<SignalRecord[]> {
    return check(await this.db.from('signals').select('*').order('id', { ascending: false }).limit(limit), 'list signals').map(toSignal);
  }

  async recordApiCall(c: ApiCall): Promise<void> {
    check(
      await this.db.from('api_calls').insert({ provider: c.provider, endpoint: c.endpoint, status: c.status, cost: c.cost, remaining: c.remaining, used: c.used }),
      'insert api_calls',
    );
  }

  async oddsCreditsUsedSince(iso: string): Promise<number> {
    const rows = check(await this.db.from('api_calls').select('cost').eq('provider', 'odds_api').gte('created_at', iso), 'sum api_calls');
    return rows.reduce((s, r) => s + n(r.cost), 0);
  }

  async lastOddsFetch(sportKey: string): Promise<string | null> {
    const rows = check(
      await this.db.from('api_calls').select('created_at').eq('provider', 'odds_api').eq('endpoint', sportKey).order('id', { ascending: false }).limit(1),
      'last odds fetch',
    );
    return rows[0] ? String(rows[0].created_at) : null;
  }

  async lastOddsRemaining(): Promise<number | null> {
    const rows = check(
      await this.db.from('api_calls').select('remaining').eq('provider', 'odds_api').not('remaining', 'is', null).order('id', { ascending: false }).limit(1),
      'last odds remaining',
    );
    return rows[0] ? nOrNull(rows[0].remaining) : null;
  }
}
