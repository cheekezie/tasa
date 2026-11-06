import { useState } from "react";
import { date, naira } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Pnl } from "@/features/reports/api";

// Validated pair (CVD-safe, ≥3:1 on white): revenue green, costs orange.
const REVENUE = "#1f8a6b";
const COSTS = "#d0612a";
const HEIGHT = 180;

type Day = Pnl["series"][number];

/** Every Lagos day from `from` to `to` inclusive, so quiet days show as gaps rather than vanishing. */
function fillDays(series: Day[], from: string, to: string): Day[] {
  const byDay = new Map(series.map((d) => [d.day, d]));
  const days: Day[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    days.push(byDay.get(day) ?? { day, revenue: 0, costs: 0, net: 0 });
  }
  return days;
}

/** Revenue and costs per day as paired bars, with the day's numbers on hover and a table view. */
export function PnlChart({ series, from, to }: { series: Day[]; from: string; to: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const days = fillDays(series, from, to);
  const peak = Math.max(1, ...days.map((d) => Math.max(d.revenue, d.costs)));
  const active = hover === null ? null : days[hover];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-xs text-grey-500">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: REVENUE }} /> Revenue
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: COSTS }} /> Costs
          </span>
        </div>
        <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setAsTable((v) => !v)}>
          {asTable ? "Show chart" : "Show as table"}
        </button>
      </div>

      {asTable ? (
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white text-left text-xs text-grey-400">
              <tr>
                <th className="py-1.5 font-medium">Day</th>
                <th className="py-1.5 text-right font-medium">Revenue</th>
                <th className="py-1.5 text-right font-medium">Costs</th>
                <th className="py-1.5 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-grey-50">
              {days.map((d) => (
                <tr key={d.day}>
                  <td className="py-1.5 text-grey-500">{date(`${d.day}T12:00:00Z`)}</td>
                  <td className="py-1.5 text-right">{naira(d.revenue)}</td>
                  <td className="py-1.5 text-right">{naira(d.costs)}</td>
                  <td className={cn("py-1.5 text-right", d.net < 0 && "text-destructive")}>{naira(d.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <div className="flex items-end gap-px border-b border-grey-100" style={{ height: HEIGHT }} onMouseLeave={() => setHover(null)}>
            {days.map((d, i) => (
              <div
                key={d.day}
                className={cn("flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] rounded-t px-[1px]", hover === i && "bg-grey-25")}
                onMouseEnter={() => setHover(i)}
              >
                <div className="w-full max-w-3 rounded-t-[4px]" style={{ height: `${(d.revenue / peak) * 100}%`, background: REVENUE }} />
                <div className="w-full max-w-3 rounded-t-[4px]" style={{ height: `${(d.costs / peak) * 100}%`, background: COSTS }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs text-grey-400">
            <span>{date(`${from}T12:00:00Z`)}</span>
            <span>Peak day {naira(peak, { compact: true })}</span>
            <span>{date(`${to}T12:00:00Z`)}</span>
          </div>
          {active && hover !== null && (
            <div
              className="pointer-events-none absolute top-2 z-10 w-48 rounded-lg border border-grey-50 bg-white p-2.5 text-xs shadow-md"
              style={hover > days.length / 2 ? { right: `${((days.length - hover) / days.length) * 100}%` } : { left: `${((hover + 1) / days.length) * 100}%` }}
            >
              <p className="mb-1 font-medium text-grey-800">{date(`${active.day}T12:00:00Z`)}</p>
              <TipLine color={REVENUE} label="Revenue" value={naira(active.revenue)} />
              <TipLine color={COSTS} label="Costs" value={naira(active.costs)} />
              <div className="mt-1 flex justify-between border-t border-grey-50 pt-1">
                <span className="text-grey-500">Net</span>
                <span className={active.net < 0 ? "text-destructive" : "text-grey-800"}>{naira(active.net)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TipLine({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="flex items-center gap-1.5 text-grey-500">
        <span className="size-2 rounded-sm" style={{ background: color }} />
        {label}
      </span>
      <span className="text-grey-800">{value}</span>
    </div>
  );
}
