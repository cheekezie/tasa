import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useAudit, type AuditEntry } from "@/features/audit/api";
import { useStaff } from "@/features/staff/api";
import { dateTime, titleCase } from "@/lib/format";
import { DataTable, type FilterConfig } from "@/shared/components/DataTable";
import { LoadFailed } from "@/shared/components/Metric";
import PageHeader from "@/shared/components/PageHeader";
import StatusBadge, { type StatusVariant } from "@/shared/components/StatusBadge";
import { useTableState } from "@/shared/hooks/useTableState";
import { useCan } from "@/stores";

const PAGE_SIZE = 50;

const statusVariant = (code: number): StatusVariant => (code < 300 ? "success" : code < 500 ? "warning" : "error");

/** "/api/admin/users/:id/status" → "/users/:id/status": the prefix is the same on every row. */
const shortRoute = (route: string) => route.replace(/^\/api\/admin/, "") || "/";

/** Key/value pairs from params or details, one per line. Values the API stored as objects are shown as JSON. */
function Pairs({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return <span className="text-grey-300">—</span>;
  return (
    <dl className="space-y-0.5 text-xs">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-1.5">
          <dt className="shrink-0 text-grey-400">{k}:</dt>
          <dd className="max-w-64 truncate font-mono text-grey-700" title={typeof v === "string" ? v : JSON.stringify(v)}>
            {typeof v === "string" ? v : JSON.stringify(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Every change made in the back office, newest first, including attempts the API refused. */
export default function AuditPage() {
  // Rows carry the admin's name. The picker needs the staff list, which only super admins can read;
  // everyone else filters by clicking a name.
  const isSuper = useCan("super_admin");
  const staff = useStaff(isSuper);

  const table = useTableState<{ admin: string }>({ defaultFilters: { admin: "" }, pageSize: PAGE_SIZE });
  const { page, pageSize, admin } = table.queryParams;
  const query = useAudit({ page, limit: pageSize, ...(admin ? { admin } : {}) });
  const filteredName =
    staff.data?.find((s) => s.id === admin)?.name ?? query.data?.items.find((i) => i.admin === admin)?.adminName ?? admin;

  const filters = useMemo<FilterConfig[]>(
    () =>
      staff.data
        ? [{ type: "select", key: "admin", label: "Admin", searchable: true, options: staff.data.map((s) => ({ label: s.name, value: s.id })) }]
        : [],
    [staff.data],
  );

  const columns = useMemo<ColumnDef<AuditEntry, unknown>[]>(
    () => [
      { id: "time", header: "Time", cell: ({ row }) => <span className="whitespace-nowrap">{dateTime(row.original.createdAt)}</span> },
      {
        id: "admin",
        header: "Who",
        cell: ({ row }) => {
          const name = row.original.adminName;
          return (
            <button
              type="button"
              className="text-left hover:underline"
              title="Show only this admin's actions"
              onClick={() => table.setFilter("admin", row.original.admin)}
            >
              <span className={name ? "font-medium text-grey-800" : "font-mono text-xs text-grey-700"}>{name ?? row.original.admin}</span>
              {row.original.role && <span className="block text-xs text-grey-400">{titleCase(row.original.role)}</span>}
            </button>
          );
        },
      },
      {
        id: "action",
        header: "Action",
        cell: ({ row }) => (
          <span className="whitespace-nowrap font-mono text-xs">
            <span className="mr-1.5 rounded bg-grey-25 px-1.5 py-0.5 font-semibold text-grey-700">{row.original.method}</span>
            {shortRoute(row.original.route)}
          </span>
        ),
      },
      { id: "params", header: "Target", cell: ({ row }) => <Pairs data={row.original.params} /> },
      { id: "details", header: "Details", cell: ({ row }) => <Pairs data={row.original.details} /> },
      {
        id: "status",
        header: "Result",
        cell: ({ row }) => <StatusBadge variant={statusVariant(row.original.statusCode)} label={String(row.original.statusCode)} />,
      },
      { id: "ip", header: "IP", cell: ({ row }) => <span className="font-mono text-xs text-grey-500">{row.original.ip ?? "—"}</span> },
    ],
    [table],
  );

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every back-office change and refused attempt. Passwords are never recorded; BVN reveals are logged with their reason."
      />
      {admin && (
        <div className="mb-3 flex items-center gap-2 text-sm text-grey-500">
          <span>
            Showing actions by <span className="font-medium text-grey-800">{filteredName}</span>
          </span>
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => table.setFilter("admin", "")}>
            Show everyone
          </button>
        </div>
      )}
      {query.isError ? (
        <LoadFailed error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={query.data?.items ?? []}
          isLoading={query.isPending}
          totalPages={query.data?.totalPages ?? 1}
          totalItems={query.data?.total ?? 0}
          tableState={table}
          filterConfigs={filters}
          showSearch={false}
        />
      )}
    </>
  );
}
