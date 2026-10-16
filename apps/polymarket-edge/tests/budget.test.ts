import { describe, expect, it } from 'vitest';
import { creditsAvailable, daysLeftInMonth, pickSportsToFetch } from '../src/budget.js';

describe('daysLeftInMonth', () => {
  it('counts today', () => {
    expect(daysLeftInMonth(new Date('2026-10-16T05:00:00Z'))).toBe(16);
    expect(daysLeftInMonth(new Date('2026-10-31T23:00:00Z'))).toBe(1);
    expect(daysLeftInMonth(new Date('2026-02-01T00:00:00Z'))).toBe(28);
  });
});

describe('creditsAvailable', () => {
  const now = new Date('2026-10-16T05:00:00Z');

  it('spreads the remaining monthly budget over remaining days', () => {
    expect(creditsAvailable({ now, monthlyBudget: 450, usedThisMonth: 290, usedToday: 0, apiRemaining: null, reserve: 10 })).toBe(10);
    expect(creditsAvailable({ now, monthlyBudget: 450, usedThisMonth: 296, usedToday: 6, apiRemaining: null, reserve: 10 })).toBe(4);
  });

  it('never exceeds the API-reported remaining quota minus the reserve', () => {
    expect(creditsAvailable({ now, monthlyBudget: 450, usedThisMonth: 0, usedToday: 0, apiRemaining: 12, reserve: 10 })).toBe(2);
    expect(creditsAvailable({ now, monthlyBudget: 450, usedThisMonth: 0, usedToday: 0, apiRemaining: 5, reserve: 10 })).toBe(0);
  });

  it('is zero once the monthly budget is spent', () => {
    expect(creditsAvailable({ now, monthlyBudget: 100, usedThisMonth: 100, usedToday: 0, apiRemaining: null, reserve: 0 })).toBe(0);
  });
});

describe('pickSportsToFetch', () => {
  const now = new Date('2026-10-16T12:00:00Z');
  const demand = [
    { sportKey: 'soccer_epl', nextStart: '2026-10-17T11:30:00Z', lastFetch: null },
    { sportKey: 'basketball_nba', nextStart: '2026-10-16T23:00:00Z', lastFetch: '2026-10-16T09:00:00Z' },
    { sportKey: 'soccer_spain_la_liga', nextStart: '2026-10-16T19:00:00Z', lastFetch: '2026-10-16T02:00:00Z' },
  ];

  it('skips recently fetched sports and orders by soonest game', () => {
    expect(pickSportsToFetch(demand, now, 6, 10)).toEqual(['soccer_spain_la_liga', 'soccer_epl']);
  });

  it('respects the credit limit', () => {
    expect(pickSportsToFetch(demand, now, 6, 1)).toEqual(['soccer_spain_la_liga']);
    expect(pickSportsToFetch(demand, now, 6, 0)).toEqual([]);
  });
});
