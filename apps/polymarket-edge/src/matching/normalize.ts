const STOPWORDS = new Set([
  'fc', 'afc', 'cf', 'sc', 'ac', 'as', 'ssc', 'cd', 'ud', 'rc', 'rcd', 'sd', 'ca', 'club', 'de', 'del', 'la', 'the',
  'calcio', 'fk', 'sv', 'vfb', 'vfl', 'tsg', 'bsc', 'us', 'ogc', 'losc', 'stade', 'and', 'hotspur', 'albion',
]);

/** Token-level synonyms so that local-language and English names collapse together. */
const TOKEN_SYNONYMS: Record<string, string> = {
  munchen: 'munich',
  koln: 'cologne',
  internazionale: 'inter',
  utd: 'united',
  man: 'manchester',
  st: 'saint',
  wolves: 'wolverhampton',
  spurs: 'tottenham',
  psg: 'paris saint germain',
  nottm: 'nottingham',
  sheff: 'sheffield',
  gladbach: 'monchengladbach',
  rennais: 'rennes',
  brestois: 'brest',
};

/** Whole-name aliases applied after normalisation. */
const NAME_ALIASES: Record<string, string> = {
  'paris sg': 'paris saint germain',
  'inter milan': 'inter',
  'inter milano': 'inter',
  'atl madrid': 'atletico madrid',
  'athletic bilbao': 'athletic',
  'bayer leverkusen': 'leverkusen',
  'borussia dortmund': 'dortmund',
  'borussia monchengladbach': 'monchengladbach',
  'olympique lyonnais': 'lyon',
  'olympique marseille': 'marseille',
  'brighton hove': 'brighton',
};

export function normalizeTeamName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .map((t) => TOKEN_SYNONYMS[t] ?? t)
    .join(' ')
    .split(' ')
    .filter((t) => t !== '' && !STOPWORDS.has(t) && !/^\d+$/.test(t))
    .join(' ');
  return NAME_ALIASES[base] ?? base;
}

export function tokens(name: string): Set<string> {
  return new Set(normalizeTeamName(name).split(' ').filter(Boolean));
}

/**
 * Similarity in [0, 1]. Exact normalised match scores 1. Otherwise a blend of
 * containment ("Heat" inside "Miami Heat") and Jaccard (penalises extra tokens,
 * so "Paris" vs "Paris Saint Germain" scores lower than an exact match).
 */
export function teamSimilarity(a: string, b: string): number {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokens(a);
  const tb = tokens(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  if (inter === 0) return 0;
  const containment = inter / Math.min(ta.size, tb.size);
  const jaccard = inter / (ta.size + tb.size - inter);
  return 0.7 * containment + 0.3 * jaccard;
}
