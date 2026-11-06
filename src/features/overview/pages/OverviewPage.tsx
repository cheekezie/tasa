import { useState } from "react";
import { Link } from "react-router-dom";
import { PERIOD_LABELS, useIncome, useOverview, type IncomePeriod } from "@/features/overview/api";
import { BillCategoryBars, IncomeBarChart, PeriodTabs } from "@/features/overview/components/IncomeInsights";
import { count, naira, percent } from "@/lib/format";
import appRoutes from "@/routes/appRoutes";
import PageHeader from "@/shared/components/PageHeader";
import { LoadFailed, Metric, Panel } from "@/shared/components/Metric";
import { Skeleton } from "@/shared/ui/skeleton";
import { useCan } from "@/stores";

/** The day's first look: what needs a person, how the period went, then where the income came from. */
export default function OverviewPage() {
  const [period, setPeriod] = useState<IncomePeriod>("this_month");
  const query = useOverview(period);
  const income = useIncome(period);
  const data = query.data;
  const canBvn = useCan("compliance");
  const canFinance = useCan("finance");

  const attention = data
    ? [
        { label: "Bills still pending", value: data.attention.pendingBills, to: `${appRoutes.TRANSACTIONS}?kind=bill&status=pending` },
        { label: "Need review", value: data.attention.needsReview, to: `${appRoutes.TRANSACTIONS}?needsReview=true` },
        { label: "Failed webhooks", value: data.attention.failedWebhooks, to: `${appRoutes.WEBHOOKS}?status=failed` },
        ...(canBvn
          ? [
              { label: "BVNs to review", value: data.attention.pendingBvn, to: appRoutes.BVN_QUEUE },
              { label: "Organisers to review", value: data.attention.pendingSellers, to: `${appRoutes.SELLERS}?verification=pending` },
            ]
          : []),
      ]
    : [];
  const change = income.data?.changePercent ?? null;

  return (
    <>
      <PageHeader title="Dashboard" subtitle="What needs attention, and how Tela is doing." actions={[<PeriodTabs key="period" value={period} onChange={setPeriod} />]} />

      {query.isError && <LoadFailed error={query.error} onRetry={() => query.refetch()} />}
      {query.isPending && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}

      {data && (
        <div className="space-y-6">
          <Panel title="Needs attention">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {attention.map((item) => (
                <Link
                  key={item.label}
                  to={item.to}
                  className="flex items-center justify-between rounded-lg border border-grey-50 px-4 py-3 transition-colors hover:bg-grey-25"
                >
                  <span className="text-sm text-grey-500">{item.label}</span>
                  <span className={`font-heading text-xl font-semibold ${item.value > 0 ? "text-destructive" : "text-grey-300"}`}>{count(item.value)}</span>
                </Link>
              ))}
            </div>
          </Panel>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label="Income"
              value={naira(income.data?.income ?? data.pnl.revenue)}
              tone={change === null ? "default" : change >= 0 ? "good" : "bad"}
              hint={
                change === null
                  ? `${naira(income.data?.billIncome ?? 0)} from bills`
                  : `${change >= 0 ? "▲" : "▼"} ${Math.abs(change)}% vs the period before · ${naira(income.data?.billIncome ?? 0)} from bills`
              }
            />
            <Metric
              label="Net"
              value={naira(data.pnl.net)}
              tone={data.pnl.net >= 0 ? "good" : "bad"}
              hint={
                canFinance ? (
                  <Link to={appRoutes.PNL} className="text-primary hover:underline">
                    Costs {naira(data.pnl.costs)} · see P&amp;L
                  </Link>
                ) : (
                  `Costs ${naira(data.pnl.costs)}`
                )
              }
            />
            <Metric label="Bills paid" value={naira(data.bills.amount)} hint={`${count(data.bills.count)} delivered · ${count(data.bills.failed)} failed`} />
            <Metric
              label="Bill success rate"
              value={data.bills.successRate === null ? "—" : percent(data.bills.successRate * 100)}
              tone={data.bills.successRate !== null && data.bills.successRate < 0.95 ? "bad" : "default"}
              hint="Delivered out of finished"
            />
            <Metric label="Users" value={count(data.users.total)} hint={`${count(data.users.new)} new in this period`} />
            <Metric label="Wallet balances owed" value={naira(data.walletLiability)} hint="Every user's wallet, right now" />
            <Metric label="Funding" value={naira(data.funding.amount)} hint={`${count(data.funding.count)} fundings`} />
            <Metric label="Transfers" value={naira(data.transfers.amount)} hint={`${count(data.transfers.count)} transfers`} />
          </div>

          {income.isError && <LoadFailed error={income.error} onRetry={() => income.refetch()} />}
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel fill title={`Income · ${PERIOD_LABELS[period].toLowerCase()}`}>
              {income.data ? <IncomeBarChart data={income.data} /> : <Skeleton className="h-[164px] rounded-lg" />}
            </Panel>
            <Panel fill title="Income by bill category">
              {income.data ? <BillCategoryBars data={income.data} /> : <Skeleton className="h-[164px] rounded-lg" />}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
