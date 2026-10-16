export interface League {
  key: string;
  name: string;
  /** Polymarket Gamma `series_id` (from GET /sports). */
  polymarketSeriesId: string;
  /** The Odds API sport key. */
  oddsSportKey: string;
  /** Soccer moneyline is 1X2: three Yes/No markets per game. */
  threeWay: boolean;
}

export const LEAGUES: Record<string, League> = {
  nba: { key: 'nba', name: 'NBA', polymarketSeriesId: '10345', oddsSportKey: 'basketball_nba', threeWay: false },
  nfl: { key: 'nfl', name: 'NFL', polymarketSeriesId: '12185', oddsSportKey: 'americanfootball_nfl', threeWay: false },
  epl: { key: 'epl', name: 'Premier League', polymarketSeriesId: '10188', oddsSportKey: 'soccer_epl', threeWay: true },
  laliga: { key: 'laliga', name: 'LaLiga', polymarketSeriesId: '10193', oddsSportKey: 'soccer_spain_la_liga', threeWay: true },
  bundesliga: { key: 'bundesliga', name: 'Bundesliga', polymarketSeriesId: '10194', oddsSportKey: 'soccer_germany_bundesliga', threeWay: true },
  seriea: { key: 'seriea', name: 'Serie A', polymarketSeriesId: '10203', oddsSportKey: 'soccer_italy_serie_a', threeWay: true },
  ligue1: { key: 'ligue1', name: 'Ligue 1', polymarketSeriesId: '10195', oddsSportKey: 'soccer_france_ligue_one', threeWay: true },
  ucl: { key: 'ucl', name: 'UEFA Champions League', polymarketSeriesId: '10204', oddsSportKey: 'soccer_uefa_champs_league', threeWay: true },
};

export function resolveLeagues(keys: readonly string[]): League[] {
  return keys.map((k) => {
    const league = LEAGUES[k.trim().toLowerCase()];
    if (!league) throw new Error(`Unknown league "${k}". Valid: ${Object.keys(LEAGUES).join(', ')}`);
    return league;
  });
}
