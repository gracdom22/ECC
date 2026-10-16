export interface BudgetInput {
  now: Date;
  monthlyBudget: number;
  usedThisMonth: number;
  usedToday: number;
  /** Last `x-requests-remaining` seen from The Odds API, if any. */
  apiRemaining: number | null;
  reserve: number;
}

export function daysLeftInMonth(now: Date): number {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return end.getUTCDate() - now.getUTCDate() + 1;
}

/** How many Odds API credits may be spent right now, spreading the monthly budget evenly over remaining days. */
export function creditsAvailable(b: BudgetInput): number {
  const usedBeforeToday = Math.max(0, b.usedThisMonth - b.usedToday);
  const dailyAllowance = Math.floor(Math.max(0, b.monthlyBudget - usedBeforeToday) / daysLeftInMonth(b.now));
  let allowed = Math.min(dailyAllowance - b.usedToday, b.monthlyBudget - b.usedThisMonth);
  if (b.apiRemaining !== null) allowed = Math.min(allowed, b.apiRemaining - b.reserve);
  return Math.max(0, allowed);
}

export interface SportDemand {
  sportKey: string;
  nextStart: string;
  lastFetch: string | null;
}

/** Sports due for a refresh, soonest game first, limited to the credits available. */
export function pickSportsToFetch(demand: readonly SportDemand[], now: Date, refreshHours: number, credits: number): string[] {
  const due = demand.filter((d) => !d.lastFetch || now.getTime() - Date.parse(d.lastFetch) >= refreshHours * 3600_000);
  due.sort((a, b) => Date.parse(a.nextStart) - Date.parse(b.nextStart));
  return due.slice(0, Math.max(0, credits)).map((d) => d.sportKey);
}
