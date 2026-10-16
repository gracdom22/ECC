import { creditsAvailable, pickSportsToFetch, type SportDemand } from './budget.js';
import type { fetchBook } from './clients/clob.js';
import type { fetchMarket, fetchSeriesEvents } from './clients/gamma.js';
import { HttpError } from './clients/http.js';
import type { fetchSharpOdds } from './clients/oddsApi.js';
import type { AppConfig } from './config.js';
import { applyOpen, buildRiskState, checkRisk, type RiskState } from './engine/risk.js';
import { computeSettlement } from './engine/settle.js';
import { fairBookFor, gateQuote, planTrade, quoteFromBook, tokenFairProb, type Quote } from './engine/signals.js';
import type { League } from './leagues.js';
import type { Logger } from './logger.js';
import { computeEdge } from './math/edge.js';
import { matchGames, type GameMatch } from './matching/match.js';
import { parseGame, toPmMarket } from './polymarket/parse.js';
import type { Store } from './store/types.js';
import type { OddsEvent, PmGame, PmToken } from './types.js';

export interface ScannerApi {
  fetchSeriesEvents: typeof fetchSeriesEvents;
  fetchBook: typeof fetchBook;
  fetchSharpOdds: typeof fetchSharpOdds;
  fetchMarket: typeof fetchMarket;
}

export interface ScannerDeps {
  config: AppConfig;
  store: Store;
  logger: Logger;
  api: ScannerApi;
  now?: () => Date;
}

export type OddsMode = 'enabled' | 'missing_key' | 'invalid_key' | 'budget_exhausted';

export interface CycleReport {
  startedAt: string;
  finishedAt: string;
  persistence: Store['kind'];
  oddsMode: OddsMode;
  gamesByLeague: Record<string, number>;
  oddsFetched: string[];
  oddsCreditsAvailable: number | null;
  matched: number;
  unmatched: number;
  signals: number;
  trades: number;
  settled: number;
  errors: string[];
}

/** Screening slack: Gamma top-of-book can lag the CLOB slightly, so look at the book for anything near break-even. */
const SCREEN_EV = -0.01;

export function selectionLabel(game: PmGame, token: PmToken): string {
  const base = token.selection.kind === 'draw' ? 'Draw' : (game.teams[token.selection.teamIndex]?.name ?? '?');
  return token.negate ? `NO ${base}` : base;
}

function monthStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function dayStart(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export class Scanner {
  private readonly now: () => Date;
  private oddsKeyRejected = false;
  lastReport: CycleReport | null = null;

  constructor(private readonly deps: ScannerDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async init(): Promise<void> {
    await this.deps.store.ensureBankroll(this.deps.config.risk.startingBankroll);
  }

  async runCycle(): Promise<CycleReport> {
    const { config, logger } = this.deps;
    const report: CycleReport = {
      startedAt: this.now().toISOString(),
      finishedAt: '',
      persistence: this.deps.store.kind,
      oddsMode: !config.odds.apiKey ? 'missing_key' : this.oddsKeyRejected ? 'invalid_key' : 'enabled',
      gamesByLeague: {},
      oddsFetched: [],
      oddsCreditsAvailable: null,
      matched: 0,
      unmatched: 0,
      signals: 0,
      trades: 0,
      settled: 0,
      errors: [],
    };
    const fail = (where: string, err: unknown) => {
      const msg = `${where}: ${err instanceof Error ? err.message : String(err)}`;
      report.errors.push(msg);
      logger.error('cycle step failed', { where, error: msg });
    };

    try {
      report.settled = await this.settleOpenTrades();
    } catch (err) {
      fail('settlement', err);
    }

    const gamesByLeague = new Map<string, PmGame[]>();
    for (const league of config.leagues) {
      try {
        const games = await this.loadGames(league);
        gamesByLeague.set(league.key, games);
        report.gamesByLeague[league.key] = games.length;
      } catch (err) {
        fail(`polymarket ${league.key}`, err);
      }
    }

    if (report.oddsMode === 'missing_key') {
      logger.warn('ODDS_API_KEY not set: running Polymarket-only (no fair prices, no signals, no new paper trades)');
    } else if (report.oddsMode === 'enabled') {
      try {
        await this.oddsStep(gamesByLeague, report);
      } catch (err) {
        fail('odds', err);
      }
    }

    report.finishedAt = this.now().toISOString();
    this.lastReport = report;
    logger.info('cycle complete', { ...report, errors: report.errors.length });
    return report;
  }

  private async loadGames(league: League): Promise<PmGame[]> {
    const events = await this.deps.api.fetchSeriesEvents(league.polymarketSeriesId, this.now(), this.deps.config.polyLookaheadHours);
    const games: PmGame[] = [];
    for (const e of events) {
      const game = parseGame(e, league);
      if (!game) continue;
      await this.deps.store.upsertGame(game);
      games.push(game);
    }
    return games;
  }

  async settleOpenTrades(): Promise<number> {
    const open = await this.deps.store.listTrades({ status: 'open' });
    const markets = new Map<string, ReturnType<typeof toPmMarket>>();
    let settled = 0;
    for (const trade of open) {
      if (!markets.has(trade.marketId)) markets.set(trade.marketId, toPmMarket(await this.deps.api.fetchMarket(trade.marketId)));
      const s = computeSettlement(trade, markets.get(trade.marketId)!);
      if (!s) continue;
      await this.deps.store.settleTrade(trade.id, s);
      settled++;
      this.deps.logger.info('paper trade settled', { tradeId: trade.id, selection: trade.selection, payout: s.payout, pnl: s.pnl });
    }
    return settled;
  }

  private async oddsStep(gamesByLeague: Map<string, PmGame[]>, report: CycleReport): Promise<void> {
    const { config, store } = this.deps;
    const now = this.now();
    const [usedThisMonth, usedToday, apiRemaining] = await Promise.all([
      store.oddsCreditsUsedSince(monthStart(now)),
      store.oddsCreditsUsedSince(dayStart(now)),
      store.lastOddsRemaining(),
    ]);
    const credits = creditsAvailable({ now, monthlyBudget: config.odds.monthlyBudget, usedThisMonth, usedToday, apiRemaining, reserve: config.odds.reserve });
    report.oddsCreditsAvailable = credits;

    const horizon = now.getTime() + config.odds.lookaheadHours * 3600_000;
    const earliest = now.getTime() + config.strategy.minMinutesToStart * 60_000;
    const demand: SportDemand[] = [];
    const upcomingByLeague = new Map<string, PmGame[]>();
    for (const league of config.leagues) {
      const upcoming = (gamesByLeague.get(league.key) ?? []).filter((g) => {
        const t = Date.parse(g.startTime);
        return t >= earliest && t <= horizon;
      });
      if (upcoming.length === 0) continue;
      upcomingByLeague.set(league.key, upcoming);
      const nextStart = upcoming.map((g) => g.startTime).sort()[0]!;
      demand.push({ sportKey: league.oddsSportKey, nextStart, lastFetch: await store.lastOddsFetch(league.oddsSportKey) });
    }
    const toFetch = pickSportsToFetch(demand, now, config.odds.refreshHours, credits);
    if (credits <= 0 && demand.length > 0) report.oddsMode = 'budget_exhausted';

    for (const sportKey of toFetch) {
      const league = config.leagues.find((l) => l.oddsSportKey === sportKey)!;
      const events = await this.fetchOdds(sportKey, new Date(horizon));
      if (events === null) break;
      report.oddsFetched.push(sportKey);
      await this.evaluateLeague(upcomingByLeague.get(league.key) ?? [], events, report);
    }
  }

  private async fetchOdds(sportKey: string, commenceTo: Date): Promise<OddsEvent[] | null> {
    const { config, store, logger } = this.deps;
    try {
      const res = await this.deps.api.fetchSharpOdds({
        apiKey: config.odds.apiKey!,
        sportKey,
        region: config.odds.region,
        bookmaker: config.odds.bookmaker,
        commenceTo,
      });
      await store.recordApiCall({ provider: 'odds_api', endpoint: sportKey, status: 200, cost: res.quota.last ?? 1, remaining: res.quota.remaining, used: res.quota.used });
      return res.events;
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 0;
      await store.recordApiCall({ provider: 'odds_api', endpoint: sportKey, status, cost: status === 401 ? 0 : 1, remaining: null, used: null });
      if (status === 401 || status === 403) {
        this.oddsKeyRejected = true;
        logger.error('The Odds API rejected ODDS_API_KEY; odds disabled until restart');
        return null;
      }
      throw err;
    }
  }

  private async evaluateLeague(games: PmGame[], events: OddsEvent[], report: CycleReport): Promise<void> {
    const { config, store } = this.deps;
    const matches = matchGames(games, events, {
      timeToleranceMin: config.matchTimeToleranceMin,
      threshold: 0.75,
      ambiguityMargin: 0.05,
    });
    report.matched += matches.length;
    report.unmatched += games.length - matches.length;
    const matchedOddsIds = new Set(matches.map((m) => m.odds.id));

    for (const ev of events.filter((e) => !matchedOddsIds.has(e.id))) {
      await store.insertOddsSnapshot({
        oddsEventId: ev.id,
        sportKey: ev.sportKey,
        bookmaker: ev.bookmaker,
        commenceTime: ev.commenceTime,
        homeTeam: ev.homeTeam,
        awayTeam: ev.awayTeam,
        outcomes: ev.outcomes,
        fairProbs: null,
        overround: null,
        devigMethod: null,
        bookmakerLastUpdate: ev.bookmakerLastUpdate,
        eventId: null,
        matchScore: null,
      });
    }

    let risk = buildRiskState(await store.getCash(), await store.listTrades(), config.risk.startingBankroll, this.now());
    for (const match of matches) {
      risk = await this.evaluateMatch(match, risk, report);
    }
  }

  private async evaluateMatch(match: GameMatch, riskIn: RiskState, report: CycleReport): Promise<RiskState> {
    const { config, store, api, logger } = this.deps;
    let risk = riskIn;
    const fair = fairBookFor(match, config.strategy.devigMethod);
    const snapshotId = await store.insertOddsSnapshot({
      oddsEventId: match.odds.id,
      sportKey: match.odds.sportKey,
      bookmaker: match.odds.bookmaker,
      commenceTime: match.odds.commenceTime,
      homeTeam: match.odds.homeTeam,
      awayTeam: match.odds.awayTeam,
      outcomes: match.odds.outcomes,
      fairProbs: fair ? Object.fromEntries(fair.fair) : null,
      overround: fair?.overround ?? null,
      devigMethod: fair?.method ?? null,
      bookmakerLastUpdate: match.odds.bookmakerLastUpdate,
      eventId: match.game.eventId,
      matchScore: match.score,
    });
    if (!fair) return risk;

    const quotes: Array<{ token: PmToken; fairProb: number; quote: Quote; book: Awaited<ReturnType<ScannerApi['fetchBook']>> }> = [];
    for (const token of match.game.tokens) {
      const fairProb = tokenFairProb(match, token, fair);
      if (fairProb === null || fairProb <= 0 || fairProb >= 1 || token.gammaAsk === null) continue;
      if (computeEdge(fairProb, token.gammaAsk, token.fees).ev < SCREEN_EV) continue;
      const book = await api.fetchBook(token.tokenId);
      const quote = quoteFromBook(fairProb, token, book);
      if (quote && quote.edge.ev > 0) quotes.push({ token, fairProb, quote, book });
    }
    quotes.sort((a, b) => b.quote.edge.ev - a.quote.edge.ev);

    for (const { token, fairProb, quote, book } of quotes) {
      const selection = selectionLabel(match.game, token);
      const gate = gateQuote(quote, token, { now: this.now(), gameStart: match.game.startTime, bookmakerLastUpdate: match.odds.bookmakerLastUpdate }, config.strategy);
      const decision = checkRisk(risk, match.game.eventId, config.risk);
      const plan = gate ? null : planTrade(fairProb, quote, token, book, risk.equity, decision, config.strategy);
      const status = gate?.status ?? plan!.status;
      const reason = gate?.reason ?? (plan && plan.status !== 'traded' ? plan.reason : null);
      const signalId = await store.insertSignal({
        eventId: match.game.eventId,
        marketId: token.marketId,
        tokenId: token.tokenId,
        question: token.question,
        selection,
        oddsSnapshotId: snapshotId,
        fairProb,
        bestAsk: quote.bestAsk,
        bestBid: quote.bestBid,
        feePerShare: quote.edge.fee,
        cost: quote.edge.cost,
        ev: quote.edge.ev,
        edge: quote.edge.edge,
        fullKelly: plan?.fullKelly ?? 0,
        suggestedStake: plan?.stake ?? 0,
        status,
        reason,
      });
      if (signalId === null) continue;
      report.signals++;
      if (plan?.status !== 'traded') continue;

      const trade = await store.openTrade({
        signalId,
        eventId: match.game.eventId,
        marketId: token.marketId,
        tokenId: token.tokenId,
        question: token.question,
        selection,
        outcomeIndex: token.outcomeIndex,
        shares: Math.floor(plan.fill.shares * 1e4) / 1e4,
        avgPrice: plan.fill.avgPrice,
        fees: plan.fill.fees,
        cost: Math.round(plan.fill.cost * 100) / 100,
        fairProb,
        evAtEntry: plan.evAtFill,
      });
      risk = applyOpen(risk, match.game.eventId, trade.cost);
      report.trades++;
      logger.info('paper trade opened', { tradeId: trade.id, game: match.game.title, selection, cost: trade.cost, ev: plan.evAtFill });
    }
    return risk;
  }
}
