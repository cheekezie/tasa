import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { usePointsBalances, type PointsBalanceRow } from "@/features/points/api";
import { count, dateTime, naira } from "@/lib/format";
import appRoutes, { toPath } from "@/routes/appRoutes";
import BackButton from "@/shared/components/BackButton";
import { DataTable, type FilterConfig } from "@/shared/components/DataTable";
import { LoadFailed } from "@/shared/components/Metric";
import PageHeader from "@/shared/components/PageHeader";
import { useTableState } from "@/shared/hooks/useTableState";

const PAGE_SIZE = 25;

type Filters = { sort: "balance" | "earned" };

const FILTERS: FilterConfig[] = [
  {
    type: "select",
    key: "sort",
    label: "Sort by",
    options: [
      { label: "Biggest balance", value: "balance" },
      { label: "Most earned ever", value: "earned" },
    ],
  },
];

const columns: ColumnDef<PointsBalanceRow, unknown>[] = [
  {
    id: "user",
    header: "User",
    cell: ({ row }) => (
      <Link to={toPath(appRoutes.USER, { id: row.original.userId })} className="block min-w-40">
        <span className="block font-medium text-primary hover:underline">{row.original.name ?? "Tela user"}</span>
        {row.original.username && <span className="block text-xs text-grey-400">@{row.original.username}</span>}
      </Link>
    ),
  },
  { id: "balance", header: "Points", cell: ({ row }) => <span className="font-medium text-grey-800 tabular-nums">{count(row.original.balance)}</span> },
  { id: "value", header: "Worth now", cell: ({ row }) => <span className="tabular-nums">{naira(row.original.value)}</span> },
  { id: "earned", header: "Earned ever", cell: ({ row }) => <span className="text-grey-500 tabular-nums">{count(row.original.lifetimeEarned)}</span> },
  { id: "last", header: "Last earned or spent", cell: ({ row }) => <span className="text-grey-500">{dateTime(row.original.lastActivityAt)}</span> },
];

/** Who holds the points, and what they'd cost if converted today. */
export default function PointsBalancesPage() {
  const table = useTableState<Filters>({ defaultFilters: { sort: "balance" }, pageSize: PAGE_SIZE });
  const { search, page, pageSize, sort } = table.queryParams;
  // The API needs two characters to search; until then it lists everyone.
  const query = usePointsBalances({ ...(search.trim().length >= 2 && { search: search.trim() }), sort, page, limit: pageSize });

  return (
    <>
      <BackButton className="mb-4" />
      <PageHeader title="Points by user" subtitle="Each user's points, what they're worth at today's rate, and when they last moved." />
      {query.isError && <LoadFailed error={query.error} onRetry={() => query.refetch()} />}
      <DataTable
        getRowHref={(r) => toPath(appRoutes.USER, { id: r.userId })}
        columns={columns}
        data={query.data?.items ?? []}
        isLoading={query.isPending}
        totalPages={query.data?.totalPages ?? 1}
        totalItems={query.data?.total ?? 0}
        tableState={table}
        filterConfigs={FILTERS}
        searchPlaceholder="Name, @username, phone or email"
      />
    </>
  );
}
