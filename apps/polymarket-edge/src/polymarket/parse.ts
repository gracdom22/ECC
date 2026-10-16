import type { GammaEvent, GammaMarket } from '../clients/gamma.js';
import type { League } from '../leagues.js';
import { NO_FEES, type FeeSchedule } from '../math/edge.js';
import { normalizeTeamName } from '../matching/normalize.js';
import type { PmGame, PmMarket, PmTeam, PmToken, Selection } from '../types.js';

/** Used when Gamma says fees are on but omits the schedule: assume the sports default rather than zero. */
export const FALLBACK_FEES: FeeSchedule = { rate: 0.05, exponent: 1 };

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function marketFees(m: GammaMarket): FeeSchedule {
  if (!m.feesEnabled) return NO_FEES;
  const s = m.feeSchedule;
  if (s && Number.isFinite(s.rate) && Number.isFinite(s.exponent) && s.rate >= 0) return { rate: s.rate, exponent: s.exponent };
  return FALLBACK_FEES;
}

/** Ask for outcome i from Gamma's top-of-book on outcome 0 (complementary on the other side). */
export function gammaAsk(m: GammaMarket, outcomeIndex: number): number | null {
  const v = outcomeIndex === 0 ? m.bestAsk : m.bestBid != null ? 1 - m.bestBid : null;
  if (v == null || !Number.isFinite(v) || v <= 0 || v >= 1) return null;
  return Math.round(v * 10000) / 10000;
}

export function toPmMarket(m: GammaMarket): PmMarket {
  return {
    id: m.id,
    conditionId: m.conditionId,
    question: m.question,
    marketType: m.sportsMarketType ?? 'unknown',
    outcomes: parseJsonArray(m.outcomes),
    tokenIds: parseJsonArray(m.clobTokenIds),
    outcomePrices: parseJsonArray(m.outcomePrices).map(Number),
    closed: Boolean(m.closed),
    resolutionStatus: m.umaResolutionStatus ?? null,
    liquidity: m.liquidityNum ?? 0,
  };
}

function teamIndexForLabel(teams: readonly PmTeam[], label: string): number {
  const norm = normalizeTeamName(label);
  return teams.findIndex((t) => normalizeTeamName(t.name) === norm || (t.alias != null && normalizeTeamName(t.alias) === norm));
}

function baseToken(m: GammaMarket, pm: PmMarket, outcomeIndex: number, selection: Selection, negate: boolean): PmToken | null {
  const tokenId = pm.tokenIds[outcomeIndex];
  if (!tokenId) return null;
  return {
    marketId: m.id,
    conditionId: m.conditionId,
    question: m.question,
    tokenId,
    outcomeIndex,
    outcomeLabel: pm.outcomes[outcomeIndex] ?? String(outcomeIndex),
    selection,
    negate,
    gammaAsk: gammaAsk(m, outcomeIndex),
    fees: marketFees(m),
    acceptingOrders: m.acceptingOrders !== false && !m.closed,
  };
}

/** Two-way moneyline (NBA/NFL): one market whose outcomes are the two team names. */
function twoWayTokens(markets: GammaMarket[], teams: PmTeam[]): PmToken[] | null {
  if (markets.length !== 1) return null;
  const m = markets[0]!;
  const pm = toPmMarket(m);
  if (pm.outcomes.length !== 2 || pm.tokenIds.length !== 2) return null;
  const idx = pm.outcomes.map((o) => teamIndexForLabel(teams, o));
  if (idx.some((i) => i < 0) || idx[0] === idx[1]) return null;
  const out = idx.map((teamIndex, i) => baseToken(m, pm, i, { kind: 'team', teamIndex }, false));
  return out.every(Boolean) ? (out as PmToken[]) : null;
}

function soccerSelection(m: GammaMarket, teams: PmTeam[]): Selection | null {
  const suffix = m.slug.split('-').pop()?.toLowerCase() ?? '';
  if (suffix === 'draw' || (m.groupItemTitle ?? '').toLowerCase().startsWith('draw')) return { kind: 'draw' };
  const byAbbr = teams.findIndex((t) => t.abbreviation?.toLowerCase() === suffix);
  if (byAbbr >= 0) return { kind: 'team', teamIndex: byAbbr };
  const byTitle = m.groupItemTitle ? teamIndexForLabel(teams, m.groupItemTitle) : -1;
  return byTitle >= 0 ? { kind: 'team', teamIndex: byTitle } : null;
}

/** Three-way 1X2 (soccer): three Yes/No markets for home win, draw, away win. */
function threeWayTokens(markets: GammaMarket[], teams: PmTeam[]): PmToken[] | null {
  if (markets.length !== 3) return null;
  const tokens: PmToken[] = [];
  const seen = new Set<string>();
  for (const m of markets) {
    const pm = toPmMarket(m);
    if (pm.outcomes[0] !== 'Yes' || pm.outcomes[1] !== 'No' || pm.tokenIds.length !== 2) return null;
    const sel = soccerSelection(m, teams);
    if (!sel) return null;
    const key = sel.kind === 'draw' ? 'draw' : `team${sel.teamIndex}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const yes = baseToken(m, pm, 0, sel, false);
    const no = baseToken(m, pm, 1, sel, true);
    if (!yes || !no) return null;
    tokens.push(yes, no);
  }
  return seen.size === 3 ? tokens : null;
}

/** Converts a Gamma event into a game with moneyline tokens; returns null when the shape is unexpected (fail closed). */
export function parseGame(event: GammaEvent, league: League): PmGame | null {
  const teams: PmTeam[] = (event.teams ?? []).map((t) => ({
    name: t.name,
    alias: t.alias ?? undefined,
    abbreviation: t.abbreviation ?? undefined,
    ordering: t.ordering === 'home' || t.ordering === 'away' ? t.ordering : undefined,
  }));
  if (teams.length !== 2) return null;
  const moneyline = event.markets.filter((m) => m.sportsMarketType === 'moneyline');
  if (moneyline.length === 0) return null;
  const startRaw = event.startTime ?? moneyline[0]!.gameStartTime?.replace(' ', 'T').replace(/\+00$/, 'Z') ?? event.endDate;
  if (!startRaw || !Number.isFinite(Date.parse(startRaw))) return null;
  const tokens = league.threeWay ? threeWayTokens(moneyline, teams) : twoWayTokens(moneyline, teams);
  if (!tokens) return null;
  return {
    eventId: event.id,
    slug: event.slug,
    title: event.title,
    league: league.key,
    startTime: new Date(startRaw).toISOString(),
    teams,
    markets: moneyline.map(toPmMarket),
    tokens,
  };
}
