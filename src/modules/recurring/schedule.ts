/**
 * Schedule maths in Lagos time (UTC+1, no DST). Payments run at 07:00 local so a token or
 * renewal is there before the day starts.
 */
const LAGOS_OFFSET_MS = 60 * 60_000;
const RUN_HOUR = 7;

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** 07:00 Lagos on the given calendar day, as a UTC instant. */
export const lagosRunTime = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d, RUN_HOUR) - LAGOS_OFFSET_MS);

export function parseLagosDate(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return lagosRunTime(y, m - 1, d);
}

/** Lagos calendar parts of a UTC instant. */
export function lagosParts(at: Date) {
  const local = new Date(at.getTime() + LAGOS_OFFSET_MS);
  return { y: local.getUTCFullYear(), m: local.getUTCMonth(), d: local.getUTCDate(), weekday: local.getUTCDay() };
}

const STEPS = {
  daily: { days: 1 },
  weekly: { days: 7 },
  biweekly: { days: 14 },
  monthly: { months: 1 },
  quarterly: { months: 3 },
  yearly: { months: 12 },
} as const;

export type RecurringFrequency = keyof typeof STEPS;
export const RECURRING_FREQUENCIES = Object.keys(STEPS) as [RecurringFrequency, ...RecurringFrequency[]];

/**
 * The run after `from`. Month-based schedules keep their anchor day, clamped to short months
 * (anchor 31 → 28 Feb → 31 Mar), so they never drift.
 */
export function nextRun(from: Date, frequency: RecurringFrequency, anchorDay: number) {
  const { y, m, d } = lagosParts(from);
  const step: { days: number } | { months: number } = STEPS[frequency];
  if ('days' in step) return lagosRunTime(y, m, d + step.days);
  const months = y * 12 + m + step.months;
  const ny = Math.floor(months / 12);
  const nm = months % 12;
  return lagosRunTime(ny, nm, Math.min(anchorDay, daysInMonth(ny, nm)));
}

/**
 * The first run still ahead of `now`. After missed runs (a retry, downtime), stepping once from
 * the old due date can land in the past, and each past date would charge again in a row.
 */
export function nextRunAfter(now: Date, from: Date, frequency: RecurringFrequency, anchorDay: number) {
  let at = nextRun(from, frequency, anchorDay);
  while (at <= now) at = nextRun(at, frequency, anchorDay);
  return at;
}
