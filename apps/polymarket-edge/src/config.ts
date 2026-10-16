import { z } from 'zod';
import { resolveLeagues, type League } from './leagues.js';
import type { StrategyConfig } from './engine/signals.js';
import type { RiskLimits } from './engine/risk.js';

const bool = z
  .string()
  .optional()
  .transform((v) => (v === undefined ? undefined : ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase())));
const num = (def: number, min: number, max: number) => z.coerce.number().min(min).max(max).default(def);
const optionalSecret = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const EnvSchema = z.object({
  PORT: num(8080, 1, 65535),
  LEAGUES: z.string().default('nba,nfl,epl,laliga,bundesliga,seriea,ligue1,ucl'),
  SCAN_INTERVAL_MIN: num(10, 1, 1440),
  POLY_LOOKAHEAD_HOURS: num(48, 1, 336),

  ODDS_API_KEY: optionalSecret,
  ODDS_REGION: z.string().default('eu'),
  ODDS_BOOKMAKER: z.string().default('pinnacle'),
  ODDS_LOOKAHEAD_HOURS: num(24, 1, 168),
  ODDS_REFRESH_HOURS: num(6, 0.25, 168),
  ODDS_MONTHLY_BUDGET: num(450, 0, 5_000_000),
  ODDS_RESERVE: num(10, 0, 1_000_000),
  DEVIG_METHOD: z.enum(['multiplicative', 'power', 'shin']).default('power'),
  MATCH_TIME_TOLERANCE_MIN: num(180, 5, 1440),

  SUPABASE_URL: z.string().url().default('https://ylhojqettwscqrobjtze.supabase.co'),
  SUPABASE_SECRET_KEY: optionalSecret,

  PAPER_TRADING_ENABLED: bool,
  BANKROLL_START: num(1000, 1, 1_000_000),
  KELLY_FRACTION: num(0.25, 0, 1),
  MAX_STAKE_PCT: num(0.02, 0, 0.5),
  MAX_STAKE_USD: num(25, 0, 1_000_000),
  MIN_STAKE_USD: num(1, 0, 1_000_000),
  MIN_EDGE: num(0.02, 0, 1),
  MAX_EDGE: num(0.15, 0, 10),
  MAX_SPREAD: num(0.05, 0, 1),
  MIN_MINUTES_TO_START: num(15, 0, 10_000),
  MAX_ODDS_AGE_MIN: num(360, 1, 100_000),
  MAX_OPEN_EXPOSURE_PCT: num(0.25, 0, 1),
  MAX_DAILY_LOSS_PCT: num(0.05, 0, 1),
  MAX_DRAWDOWN_PCT: num(0.3, 0, 1),
  MAX_TRADES_PER_DAY: num(20, 0, 10_000),

  DASHBOARD_PASSWORD: optionalSecret,
});

export interface AppConfig {
  port: number;
  leagues: League[];
  scanIntervalMin: number;
  polyLookaheadHours: number;
  odds: {
    apiKey?: string;
    region: string;
    bookmaker: string;
    lookaheadHours: number;
    refreshHours: number;
    monthlyBudget: number;
    reserve: number;
  };
  matchTimeToleranceMin: number;
  supabase: { url: string; secretKey?: string };
  strategy: StrategyConfig;
  risk: RiskLimits;
  dashboardPassword?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    leagues: resolveLeagues(e.LEAGUES.split(',').filter((s) => s.trim())),
    scanIntervalMin: e.SCAN_INTERVAL_MIN,
    polyLookaheadHours: e.POLY_LOOKAHEAD_HOURS,
    odds: {
      apiKey: e.ODDS_API_KEY,
      region: e.ODDS_REGION,
      bookmaker: e.ODDS_BOOKMAKER,
      lookaheadHours: e.ODDS_LOOKAHEAD_HOURS,
      refreshHours: e.ODDS_REFRESH_HOURS,
      monthlyBudget: e.ODDS_MONTHLY_BUDGET,
      reserve: e.ODDS_RESERVE,
    },
    matchTimeToleranceMin: e.MATCH_TIME_TOLERANCE_MIN,
    supabase: { url: e.SUPABASE_URL, secretKey: e.SUPABASE_SECRET_KEY },
    strategy: {
      devigMethod: e.DEVIG_METHOD,
      minEdge: e.MIN_EDGE,
      maxEdge: e.MAX_EDGE,
      maxSpread: e.MAX_SPREAD,
      minMinutesToStart: e.MIN_MINUTES_TO_START,
      maxOddsAgeMin: e.MAX_ODDS_AGE_MIN,
      paperTradingEnabled: e.PAPER_TRADING_ENABLED ?? true,
      sizing: {
        kellyMultiplier: e.KELLY_FRACTION,
        maxStakePct: e.MAX_STAKE_PCT,
        maxStakeUsd: e.MAX_STAKE_USD,
        minStakeUsd: e.MIN_STAKE_USD,
      },
    },
    risk: {
      startingBankroll: e.BANKROLL_START,
      maxOpenExposurePct: e.MAX_OPEN_EXPOSURE_PCT,
      maxDailyLossPct: e.MAX_DAILY_LOSS_PCT,
      maxDrawdownPct: e.MAX_DRAWDOWN_PCT,
      maxTradesPerDay: e.MAX_TRADES_PER_DAY,
    },
    dashboardPassword: e.DASHBOARD_PASSWORD,
  };
}
