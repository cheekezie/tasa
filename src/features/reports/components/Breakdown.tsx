import type { ReactNode } from "react";
import { naira } from "@/lib/format";

export type BreakdownRow = { key: string; label: ReactNode; amount: number; sub?: BreakdownRow[] };

/** Labelled amounts, biggest first, with an inline share bar and optional nested rows. */
export function Breakdown({ rows, empty, tone = "revenue" }: { rows: BreakdownRow[]; empty: string; tone?: "revenue" | "cost" }) {
  const total = rows.reduce((s, r) => s + Math.abs(r.amount), 0) || 1;
  if (rows.length === 0) return <p className="py-3 text-sm text-grey-400">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {[...rows]
        .sort((a, b) => b.amount - a.amount)
        .map((r) => (
          <li key={r.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-grey-800">{r.label}</span>
              <span className={r.amount < 0 ? "text-destructive" : "text-grey-800"}>{naira(r.amount)}</span>
            </div>
            <div className="mt-1 h-1 rounded-full bg-grey-50">
              <div
                className="h-1 rounded-full"
                style={{ width: `${(Math.abs(r.amount) / total) * 100}%`, background: tone === "revenue" ? "#1f8a6b" : "#d0612a" }}
              />
            </div>
            {r.sub && r.sub.length > 0 && (
              <ul className="mt-1.5 space-y-1 border-l border-grey-50 pl-3">
                {[...r.sub]
                  .sort((a, b) => b.amount - a.amount)
                  .map((s) => (
                    <li key={s.key} className="flex justify-between gap-3 text-xs text-grey-500">
                      <span className="truncate">{s.label}</span>
                      <span>{naira(s.amount)}</span>
                    </li>
                  ))}
              </ul>
            )}
          </li>
        ))}
    </ul>
  );
}
