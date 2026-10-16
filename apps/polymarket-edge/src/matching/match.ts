import type { OddsEvent, PmGame, PmTeam } from '../types.js';
import { teamSimilarity } from './normalize.js';

export interface MatchOptions {
  /** Max |start time difference| in minutes. */
  timeToleranceMin: number;
  /** Min similarity each team must reach. */
  threshold: number;
  /** Required gap between best and runner-up candidate; otherwise the match is ambiguous and skipped. */
  ambiguityMargin: number;
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = { timeToleranceMin: 180, threshold: 0.75, ambiguityMargin: 0.05 };

export interface GameMatch {
  game: PmGame;
  odds: OddsEvent;
  /** For each Polymarket team index, the bookmaker team name. */
  teamMap: string[];
  score: number;
}

function pmTeamSimilarity(team: PmTeam, bookName: string): number {
  const candidates = [team.name, team.alias].filter((x): x is string => Boolean(x));
  return Math.max(0, ...candidates.map((c) => teamSimilarity(c, bookName)));
}

interface Orientation {
  score: number;
  teamMap: string[];
}

/** Scores both team orientations; fails closed when either team is weak or orientation is ambiguous. */
export function scoreTeams(teams: readonly PmTeam[], odds: OddsEvent, opts: MatchOptions): Orientation | null {
  if (teams.length !== 2) return null;
  const [a, b] = teams as [PmTeam, PmTeam];
  const options: Orientation[] = [
    { teamMap: [odds.homeTeam, odds.awayTeam], score: 0 },
    { teamMap: [odds.awayTeam, odds.homeTeam], score: 0 },
  ];
  const valid: Orientation[] = [];
  for (const o of options) {
    const sa = pmTeamSimilarity(a, o.teamMap[0]!);
    const sb = pmTeamSimilarity(b, o.teamMap[1]!);
    if (sa >= opts.threshold && sb >= opts.threshold) valid.push({ teamMap: o.teamMap, score: (sa + sb) / 2 });
  }
  if (valid.length === 0) return null;
  valid.sort((x, y) => y.score - x.score);
  if (valid.length > 1 && valid[0]!.score - valid[1]!.score < opts.ambiguityMargin) return null;
  return valid[0]!;
}

export function minutesBetween(isoA: string, isoB: string): number {
  return Math.abs(Date.parse(isoA) - Date.parse(isoB)) / 60000;
}

export function matchGame(game: PmGame, candidates: readonly OddsEvent[], opts: MatchOptions = DEFAULT_MATCH_OPTIONS): GameMatch | null {
  const scored: GameMatch[] = [];
  for (const odds of candidates) {
    if (!Number.isFinite(Date.parse(odds.commenceTime)) || !Number.isFinite(Date.parse(game.startTime))) continue;
    if (minutesBetween(game.startTime, odds.commenceTime) > opts.timeToleranceMin) continue;
    const orientation = scoreTeams(game.teams, odds, opts);
    if (orientation) scored.push({ game, odds, teamMap: orientation.teamMap, score: orientation.score });
  }
  if (scored.length === 0) return null;
  scored.sort((x, y) => y.score - x.score);
  if (scored.length > 1 && scored[0]!.score - scored[1]!.score < opts.ambiguityMargin) return null;
  return scored[0]!;
}

/** Matches every game, refusing to map two games onto the same bookmaker event. */
export function matchGames(games: readonly PmGame[], candidates: readonly OddsEvent[], opts: MatchOptions = DEFAULT_MATCH_OPTIONS): GameMatch[] {
  const matches = games.map((g) => matchGame(g, candidates, opts)).filter((m): m is GameMatch => m !== null);
  const byOdds = new Map<string, GameMatch[]>();
  for (const m of matches) byOdds.set(m.odds.id, [...(byOdds.get(m.odds.id) ?? []), m]);
  return matches.filter((m) => byOdds.get(m.odds.id)!.length === 1);
}

/**
 * Fair probability that a Polymarket selection happens, given the matched event's
 * de-vigged probabilities keyed by bookmaker outcome name.
 */
export function selectionFairProb(
  match: GameMatch,
  selection: { kind: 'team'; teamIndex: number } | { kind: 'draw' },
  fairByOutcome: ReadonlyMap<string, number>,
): number | null {
  if (selection.kind === 'draw') return fairByOutcome.get('Draw') ?? null;
  const bookName = match.teamMap[selection.teamIndex];
  if (bookName === undefined) return null;
  return fairByOutcome.get(bookName) ?? null;
}
