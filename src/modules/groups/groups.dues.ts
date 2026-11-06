import type { Types } from 'mongoose';
import { lagosParts } from '../recurring/schedule';
import { lagosMidnight, periodIndex, periodStart } from './groups.periods';
import type { GroupPeriod, IGroupDue } from './models/group.model';

/**
 * Where a member stands on each of a group's dues, period by period. Pure: everything comes from
 * the due, the member's own periods and what they've paid, so it's the same wherever it's read.
 *
 * - `paid`: covered.
 * - `due`: compulsory and unpaid, still current (this period, or a one-off before its deadline).
 * - `overdue`: compulsory and unpaid, its period over (or a one-off past its deadline).
 * - `optional`: an optional due, unpaid. Never owed.
 * - `upcoming`: a period that hasn't started; it can be paid ahead.
 */
export type PeriodStatus = 'paid' | 'due' | 'overdue' | 'optional' | 'upcoming';

/** How far ahead a member can pay, by period. */
export const AHEAD: Record<GroupPeriod, number> = { weekly: 8, monthly: 6, yearly: 2 };

export type DueMember = {
  status: string;
  startsAt: Date;
  anchorDay: number;
  joinedAt: Date;
  paid: { due: Types.ObjectId | string; period: number }[];
  backfills: { due?: Types.ObjectId | string | null; periods: number }[];
};

export type DuePeriod = { index: number; start: Date; end: Date | null; status: PeriodStatus };

const same = (a: Types.ObjectId | string | null | undefined, b: Types.ObjectId | string) => a != null && String(a) === String(b);

/** The period (of the member's) that `at` falls in; negative before their first. */
const indexAt = (m: DueMember, period: GroupPeriod, at: Date) => periodIndex(m.startsAt, period, m.anchorDay, at);

export const backfilled = (m: DueMember, due: Pick<IGroupDue, '_id'>) => m.backfills.filter((b) => same(b.due, due._id)).reduce((n, b) => n + b.periods, 0);

/** Whether a one-off was theirs to pay: they were in the group when it was created. */
export const oneOffApplies = (m: DueMember, due: Pick<IGroupDue, 'createdAt'>) => m.joinedAt.getTime() <= due.createdAt.getTime();

/** The range of a recurring due's periods that are theirs: from its first (or backfilled arrears) to its last. */
function recurringRange(m: DueMember, due: IGroupDue) {
  const period = due.period!;
  // A due added after they joined starts at the period it was added in: that one's owed in full.
  const first = (due.createdAt > m.startsAt ? indexAt(m, period, due.createdAt) : 0) - backfilled(m, due);
  const last = due.endedAt ? indexAt(m, period, due.endedAt) : Number.POSITIVE_INFINITY;
  return { first, last };
}

/** Every period of one due that's theirs: owed, paid, and the ones they can pay ahead. */
export function duePeriods(m: DueMember, due: IGroupDue, now = new Date()): DuePeriod[] {
  const isPaid = (k: number) => m.paid.some((p) => same(p.due, due._id) && p.period === k);
  if (due.kind === 'one_off') {
    if (!oneOffApplies(m, due)) return [];
    const paid = isPaid(0);
    if (!paid && due.endedAt && !due.compulsory) return [];
    const status: PeriodStatus = paid ? 'paid' : !due.compulsory ? 'optional' : due.dueAt && now >= due.dueAt ? 'overdue' : 'due';
    return [{ index: 0, start: due.createdAt, end: due.dueAt ?? null, status }];
  }
  const period = due.period!;
  const { first, last } = recurringRange(m, due);
  const current = indexAt(m, period, now);
  const paidAhead = m.paid.filter((p) => same(p.due, due._id)).reduce((max, p) => Math.max(max, p.period), Number.NEGATIVE_INFINITY);
  const upper = Math.min(last, Math.max(current + AHEAD[period], paidAhead));
  const out: DuePeriod[] = [];
  for (let k = first; k <= upper; k++) {
    const paid = isPaid(k);
    // An ended optional due drops what wasn't paid: there's nothing left to pay it to.
    if (!paid && due.endedAt && !due.compulsory) continue;
    const status: PeriodStatus = paid ? 'paid' : k > current ? 'upcoming' : !due.compulsory ? 'optional' : k < current ? 'overdue' : 'due';
    out.push({ index: k, start: periodStart(m.startsAt, period, m.anchorDay, k), end: periodStart(m.startsAt, period, m.anchorDay, k + 1), status });
  }
  return out;
}

const owes = (s: PeriodStatus) => s === 'due' || s === 'overdue';

/** What they owe across every due: the total, how much of it is overdue, and how many periods. */
export function summarise(m: DueMember, dues: IGroupDue[], now = new Date()) {
  let amount = 0;
  let overdue = 0;
  let periods = 0;
  for (const due of dues) {
    for (const p of duePeriods(m, due, now)) {
      if (!owes(p.status)) continue;
      amount += due.amount;
      periods += 1;
      if (p.status === 'overdue') overdue += due.amount;
    }
  }
  return { amount, overdue, periods };
}

// ── Calendar columns, for the executives' view of who paid what ──────────
/** The calendar month, year or (Monday) week `back` steps before the one containing `at`. */
export function bucket(period: GroupPeriod, at: Date, back: number) {
  const { y, m, d } = lagosParts(at);
  if (period === 'monthly') return { start: lagosMidnight(y, m - back, 1), end: lagosMidnight(y, m - back + 1, 1) };
  if (period === 'yearly') return { start: lagosMidnight(y - back, 0, 1), end: lagosMidnight(y - back + 1, 0, 1) };
  const monday = d - ((new Date(Date.UTC(y, m, d)).getUTCDay() + 6) % 7) - 7 * back;
  return { start: lagosMidnight(y, m, monday), end: lagosMidnight(y, m, monday + 7) };
}

/**
 * The member's period that starts inside a calendar column, if any. Every member has exactly one
 * period starting in each calendar month (year, week) of the due's period, whatever their join day,
 * so columns line everyone up.
 */
export function periodIn(m: DueMember, due: IGroupDue, column: { start: Date; end: Date }, periods: DuePeriod[]) {
  const k = indexAt(m, due.period!, new Date(column.end.getTime() - 1));
  return periods.find((p) => p.index === k && p.start >= column.start) ?? null;
}

/** Every calendar column of a year: its 12 months, or the weeks (Monday to Sunday) that start in it. */
export function yearColumns(period: Exclude<GroupPeriod, 'yearly'>, year: number) {
  if (period === 'monthly') return Array.from({ length: 12 }, (_, m) => ({ start: lagosMidnight(year, m, 1), end: lagosMidnight(year, m + 1, 1) }));
  const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  let day = 1 + ((8 - jan1) % 7); // the first Monday of the year
  const out: { start: Date; end: Date }[] = [];
  for (let start = lagosMidnight(year, 0, day); lagosParts(start).y === year; start = lagosMidnight(year, 0, (day += 7))) {
    out.push({ start, end: lagosMidnight(year, 0, day + 7) });
  }
  return out;
}
