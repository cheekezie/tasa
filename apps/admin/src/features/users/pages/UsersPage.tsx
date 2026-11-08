import { UserAvatar } from "@/shared/components/UserAvatar";
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Link } from "react-router-dom";
import { useUsers, type BvnStatus, type UserRow, type UserStatus } from "@/features/users/api";
import { BvnBadge, UserStatusBadge } from "@/features/users/components/badges";
import { userName } from "@/features/users/userName";
import { date } from "@/lib/format";
import appRoutes, { toPath } from "@/routes/appRoutes";
import { DataTable, type FilterConfig } from "@/shared/components/DataTable";
import { LoadFailed } from "@/shared/components/Metric";
import PageHeader from "@/shared/components/PageHeader";
import { useTableState } from "@/shared/hooks/useTableState";

/** The API caps a page at 100 and refuses a one-letter search. */
const PAGE_SIZE = 50;
const MIN_SEARCH = 2;

const FILTERS: FilterConfig[] = [
  {
    type: "select",
    key: "status",
    label: "Account",
    options: [
      { label: "Active", value: "active" },
      { label: "Suspended", value: "suspended" },
      { label: "Closed", value: "closed" },
    ],
  },
  {
    type: "select",
    key: "bvnStatus",
    label: "BVN",
    options: [
      { label: "Pending review", value: "pending" },
      { label: "Verified", value: "verified" },
      { label: "Rejected", value: "rejected" },
    ],
  },
];

const columns: ColumnDef<UserRow, unknown>[] = [
  {
    id: "name",
    header: "User",
    cell: ({ row }) => (
      <Link to={toPath(appRoutes.USER, { id: row.original.id })} className="flex items-center gap-2.5">
        <UserAvatar url={row.original.avatarUrl} name={userName(row.original)} size="sm" />
        <span className="font-medium text-primary hover:underline">
          {userName(row.original)}
          {row.original.fullName && row.original.username && <span className="ml-1.5 font-normal text-grey-400">@{row.original.username}</span>}
        </span>
      </Link>
    ),
  },
  { id: "phone", header: "Phone", cell: ({ row }) => row.original.phone ?? "—" },
  { id: "email", header: "Email", cell: ({ row }) => row.original.email ?? "—" },
  { id: "status", header: "Status", cell: ({ row }) => <UserStatusBadge status={row.original.status} /> },
  { id: "bvn", header: "BVN", cell: ({ row }) => <BvnBadge bvn={row.original.bvn} /> },
  { id: "joined", header: "Joined", cell: ({ row }) => date(row.original.createdAt) },
];

/** Everyone on Tasa, newest first. Find someone by phone, email, username or name. */
export default function UsersPage() {
  const table = useTableState<{ bvnStatus: BvnStatus | ""; status: UserStatus | "" }>({ defaultFilters: { bvnStatus: "", status: "" }, pageSize: PAGE_SIZE });
  const { search, page, pageSize, bvnStatus, status } = table.queryParams;
  const params = useMemo(
    () => ({ page, limit: pageSize, bvnStatus, status, ...(search.trim().length >= MIN_SEARCH ? { search: search.trim() } : {}) }),
    [page, pageSize, bvnStatus, status, search],
  );
  const query = useUsers(params);

  return (
    <>
      <PageHeader title="Users" subtitle="Look someone up to see their wallet, BVN and account status." />
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
          filterConfigs={FILTERS}
          searchPlaceholder="Phone, email, username or name"
        />
      )}
    </>
  );
}
