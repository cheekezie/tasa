import { naira } from "@/lib/format";
import type { ChargeRule } from "@/features/charges/api";

/** Same order the API picks in: provider rules beat service rules beat scope-wide ones. */
export const specificity = (r: Pick<ChargeRule, "serviceId" | "provider">) => (r.provider ? 2 : 0) + (r.serviceId ? 1 : 0);

export const SPECIFICITY_LABELS = ["Whole scope", "One service", "One provider"] as const;

/** Basis points as a percentage: 150 → "1.5%". */
export const bpsToPercent = (bps: number) => `${(bps / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 })}%`;

/** "1.5" → 150, or null when it isn't a valid 0–100 percentage. */
export function percentToBps(value: string): number | null {
  if (value.trim() === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100);
}

/** The rule as a person would say it: "1% + ₦10, at least ₦50, at most ₦1,000". */
export function describeRule(r: Pick<ChargeRule, "rateBps" | "fixed" | "min" | "max">) {
  const parts = [r.rateBps ? bpsToPercent(r.rateBps) : null, r.fixed ? naira(r.fixed) : null].filter(Boolean);
  const base = parts.length ? parts.join(" + ") : "Free";
  const bounds = [r.min ? `at least ${naira(r.min)}` : null, r.max != null ? `at most ${naira(r.max)}` : null].filter(Boolean);
  return bounds.length ? `${base}, ${bounds.join(", ")}` : base;
}
