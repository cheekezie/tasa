import { lagosDay } from "./format";

export const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;
export type RangeKey = keyof typeof RANGES;

/** The `from`/`to` Lagos days the reports take, for the last N days including today. */
export function rangeParams(key: RangeKey) {
  const to = new Date();
  const from = new Date(to.getTime() - (RANGES[key] - 1) * 86_400_000);
  return { from: lagosDay(from), to: lagosDay(to) };
}
