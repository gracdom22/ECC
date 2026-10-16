import { describe, expect, it } from 'vitest';
import { LEAGUES } from '../src/leagues.js';
import { matchGame, matchGames, scoreTeams, selectionFairProb, DEFAULT_MATCH_OPTIONS } from '../src/matching/match.js';
import { normalizeTeamName, teamSimilarity } from '../src/matching/normalize.js';
import { parseGame } from '../src/polymarket/parse.js';
import type { PmGame } from '../src/types.js';
import { nbaEvent, oddsEvent, soccerEvent } from './fixtures.js';

describe('normalizeTeamName', () => {
  it.each([
    ['Everton FC', 'everton'],
    ['1. FC Köln', 'cologne'],
    ['FC Bayern München', 'bayern munich'],
    ['Brighton & Hove Albion FC', 'brighton'],
    ['Brighton and Hove Albion', 'brighton'],
    ['Paris Saint-Germain FC', 'paris saint germain'],
    ['PSG', 'paris saint germain'],
    ['Bayer 04 Leverkusen', 'leverkusen'],
    ['Atlético de Madrid', 'atletico madrid'],
    ['Inter Milan', 'inter'],
    ['FC Internazionale Milano', 'inter'],
    ['Tottenham Hotspur', 'tottenham'],
    ['Man Utd', 'manchester united'],
    ['Philadelphia 76ers', 'philadelphia 76ers'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeTeamName(raw)).toBe(expected);
  });
});

describe('teamSimilarity', () => {
  it('scores exact normalised names as 1', () => {
    expect(teamSimilarity('Everton FC', 'Everton')).toBe(1);
    expect(teamSimilarity('Manchester United FC', 'Man Utd')).toBe(1);
  });

  it('accepts a nickname contained in the full name', () => {
    expect(teamSimilarity('Heat', 'Miami Heat')).toBeGreaterThanOrEqual(DEFAULT_MATCH_OPTIONS.threshold);
    expect(teamSimilarity('76ers', 'Philadelphia 76ers')).toBeGreaterThanOrEqual(DEFAULT_MATCH_OPTIONS.threshold);
  });

  it('rejects same-city different clubs', () => {
    expect(teamSimilarity('Manchester City', 'Manchester United')).toBeLessThan(DEFAULT_MATCH_OPTIONS.threshold);
    expect(teamSimilarity('Real Madrid', 'Atletico Madrid')).toBeLessThan(DEFAULT_MATCH_OPTIONS.threshold);
    expect(teamSimilarity('New York Giants', 'New York Jets')).toBeLessThan(DEFAULT_MATCH_OPTIONS.threshold);
    expect(teamSimilarity('AC Milan', 'Inter Milan')).toBe(0);
  });

  it('returns 0 for empty names', () => {
    expect(teamSimilarity('FC', 'Everton')).toBe(0);
  });
});

const START = '2026-10-16T23:00:00Z';

function nbaGame(): PmGame {
  return parseGame(nbaEvent({ away: 'Heat', home: 'Magic', start: START }), LEAGUES.nba!)!;
}

describe('matchGame', () => {
  const odds = oddsEvent({ home: 'Orlando Magic', away: 'Miami Heat', start: '2026-10-16T23:10:00Z', prices: { 'Orlando Magic': 1.7, 'Miami Heat': 2.25 } });

  it('maps Polymarket teams to bookmaker names by identity, not position', () => {
    const m = matchGame(nbaGame(), [odds])!;
    expect(m).not.toBeNull();
    expect(m.teamMap).toEqual(['Miami Heat', 'Orlando Magic']);
    expect(m.score).toBeGreaterThan(0.8);
  });

  it('rejects candidates outside the time window', () => {
    const late = { ...odds, commenceTime: '2026-10-17T05:00:00Z' };
    expect(matchGame(nbaGame(), [late])).toBeNull();
  });

  it('rejects when only one team matches', () => {
    const other = oddsEvent({ home: 'Orlando Magic', away: 'Boston Celtics', start: START, prices: { 'Orlando Magic': 1.7, 'Boston Celtics': 2.2 } });
    expect(matchGame(nbaGame(), [other])).toBeNull();
  });

  it('fails closed when two candidates are equally good', () => {
    const dup = { ...odds, id: 'dup' };
    expect(matchGame(nbaGame(), [odds, dup])).toBeNull();
  });

  it('ignores candidates with unparseable times', () => {
    expect(matchGame(nbaGame(), [{ ...odds, commenceTime: 'not-a-date' }])).toBeNull();
  });

  it('handles a same-city derby by picking the exact orientation', () => {
    const game = parseGame(soccerEvent({ home: ['Paris Saint-Germain FC', 'psg'], away: ['Paris FC', 'pfc'], start: START }), LEAGUES.ligue1!)!;
    const derby = oddsEvent({ home: 'Paris Saint Germain', away: 'Paris FC', start: START, prices: { 'Paris Saint Germain': 1.3, 'Paris FC': 9, Draw: 5.5 } });
    expect(matchGame(game, [derby])!.teamMap).toEqual(['Paris Saint Germain', 'Paris FC']);
  });
});

describe('scoreTeams', () => {
  it('requires exactly two teams', () => {
    const odds = oddsEvent({ home: 'A', away: 'B', start: START, prices: { A: 2, B: 2 } });
    expect(scoreTeams([{ name: 'A' }], odds, DEFAULT_MATCH_OPTIONS)).toBeNull();
  });
});

describe('matchGames', () => {
  it('drops games that collide on the same bookmaker event', () => {
    const odds = oddsEvent({ home: 'Orlando Magic', away: 'Miami Heat', start: START, prices: { 'Orlando Magic': 1.7, 'Miami Heat': 2.25 } });
    const a = nbaGame();
    const b = { ...nbaGame(), eventId: 'dup-game' };
    expect(matchGames([a], [odds])).toHaveLength(1);
    expect(matchGames([a, b], [odds])).toHaveLength(0);
  });
});

describe('selectionFairProb', () => {
  it('looks up team and draw probabilities', () => {
    const odds = oddsEvent({ home: 'Orlando Magic', away: 'Miami Heat', start: START, prices: { 'Orlando Magic': 1.7, 'Miami Heat': 2.25 } });
    const m = matchGame(nbaGame(), [odds])!;
    const fair = new Map([['Miami Heat', 0.43], ['Orlando Magic', 0.57], ['Draw', 0.1]]);
    expect(selectionFairProb(m, { kind: 'team', teamIndex: 0 }, fair)).toBe(0.43);
    expect(selectionFairProb(m, { kind: 'draw' }, fair)).toBe(0.1);
    expect(selectionFairProb(m, { kind: 'team', teamIndex: 5 }, fair)).toBeNull();
    expect(selectionFairProb(m, { kind: 'draw' }, new Map())).toBeNull();
  });
});
