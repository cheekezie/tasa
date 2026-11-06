import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useUsers, type UserRow } from "@/features/users/api";
import { UserStatusBadge } from "@/features/users/components/badges";
import { userName } from "@/features/users/userName";
import { date } from "@/lib/format";
import appRoutes, { toPath } from "@/routes/appRoutes";
import { DataTable } from "@/shared/components/DataTable";
import { LoadFailed } from "@/shared/components/Metric";
import PageHeader from "@/shared/components/PageHeader";
import { useTableState } from "@/shared/hooks/useTableState";
import { Button } from "@/shared/ui/button";

const PAGE_SIZE = 50;

const columns: ColumnDef<UserRow, unknown>[] = [
  {
    id: "name",
    header: "User",
    cell: ({ row }) => (
      <Link to={toPath(appRoutes.USER, { id: row.original.id })} className="font-medium text-primary hover:underline">
        {userName(row.original)}
      </Link>
    ),
  },
  { id: "contact", header: "Phone / email", cell: ({ row }) => row.original.phone ?? row.original.email ?? "—" },
  { id: "bvn", header: "BVN", cell: ({ row }) => <span className="font-mono text-xs text-grey-500">•••• {row.original.bvn?.last4 ?? "—"}</span> },
  { id: "status", header: "Account", cell: ({ row }) => <UserStatusBadge status={row.original.status} /> },
  { id: "joined", header: "Joined", cell: ({ row }) => date(row.original.createdAt) },
  {
    id: "review",
    header: "",
    cell: ({ row }) => (
      <Button asChild size="sm" variant="outline">
        <Link to={toPath(appRoutes.USER, { id: row.original.id })}>Review</Link>
      </Button>
    ),
  },
];

/** BVNs the automatic check couldn't settle. Open one to compare it and decide. */
export default function BvnQueuePage() {
  const table = useTableState<Record<string, never>>({ defaultFilters: {}, pageSize: PAGE_SIZE });
  const query = useUsers({ page: table.page, limit: table.pageSize, bvnStatus: "pending" });

  return (
    <>
      <PageHeader
        title="BVN review"
        subtitle="Pending BVNs, newest sign-ups first. Each user is told the outcome as soon as you decide."
      />
      {query.isError ? (
        <LoadFailed error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <DataTable
          getRowHref={(u) => toPath(appRoutes.USER, { id: u.id })}
          columns={columns}
          data={query.data?.items ?? []}
          isLoading={query.isPending}
          totalPages={query.data?.totalPages ?? 1}
          totalItems={query.data?.total ?? 0}
          tableState={table}
          showSearch={false}
        />
      )}
      {query.data && query.data.total === 0 && <p className="mt-3 text-sm text-grey-400">Nothing to review. New pending BVNs show up here.</p>}
    </>
  );
}
