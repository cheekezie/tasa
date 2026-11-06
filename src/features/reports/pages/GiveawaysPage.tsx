import { useState } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { statusVariant } from "@/features/coupons/money";
import { useGiveaways, type GiveawayRow } from "@/features/reports/api";
import { count, date, naira, titleCase } from "@/lib/format";
import { rangeParams, type RangeKey } from "@/lib/range";
import appRoutes, { toPath } from "@/routes/appRoutes";
import { DataTable, type FilterConfig } from "@/shared/components/DataTable";
import { LoadFailed, Metric } from "@/shared/components/Metric";
import PageHeader from "@/shared/components/PageHeader";
import { RangeTabs } from "@/shared/components/RangeTabs";
import StatusBadge from "@/shared/components/StatusBadge";
import { useTableState } from "@/shared/hooks/useTableState";
import { Skeleton } from "@/shared/ui/skeleton";

const FILTERS: FilterConfig[] = [
  { type: "select", key: "kind", label: "Kind", options: [{ label: "Promotions", value: "promo" }, { label: "Giveaways", value: "coupon" }, { label: "Gifts", value: "gift" }] },
  { type: "select", key: "status", label: "Status", options: ["active", "paused", "expired", "cancelled"].map((s) => ({ label: titleCase(s), value: s })) },
];

const columns: ColumnDef<GiveawayRow, unknown>[] = [
  {
    id: "code",
    header: "Campaign",
    cell: ({ row }) => {
      const g = row.original;
      return (
        <Link to={g.kind === "promo" ? appRoutes.PROMOTIONS : toPath(appRoutes.COUPON, { id: g.id })} className="block max-w-56 hover:underline">
          <span className="font-mono text-sm font-medium text-primary">{g.code}</span>
          <span className="block truncate text-xs text-grey-400">{g.title}</span>
        </Link>
      );
    },
  },
  { id: "kind", header: "Kind", cell: ({ row }) => (row.original.kind === "promo" ? "Promotion" : titleCase(row.original.kind)) },
  { id: "status", header: "Status", cell: ({ row }) => <StatusBadge variant={statusVariant(row.original.status)} label={row.original.status} /> },
  { id: "uses", header: "Uses", cell: ({ row }) => count(row.original.uses) },
  { id: "people", header: "People", cell: ({ row }) => count(row.original.people) },
  { id: "period", header: "Cost in period", cell: ({ row }) => <span className="font-medium text-grey-800">{naira(row.original.costInPeriod)}</span> },
  { id: "toDate", header: "Cost to date", cell: ({ row }) => naira(row.original.costToDate) },
  {
    id: "ceiling",
    header: "Ceiling",
    cell: ({ row }) => <span title={row.original.kind === "promo" ? "Budget" : "Amount × people"}>{naira(row.original.maxCost)}</span>,
  },
  {
    id: "exposure",
    header: "Exposure left",
    cell: ({ row }) => (row.original.exposureLeft ? naira(row.original.exposureLeft) : <span className="text-grey-300">—</span>),
  },
  {
    id: "dates",
    header: "Runs",
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-sm">
        {date(row.original.startsAt)} – {date(row.original.expiresAt)}
      </span>
    ),
  },
];

/** What Tela's own promotions, coupons and gifts have cost, and how much more they could. */
export default function GiveawaysPage() {
  const [rangeKey, setRangeKey] = useState<RangeKey>("30d");
  const query = useGiveaways(rangeParams(rangeKey));
  const data = query.data;
  const table = useTableState<{ kind: string; status: string }>({ defaultFilters: { kind: "", status: "" } });

  // The API returns everything at once; filter here.
  const { search, kind, status } = table.queryParams;
  const needle = search.trim().toLowerCase();
  const rows = (data?.items ?? []).filter(
    (g) =>
      (!kind || g.kind === kind) &&
      (!status || g.status === status) &&
      (!needle || g.code.toLowerCase().includes(needle) || g.title.toLowerCase().includes(needle)),
  );

  return (
    <>
      <PageHeader
        title="Giveaways & promotions"
        subtitle="Everything Tela pays for: promo discounts and its own giveaways and gifts."
        actions={[<RangeTabs key="range" value={rangeKey} onChange={setRangeKey} />]}
      />
      {query.isError && (
        <div className="mb-4">
          <LoadFailed error={query.error} onRetry={() => query.refetch()} />
        </div>
      )}
      {query.isPending && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}
      {data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Cost in this period"
            value={naira(data.totals.costInPeriod)}
            hint={`Promotions ${naira(data.totals.promotionsInPeriod)} · giveaways ${naira(data.totals.giveawaysInPeriod)}`}
          />
          <Metric label="Cost to date" value={naira(data.totals.costToDate)} hint="Since the first campaign" />
          <Metric label="Exposure left" value={naira(data.totals.exposureLeft)} hint="Most that live campaigns could still cost" />
          <Metric label="Campaigns" value={count(data.items.length)} hint={`${count(data.items.filter((g) => g.status === "active").length)} active`} />
        </div>
      )}
      <DataTable
        columns={columns}
        data={rows}
        isLoading={query.isPending}
        totalPages={1}
        totalItems={rows.length}
        tableState={table}
        filterConfigs={FILTERS}
        searchPlaceholder="Search code or title"
      />
    </>
  );
}
