import { INCOME_PERIODS, PERIOD_LABELS, type Income, type IncomePeriod } from "@/features/overview/api";
import { naira } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The app's periods, as pills. One selector drives the whole dashboard. */
export function PeriodTabs({ value, onChange }: { value: IncomePeriod; onChange: (p: IncomePeriod) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Period">
      {INCOME_PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          role="tab"
          aria-selected={p === value}
          onClick={() => onChange(p)}
          className={cn(
            "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
            p === value ? "border-primary bg-primary text-white" : "border-grey-50 bg-white text-grey-500 hover:bg-grey-25",
          )}
        >
          {PERIOD_LABELS[p]}
        </button>
      ))}
    </div>
  );
}

/** "₦1.2M" / "₦25.0K" / "₦850", as the app's chart labels its bars. */
const compact = (kobo: number) => naira(kobo, { compact: kobo >= 100_000 });

/** The month's three letters, as the app labels its bars; the year too once there are more than twelve. */
function monthLabel(key: string, many: boolean) {
  return new Intl.DateTimeFormat("en-NG", { month: "short", ...(many && { year: "2-digit" }) }).format(new Date(`${key}-15T12:00:00+01:00`));
}

/**
 * The app's insights chart, as it is there: a rounded pill per month on a light track, the amount
 * above it and the month below, every bar the same green. Hovering (or focusing) a month shows
 * what made it up; months still to come show only their track.
 */
export function IncomeBarChart({ data }: { data: Income }) {
  const max = Math.max(...data.series.map((p) => p.income), 1);
  const many = data.series.length > 12;
  return (
    // Fills whatever height its card has, so it lines up with the category card beside it.
    <div className="flex min-h-[164px] flex-1 items-stretch justify-between gap-1 pt-2">
      {data.series.map((p, i) => (
        <div
          key={p.key}
          tabIndex={0}
          aria-label={p.upcoming ? `${monthLabel(p.key, true)}: still to come` : `${monthLabel(p.key, true)}: ${naira(p.income)}, ${naira(p.bills)} from bills`}
          className="group relative flex min-w-0 flex-1 flex-col items-center gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <span className="truncate text-xs text-grey-500 tabular-nums">{p.upcoming ? "\u00a0" : compact(p.income)}</span>
          <div className="flex min-h-[100px] w-[18px] flex-1 flex-col justify-end overflow-hidden rounded-full bg-[#E4DFD5] transition-colors group-hover:bg-[#d9d3c6]">
            {/* An empty month shows just its track, so it's plainly there and plainly empty. */}
            {p.income > 0 && <div className="w-full rounded-full bg-primary" style={{ height: `${Math.max((p.income / max) * 100, 8)}%` }} />}
          </div>
          <span className={cn("truncate text-xs font-medium", p.upcoming ? "text-grey-300" : "text-primary")}>{monthLabel(p.key, many)}</span>
          <BarDetails point={p} align={i < 2 ? "start" : i > data.series.length - 3 ? "end" : "center"} />
        </div>
      ))}
    </div>
  );
}

/** What a month was made of, above its bar while it's hovered or focused. */
function BarDetails({ point, align }: { point: Income["series"][number]; align: "start" | "center" | "end" }) {
  return (
    <div
      role="tooltip"
      className={cn(
        "pointer-events-none absolute bottom-full z-10 mb-1 w-44 rounded-lg border border-grey-50 bg-white p-3 text-left opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100",
        align === "start" ? "left-0" : align === "end" ? "right-0" : "left-1/2 -translate-x-1/2",
      )}
    >
      <p className="text-xs font-semibold text-grey-800">{monthLabel(point.key, true)}</p>
      {point.upcoming ? (
        <p className="mt-1 text-xs text-grey-400">Still to come</p>
      ) : (
        <dl className="mt-2 space-y-1 text-xs">
          <Row label="Income" value={naira(point.income)} strong />
          <Row label="From bills" value={naira(point.bills)} />
          <Row label="Everything else" value={naira(point.income - point.bills)} />
        </dl>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-grey-400">{label}</dt>
      <dd className={cn("tabular-nums", strong ? "font-semibold text-grey-800" : "text-grey-500")}>{value}</dd>
    </div>
  );
}

/** The app's share rows: name, amount and share on one line, the bar underneath. Biggest first. */
export function BillCategoryBars({ data }: { data: Income }) {
  if (data.byCategory.length === 0) {
    return <p className="flex h-[164px] items-center justify-center rounded-lg bg-grey-25 text-sm text-grey-400">No bills in this period yet.</p>;
  }
  return (
    <ul className="space-y-4">
      {data.byCategory.map((c) => (
        <li key={c.serviceId} title={`Charges ${naira(c.charges)} · commission ${naira(c.commission)} · ${c.bills} bills`}>
          <div className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-grey-800">{c.name}</span>
            <span className="text-sm font-medium text-grey-800 tabular-nums">{naira(c.income)}</span>
            <span className="w-10 text-right text-xs text-grey-400 tabular-nums">{Math.round(c.share)}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#E4DFD5]">
            <div className="h-full rounded-full bg-primary" style={{ width: `${c.share}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
