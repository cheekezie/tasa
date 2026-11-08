import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { AHEAD, bucket, duePeriods, periodIn, summarise, yearColumns, type DueMember } from './groups.dues';
import { lagosMidnight, periodIndex, periodStart, periodsDue } from './groups.periods';
import type { IGroupDue } from './models/group.model';

const day = (y: number, m: number, d: number) => lagosMidnight(y, m - 1, d);

describe('dues periods', () => {
  it('owes the first period on the day they join', () => {
    const joined = day(2026, 11, 4);
    expect(periodsDue(joined, 'monthly', 4, joined)).toBe(1);
    expect(periodsDue(joined, 'monthly', 4, new Date(day(2026, 12, 4).getTime() - 1))).toBe(1);
    expect(periodsDue(joined, 'monthly', 4, day(2026, 12, 4))).toBe(2);
    expect(periodsDue(joined, 'monthly', 4, new Date(joined.getTime() - 1))).toBe(0);
  });

  it('keeps month-end anchors through short months', () => {
    const joined = day(2027, 1, 31);
    expect(periodStart(joined, 'monthly', 31, 1)).toEqual(day(2027, 2, 28));
    expect(periodStart(joined, 'monthly', 31, 2)).toEqual(day(2027, 3, 31));
    expect(periodsDue(joined, 'monthly', 31, day(2027, 2, 28))).toBe(2);
    expect(periodStart(day(2028, 2, 29), 'yearly', 29, 1)).toEqual(day(2029, 2, 28));
  });

  it('counts weeks and years', () => {
    const joined = day(2026, 11, 4);
    expect(periodsDue(joined, 'weekly', 4, day(2026, 11, 10))).toBe(1);
    expect(periodsDue(joined, 'weekly', 4, day(2026, 11, 11))).toBe(2);
    expect(periodsDue(joined, 'weekly', 4, day(2027, 11, 4))).toBe(53);
    expect(periodsDue(joined, 'yearly', 4, day(2029, 11, 3))).toBe(3);
  });

  it('indexes periods before the start too', () => {
    const joined = day(2026, 11, 4);
    expect(periodIndex(joined, 'monthly', 4, day(2026, 11, 4))).toBe(0);
    expect(periodIndex(joined, 'monthly', 4, day(2026, 11, 3))).toBe(-1);
    expect(periodIndex(joined, 'monthly', 4, day(2026, 8, 4))).toBe(-3);
    expect(periodIndex(joined, 'weekly', 4, day(2026, 11, 17))).toBe(1);
    expect(periodIndex(joined, 'yearly', 4, day(2025, 1, 1))).toBe(-2);
  });
});

describe('dues statements', () => {
  const id = (n: number) => new Types.ObjectId(n.toString(16).padStart(24, '0'));
  const joined = day(2026, 9, 4);
  const monthly = { _id: id(1), name: 'Dues', kind: 'recurring', period: 'monthly', amount: 100_000, compulsory: true, createdAt: day(2026, 1, 1) } as IGroupDue;
  const member = (over: Partial<DueMember> = {}): DueMember => ({ status: 'active', startsAt: joined, anchorDay: 4, joinedAt: joined, paid: [], backfills: [], ...over });
  const now = day(2026, 11, 20);

  it('marks the current period due, earlier ones overdue, and later ones payable ahead', () => {
    const periods = duePeriods(member({ paid: [{ due: id(1), period: 1 }] }), monthly, now);
    expect(periods.slice(0, 4).map((p) => [p.index, p.status])).toEqual([
      [0, 'overdue'],
      [1, 'paid'],
      [2, 'due'],
      [3, 'upcoming'],
    ]);
    expect(periods).toHaveLength(3 + AHEAD.monthly);
    expect(periods[2]!.start).toEqual(day(2026, 11, 4));
    expect(summarise(member({ paid: [{ due: id(1), period: 1 }] }), [monthly], now)).toEqual({ amount: 200_000, overdue: 100_000, periods: 2 });
  });

  it('adds arrears before the start, and starts a due added later at the period it was added in', () => {
    const arrears = duePeriods(member({ backfills: [{ due: id(1), periods: 2 }] }), monthly, now);
    expect(arrears[0]).toMatchObject({ index: -2, start: day(2026, 7, 4), status: 'overdue' });
    const later = { ...monthly, createdAt: day(2026, 10, 15) };
    expect(duePeriods(member(), later, now)[0]).toMatchObject({ index: 1, status: 'overdue' });
  });

  it('never owes an optional due, and drops what was not paid once it ends', () => {
    const welfare = { ...monthly, compulsory: false };
    expect(
      duePeriods(member(), welfare, now)
        .slice(0, 3)
        .map((p) => p.status),
    ).toEqual(['optional', 'optional', 'optional']);
    expect(summarise(member(), [welfare], now).amount).toBe(0);
    const ended = { ...welfare, endedAt: day(2026, 10, 10) };
    expect(duePeriods(member({ paid: [{ due: id(1), period: 0 }] }), ended, now).map((p) => p.index)).toEqual([0]);
  });

  it('owes a one-off once, only if they were a member when it was created', () => {
    const levy = {
      _id: id(2),
      name: 'Condolence',
      kind: 'one_off',
      amount: 200_000,
      compulsory: true,
      createdAt: day(2026, 11, 1),
      dueAt: day(2026, 11, 15),
    } as IGroupDue;
    expect(duePeriods(member(), levy, now)).toEqual([{ index: 0, start: levy.createdAt, end: levy.dueAt, status: 'overdue' }]);
    expect(duePeriods(member(), levy, day(2026, 11, 10))[0]!.status).toBe('due');
    expect(duePeriods(member({ joinedAt: day(2026, 11, 2) }), levy, now)).toEqual([]);
    expect(duePeriods(member(), { ...levy, compulsory: false }, now)[0]!.status).toBe('optional');
  });

  it('lines every member up in calendar columns whatever their join day', () => {
    const column = bucket('monthly', now, 0);
    expect(column).toEqual({ start: day(2026, 11, 1), end: day(2026, 12, 1) });
    const late = member({ startsAt: day(2026, 9, 25), anchorDay: 25, joinedAt: day(2026, 9, 25) });
    expect(periodIn(late, monthly, column, duePeriods(late, monthly, now))).toMatchObject({ index: 2, status: 'upcoming' });
    expect(bucket('weekly', day(2026, 11, 5), 0).start).toEqual(day(2026, 11, 2));
    expect(bucket('yearly', now, 1)).toEqual({ start: day(2025, 1, 1), end: day(2026, 1, 1) });
  });

  it('lists every month, or every week starting in it, of a year', () => {
    expect(yearColumns('monthly', 2026).map((c) => c.start)).toEqual(Array.from({ length: 12 }, (_, m) => day(2026, m + 1, 1)));
    const weeks = yearColumns('weekly', 2026);
    expect(weeks[0]).toEqual({ start: day(2026, 1, 5), end: day(2026, 1, 12) }); // 1 Jan 2026 is a Thursday
    expect(weeks).toHaveLength(52);
    expect(weeks.at(-1)!.start).toEqual(day(2026, 12, 28));
    expect(yearColumns('weekly', 2024)[0]!.start).toEqual(day(2024, 1, 1)); // a Monday
  });
});
