import { naira, percent } from "@/lib/format";
import { cn } from "@/lib/utils";

export type BridgeStep = { key: string; label: string; hint?: string; amount: number; kind: "in" | "out" | "total" };

/**
 * Revenue in, each cost out, net at the bottom: one bar per step, sitting where the running
 * total was, so it reads as "how we get from what we earn to what we keep".
 */
/** Where each bar starts and ends on the running total, and the range the scale must cover. */
function layout(steps: BridgeStep[]) {
  let running = 0;
  let high = 0;
  let low = 0;
  const placed: (BridgeStep & { start: number; end: number })[] = [];
  for (const step of steps) {
    const start = step.kind === "total" ? 0 : running;
    const end = step.kind === "total" ? step.amount : step.kind === "in" ? running + step.amount : running - step.amount;
    if (step.kind !== "total") running = end;
    high = Math.max(high, start, end);
    low = Math.min(low, start, end);
    placed.push({ ...step, start, end });
  }
  return { placed, high, low };
}

export function ProfitBridge({ steps, revenue }: { steps: BridgeStep[]; revenue: number }) {
  // The scale has to fit the highest point the running total reaches and, for a loss, the lowest.
  const { placed, high, low } = layout(steps);
  const span = high - low || 1;
  const at = (v: number) => ((v - low) / span) * 100;

  return (
    <ol className="space-y-3">
      {placed.map((step) => {
        const left = at(Math.min(step.start, step.end));
        const width = Math.max(at(Math.max(step.start, step.end)) - left, step.amount === 0 ? 0 : 0.6);
        const share = revenue > 0 && step.kind === "out" ? (step.amount / revenue) * 100 : null;
        return (
          <li key={step.key} className={cn("grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3", step.kind === "total" && "border-t border-grey-50 pt-3")}>
            <div className="min-w-0">
              <p className={cn("truncate text-sm", step.kind === "total" ? "font-semibold text-grey-800" : "text-grey-800")}>{step.label}</p>
              {step.hint && <p className="truncate text-xs text-grey-400">{step.hint}</p>}
            </div>
            <div className="relative h-6 rounded bg-grey-25">
              {low < 0 && <div className="absolute inset-y-0 w-px bg-grey-200" style={{ left: `${at(0)}%` }} aria-hidden />}
              <div
                className={cn(
                  "absolute inset-y-1 rounded-sm",
                  step.kind === "in" && "bg-[#1f8a6b]",
                  step.kind === "out" && "bg-[#d0612a]",
                  step.kind === "total" && (step.amount >= 0 ? "bg-primary" : "bg-destructive"),
                )}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            </div>
            <div className="w-32 text-right">
              <p
                className={cn(
                  "text-sm tabular-nums",
                  step.kind === "out" ? "text-[#b4501f]" : step.kind === "total" ? (step.amount >= 0 ? "font-semibold text-grey-800" : "font-semibold text-destructive") : "text-grey-800",
                )}
              >
                {step.kind === "out" ? "−" : step.kind === "in" ? "+" : ""}
                {naira(Math.abs(step.amount))}
              </p>
              {share !== null && <p className="text-xs text-grey-400">{percent(share)} of revenue</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The question behind the P&L: do the charges we earn pay for the fees we absorb and the money
 * we give away? Shown as "₦X earned for every ₦1 spent", and revenue split into kept and spent.
 */
export function Recovery({ revenue, absorbed, givenAway }: { revenue: number; absorbed: number; givenAway: number }) {
  const spent = absorbed + givenAway;
  const kept = revenue - spent;
  const cover = spent > 0 ? revenue / spent : null;
  const pct = (v: number) => (revenue > 0 ? Math.max(0, Math.min(100, (v / revenue) * 100)) : 0);

  return (
    <div className="space-y-4">
      <div>
        <p className="font-heading text-3xl font-semibold text-grey-800">
          {cover === null ? "Nothing spent" : `₦${cover.toFixed(cover >= 10 ? 0 : 2)}`}
        </p>
        <p className="mt-1 text-sm text-grey-500">
          {cover === null
            ? "No fees absorbed and nothing given away in this period."
            : cover >= 1
              ? `earned for every ₦1 we absorb or give away. Charges and commission cover costs ${cover >= 10 ? "many times" : `${cover.toFixed(1)}×`}.`
              : "earned for every ₦1 we absorb or give away: costs are bigger than revenue in this period."}
        </p>
      </div>

      <div>
        <div className="flex h-3 overflow-hidden rounded-full bg-grey-50" role="img" aria-label="Revenue split into fees, giveaways and what we keep">
          <div className="bg-[#d0612a]" style={{ width: `${pct(absorbed)}%` }} />
          <div className="bg-[#e9a23b]" style={{ width: `${pct(givenAway)}%` }} />
          <div className={kept >= 0 ? "bg-primary" : "bg-destructive"} style={{ width: `${pct(Math.max(0, kept))}%` }} />
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <Legend swatch="bg-[#d0612a]" label="Fees we absorb" value={naira(absorbed)} />
          <Legend swatch="bg-[#e9a23b]" label="Promos, giveaways, points" value={naira(givenAway)} />
          <Legend swatch={kept >= 0 ? "bg-primary" : "bg-destructive"} label={kept >= 0 ? "We keep" : "Shortfall"} value={naira(Math.abs(kept))} />
        </dl>
      </div>
    </div>
  );
}

function Legend({ swatch, label, value }: { swatch: string; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-grey-400">
        <span className={cn("size-2 shrink-0 rounded-full", swatch)} />
        <span className="truncate">{label}</span>
      </dt>
      <dd className="mt-0.5 font-medium text-grey-800 tabular-nums">{value}</dd>
    </div>
  );
}
