import { describe, expect, it } from 'vitest';
import { lagosParts, nextRun, nextRunAfter, parseLagosDate } from './schedule';

describe('recurring schedule', () => {
  it('runs at 07:00 Lagos (06:00 UTC)', () => {
    expect(parseLagosDate('2026-11-05').toISOString()).toBe('2026-11-05T06:00:00.000Z');
  });

  it('keeps a month-end anchor through short months', () => {
    let at = parseLagosDate('2027-01-31');
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      at = nextRun(at, 'monthly', 31);
      seen.push(at.toISOString().slice(0, 10));
    }
    expect(seen).toEqual(['2027-02-28', '2027-03-31', '2027-04-30']);
  });

  it('rolls over the year and steps weeks', () => {
    expect(nextRun(parseLagosDate('2026-12-15'), 'monthly', 15).toISOString().slice(0, 10)).toBe('2027-01-15');
    expect(nextRun(parseLagosDate('2026-12-29'), 'weekly', 2).toISOString().slice(0, 10)).toBe('2027-01-05');
  });

  const day = (at: Date) => at.toISOString().slice(0, 10);

  it('steps days, across months and years', () => {
    expect(day(nextRun(parseLagosDate('2026-12-31'), 'daily', 31))).toBe('2027-01-01');
    expect(day(nextRun(parseLagosDate('2026-12-25'), 'biweekly', 25))).toBe('2027-01-08');
  });

  it('keeps the anchor across quarters and years, including 29 February', () => {
    let at = parseLagosDate('2026-11-30');
    const quarters: string[] = [];
    for (let i = 0; i < 3; i++) {
      at = nextRun(at, 'quarterly', 30);
      quarters.push(day(at));
    }
    expect(quarters).toEqual(['2027-02-28', '2027-05-30', '2027-08-30']);
    at = parseLagosDate('2028-02-29');
    at = nextRun(at, 'yearly', 29);
    expect(day(at)).toBe('2029-02-28');
    expect(day(nextRun(parseLagosDate('2031-02-28'), 'yearly', 29))).toBe('2032-02-29');
  });

  it('after missed runs, jumps to the next future date instead of replaying the past', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    expect(day(nextRunAfter(now, parseLagosDate('2026-11-05'), 'daily', 5))).toBe('2026-11-11');
    expect(day(nextRunAfter(now, parseLagosDate('2026-10-01'), 'weekly', 1))).toBe('2026-11-12');
    expect(day(nextRunAfter(now, parseLagosDate('2026-11-09'), 'monthly', 9))).toBe('2026-12-09');
  });

  it('reads Lagos calendar parts across the UTC midnight boundary', () => {
    expect(lagosParts(new Date('2026-11-05T23:30:00Z'))).toMatchObject({ d: 6 });
  });
});
