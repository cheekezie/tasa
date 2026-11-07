import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useGroups, type GroupRow } from "@/features/groups/api";
import { count, date, naira } from "@/lib/format";
import appRoutes, { toPath } from "@/routes/appRoutes";
import { DataTable, type FilterConfig } from "@/shared/components/DataTable";
import { LoadFailed } from "@/shared/components/Metric";
import PageHeader from "@/shared/components/PageHeader";
import StatusBadge from "@/shared/components/StatusBadge";
import { useTableState } from "@/shared/hooks/useTableState";

/** The API caps a page at 100 and refuses a one-letter search. */
const PAGE_SIZE = 50;
const MIN_SEARCH = 2;

type Filters = { suspended: "true" | "false" | "" };

const FILTERS: FilterConfig[] = [
  {
    type: "select",
    key: "suspended",
    label: "Suspension",
    options: [
      { label: "Suspended", value: "true" },
      { label: "Not suspended", value: "false" },
    ],
  },
];

const columns: ColumnDef<GroupRow, unknown>[] = [
  {
    id: "name",
    header: "Group",
    cell: ({ row }) => (
      <Link to={toPath(appRoutes.GROUP, { id: row.original.id })} className="block min-w-48">
        <span className="block truncate font-medium text-primary hover:underline">{row.original.name}</span>
        <span className="block truncate text-xs text-grey-400">
          {row.original.owner?.name ?? "—"}
          {row.original.owner?.username && ` · @${row.original.owner.username}`}
        </span>
      </Link>
    ),
  },
  { id: "members", header: "Members", cell: ({ row }) => count(row.original.members) },
  { id: "balance", header: "Holding", cell: ({ row }) => <span className="tabular-nums">{naira(row.original.balance)}</span> },
  {
    id: "suspended",
    header: "Suspension",
    cell: ({ row }) => (row.original.suspended ? <StatusBadge variant="error" label="Suspended" /> : <span className="text-grey-300">—</span>),
  },
  { id: "created", header: "Started", cell: ({ row }) => <span className="whitespace-nowrap">{date(row.original.createdAt)}</span> },
];

/** Groups collecting dues on Tasa: what each holds for its members, and who runs it. */
export default function GroupsPage() {
  const table = useTableState<Filters>({ defaultFilters: { suspended: "" }, pageSize: PAGE_SIZE });
  const { search, page, pageSize, suspended } = table.queryParams;
  const params = useMemo(
    () => ({ page, limit: pageSize, suspended, ...(search.trim().length >= MIN_SEARCH ? { search: search.trim() } : {}) }),
    [page, pageSize, suspended, search],
  );
  const query = useGroups(params);

  return (
    <>
      <PageHeader
        title="Groups"
        subtitle="Associations and clubs collecting dues. Tasa holds the money until executives withdraw it to the group's own account."
      />
      {query.isError ? (
        <LoadFailed error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <DataTable
          getRowHref={(g) => toPath(appRoutes.GROUP, { id: g.id })}
          columns={columns}
          data={query.data?.items ?? []}
          isLoading={query.isPending}
          totalPages={query.data?.totalPages ?? 1}
          totalItems={query.data?.total ?? 0}
          tableState={table}
          filterConfigs={FILTERS}
          searchPlaceholder="Group name, invite code, or an executive's name, username or phone"
        />
      )}
    </>
  );
}
