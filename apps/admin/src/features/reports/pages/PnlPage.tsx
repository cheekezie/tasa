import { useState } from "react";
import { Link } from "react-router-dom";
import { SCOPE_LABELS, type ChargeScope } from "@/features/charges/api";
import { serviceLabel } from "@/features/coupons/money";
import { usePnl, type CampaignCost, type Pnl } from "@/features/reports/api";
import { Breakdown, type BreakdownRow } from "@/features/reports/components/Breakdown";
import { PnlChart } from "@/features/reports/components/PnlChart";
import { ProfitBridge, Recovery } from "@/features/reports/components/ProfitBridge";
import { count, naira, percent, titleCase } from "@/lib/format";
import { rangeParams, type RangeKey } from "@/lib/range";
import appRoutes, { toPath } from "@/routes/appRoutes";
import { LoadFailed, Metric, Panel } from "@/shared/components/Metric";
import PageHeader from "@/shared/components/PageHeader";
import { RangeTabs } from "@/shared/components/RangeTabs";
import { Skeleton } from "@/shared/ui/skeleton";

const SOURCE_LABELS: Record<string, string> = {
  funding: "Wallet funding by transfer",
  collection: "Transfers into permanent accounts",
  payout: "Ticket payouts to bank",
  topup: "Moving money to VTpass",
};

const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

/** A campaign's name, linking to where it can be managed. */
function campaignRows(items: CampaignCost[]): BreakdownRow[] {
  return items.map((c) => ({
    key: c.id,
    amount: c.amount,
    label:
      c.kind === "promo" ? (
        <Link to={appRoutes.PROMOTIONS} className="hover:underline">
          <span className="font-mono">{c.code}</span> · {c.title}
        </Link>
      ) : c.kind ? (
        <Link to={toPath(appRoutes.COUPON, { id: c.id })} className="hover:underline">
          <span className="font-mono">{c.code}</span> · {c.title}
        </Link>
      ) : (
        <span className="text-grey-400">Deleted campaign ({c.id})</span>
      ),
  }));
}

