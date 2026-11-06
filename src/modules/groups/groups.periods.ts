import { lagosParts } from '../recurring/schedule';
import type { GroupPeriod } from './models/group.model';

/**
 * Dues periods, counted from the day a member's periods start, in Lagos time. Period `k` begins
 * `k` weeks, months or years after the start; month-based ones keep the start's day of the month,
 * clamped to short months (31 Jan → 28 Feb → 31 Mar), so they never drift. Joining starts the
 * first period at once: join on a monthly plan today and this month is owed today.
 */
const LAGOS_OFFSET_MS = 60 * 60_000;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Midnight in Lagos on that calendar day, as a UTC instant. */
export const lagosMidnight = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d) - LAGOS_OFFSET_MS);

const MONTHS: Record<Exclude<GroupPeriod, 'weekly'>, number> = { monthly: 1, yearly: 12 };

/** When period `k` begins (negative `k` is before the start, for backfills). */
export function periodStart(startsAt: Date, period: GroupPeriod, anchorDay: number, k: number) {
  const { y, m, d } = lagosParts(startsAt);
  if (period === 'weekly') return lagosMidnight(y, m, d + 7 * k);
  const months = y * 12 + m + MONTHS[period] * k;
  const ny = Math.floor(months / 12);
  const nm = ((months % 12) + 12) % 12;
  return lagosMidnight(ny, nm, Math.min(anchorDay, daysInMonth(ny, nm)));
}

/** How many periods have begun by `now`: the ones a member owes for so far. */
export function periodsDue(startsAt: Date, period: GroupPeriod, anchorDay: number, now = new Date()) {
  if (now < startsAt) return 0;
  // A close first guess, then step: exact whatever the month lengths.
  const days = (now.getTime() - startsAt.getTime()) / 86_400_000;
  let k = Math.max(0, Math.floor(period === 'weekly' ? days / 7 : period === 'monthly' ? days / 31 : days / 366));
  while (periodStart(startsAt, period, anchorDay, k + 1) <= now) k++;
  return k + 1;
}

/** The index of the period `at` falls in, before the start too (negative). */
export function periodIndex(startsAt: Date, period: GroupPeriod, anchorDay: number, at: Date) {
  const days = (at.getTime() - startsAt.getTime()) / 86_400_000;
  let k = Math.floor(period === 'weekly' ? days / 7 : period === 'monthly' ? days / 30.44 : days / 365.25);
  while (periodStart(startsAt, period, anchorDay, k) > at) k--;
  while (periodStart(startsAt, period, anchorDay, k + 1) <= at) k++;
  return k;
}