/** Profit and loss straight from the ledger, so it always agrees with the books. */
export default function PnlPage() {
  const [rangeKey, setRangeKey] = useState<RangeKey>("30d");
  const range = rangeParams(rangeKey);
  const query = usePnl(range);
  const data = query.data;

  return (
    <>
      <PageHeader
        title="Profit & loss"
        subtitle="Charges and commission in, absorbed fees and giveaways out. Refunded bills reverse their charge on the day of the refund."
        actions={[<RangeTabs key="range" value={rangeKey} onChange={setRangeKey} />]}
      />
      {query.isError && <LoadFailed error={query.error} onRetry={() => query.refetch()} />}
      {query.isPending && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-72 rounded-xl" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
        </div>
      )}
      {data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Metric label="Revenue" value={naira(data.revenue.total)} hint={`Charges ${naira(data.revenue.charges.total)} · commission ${naira(data.revenue.commission.total)}`} />
            <Metric label="Costs" value={naira(data.costs.total)} hint="Absorbed fees, promotions, giveaways and points" />
            <Metric
              label="Net"
              value={naira(data.net)}
              tone={data.net >= 0 ? "good" : "bad"}
              hint={data.revenue.total > 0 ? `${percent((data.net / data.revenue.total) * 100)} margin` : data.net >= 0 ? "Profit for the period" : "Loss for the period"}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
            <Panel title="From what we earn to what we keep">
              <ProfitBridge
                revenue={data.revenue.total}
                steps={[
                  { key: "charges", label: "Service charges", hint: "Bills, transfers, tickets, giveaways", amount: data.revenue.charges.total, kind: "in" },
                  { key: "commission", label: "VTpass commission", hint: "Its discount on what we sell", amount: data.revenue.commission.total, kind: "in" },
                  { key: "fees", label: "SaySwitch fees", hint: "Funding, payouts, VTpass top-ups", amount: data.costs.fundingFees.total, kind: "out" },
                  { key: "promotions", label: "Promotions", hint: "Discounts at checkout", amount: data.costs.promotions.total, kind: "out" },
                  { key: "giveaways", label: "Giveaways", hint: "Tasa giveaways and gifts used", amount: data.costs.giveaways.total, kind: "out" },
                  { key: "points", label: "Points converted", hint: "Turned into wallet cash", amount: data.costs.points.total, kind: "out" },
                  { key: "net", label: data.net >= 0 ? "Profit" : "Loss", amount: data.net, kind: "total" },
                ]}
              />
            </Panel>
            <Panel title="Are charges paying for it?">
              <Recovery
                revenue={data.revenue.total}
                absorbed={data.costs.fundingFees.total}
                givenAway={data.costs.promotions.total + data.costs.giveaways.total + data.costs.points.total}
              />
            </Panel>
          </div>

          <Caveats caveats={data.caveats} />

          <Panel title="Day by day">
            {data.series.length === 0 ? (
              <p className="py-8 text-center text-sm text-grey-400">No revenue or costs in this period.</p>
            ) : (
              <PnlChart series={data.series} from={range.from} to={range.to} />
            )}
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-6">
              <Panel title={`Charges · ${naira(data.revenue.charges.total)}`}>
                <Breakdown
                  empty="No charges in this period."
                  rows={Object.entries(data.revenue.charges.byScope).map(([scope, s]) => ({
                    key: scope,
                    label: SCOPE_LABELS[scope as ChargeScope] ?? titleCase(scope),
                    amount: s.total,
                    sub: Object.entries(s.byService ?? {}).map(([svc, amount]) => ({ key: svc, label: serviceLabel(svc), amount })),
                  }))}
                />
              </Panel>
              <Panel title={`VTpass commission · ${naira(data.revenue.commission.total)}`}>
                <Breakdown
                  empty="No commission in this period."
                  rows={Object.entries(data.revenue.commission.byService).map(([svc, amount]) => ({ key: svc, label: serviceLabel(svc), amount }))}
                />
              </Panel>
            </div>

            <div className="space-y-6">
              <Panel title={`SaySwitch fees Tasa absorbs · ${naira(data.costs.fundingFees.total)}`}>
                <Breakdown
                  tone="cost"
                  empty="No provider fees in this period."
                  rows={Object.entries(data.costs.fundingFees.bySource).map(([source, amount]) => ({
                    key: source,
                    label: SOURCE_LABELS[source] ?? titleCase(source),
                    amount,
                  }))}
                />
                {(data.caveats.fundingsWithoutFee > 0 || data.caveats.payoutsWithoutFee > 0) && (
                  <p className="mt-3 text-xs text-grey-400">Plus fees SaySwitch didn't report: see the notes above.</p>
                )}
              </Panel>
              <Panel title={`Promotions · ${naira(data.costs.promotions.total)}`}>
                <Breakdown tone="cost" empty="No promotion discounts in this period." rows={campaignRows(data.costs.promotions.byCampaign)} />
              </Panel>
              <Panel title={`Giveaways · ${naira(data.costs.giveaways.total)}`}>
                <Breakdown tone="cost" empty="No giveaways or gifts used in this period." rows={campaignRows(data.costs.giveaways.byCampaign)} />
              </Panel>
              <Panel title="Points converted">
                <p className="font-heading text-xl font-semibold text-grey-800">{naira(data.costs.points.total)}</p>
                <p className="mt-1 text-xs text-grey-400">
                  Points users turned into wallet cash in this period.{" "}
                  <Link to={appRoutes.POINTS} className="text-primary hover:underline">
                    Points still outstanding
                  </Link>
                </p>
              </Panel>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * What the figures can't see yet, and which way each one leans, so nobody reads them as exact.
 * Only what's actually happening shows; nothing at all when the books are complete.
 */
function Caveats({ caveats }: { caveats: Pnl["caveats"] }) {
  const notes = [
    caveats.fundingsWithoutFee + caveats.payoutsWithoutFee > 0 && {
      key: "fees",
      lean: "Costs higher than shown",
      text: `SaySwitch didn't say what it charged on ${[
        caveats.fundingsWithoutFee > 0 && plural(caveats.fundingsWithoutFee, "funding", "fundings"),
        caveats.payoutsWithoutFee > 0 && plural(caveats.payoutsWithoutFee, "payout", "payouts"),
      ]
        .filter(Boolean)
        .join(" and ")}, so those fees aren't counted. They're booked as soon as it does.`,
    },
    caveats.billsWithoutCost > 0 && {
      key: "commission",
      lean: "Revenue lower than shown",
      text: `VTpass didn't say what it kept on ${plural(caveats.billsWithoutCost, "bill", "bills")}, so no commission is counted for them.`,
    },
    caveats.pendingBillCharges.count > 0 && {
      key: "pending",
      lean: "May go down",
      text: `${naira(caveats.pendingBillCharges.amount)} in charges on ${plural(caveats.pendingBillCharges.count, "bill", "bills")} still waiting for VTpass is already counted. If any fail, the charge is reversed on the day of the refund.`,
    },
  ].filter((n): n is { key: string; lean: string; text: string } => Boolean(n));

  if (notes.length === 0) return null;
  return (
    <div className="rounded-xl border border-[#F59E0B]/30 bg-[#FFFBEB] p-4">
      <p className="text-sm font-medium text-grey-800">Read these figures with</p>
      <ul className="mt-2 space-y-2">
        {notes.map((n) => (
          <li key={n.key} className="text-sm text-grey-500">
            <span className="mr-2 inline-block rounded bg-[#F59E0B]/15 px-1.5 py-0.5 text-xs font-medium text-[#92400e]">{n.lean}</span>
            {n.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
