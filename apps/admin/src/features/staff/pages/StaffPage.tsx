import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useStaff, type StaffMember } from "@/features/staff/api";
import { CreateStaffDialog, EditStaffDialog, ResetPasswordDialog } from "@/features/staff/components/StaffDialogs";
import { ROLE_INFO } from "@/features/staff/roles";
import { dateTime } from "@/lib/format";
import { DataTable } from "@/shared/components/DataTable";
import { LoadFailed } from "@/shared/components/Metric";
import PageHeader from "@/shared/components/PageHeader";
import { RowActionsMenu } from "@/shared/components/RowActionsMenu";
import StatusBadge from "@/shared/components/StatusBadge";
import { useTableState } from "@/shared/hooks/useTableState";
import { Button } from "@/shared/ui/button";
import { useAuthStore } from "@/stores/auth.store";

/** Who can use the back office, and as what. Super admins only. */
export default function StaffPage() {
  const query = useStaff();
  const me = useAuthStore((s) => s.user);
  const table = useTableState<Record<string, never>>({ defaultFilters: {} });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [resetting, setResetting] = useState<StaffMember | null>(null);

  const columns = useMemo<ColumnDef<StaffMember, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        cell: ({ row }) => (
          <div>
            <p className="font-medium text-grey-800">
              {row.original.name}
              {row.original.id === me?.id && <span className="ml-1.5 text-xs font-normal text-grey-400">(you)</span>}
            </p>
            <p className="text-xs text-grey-400">{row.original.email}</p>
          </div>
        ),
      },
      { id: "role", header: "Role", cell: ({ row }) => ROLE_INFO[row.original.role].label },
      {
        id: "access",
        header: "Access",
        cell: ({ row }) => <StatusBadge variant={row.original.isActive ? "success" : "inactive"} label={row.original.isActive ? "Active" : "Deactivated"} />,
      },
      { id: "lastLogin", header: "Last sign-in", cell: ({ row }) => (row.original.lastLoginAt ? dateTime(row.original.lastLoginAt) : "Never") },
      { id: "added", header: "Added", cell: ({ row }) => dateTime(row.original.createdAt) },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <RowActionsMenu
            triggerLabel={`Actions for ${row.original.name}`}
            actions={[
              { label: "Edit", onClick: () => setEditing(row.original) },
              { label: "Reset password", onClick: () => setResetting(row.original) },
            ]}
          />
        ),
      },
    ],
    [me?.id],
  );

  return (
    <>
      <PageHeader
        title="Staff"
        subtitle="Changes apply on each person's next request. Deactivating someone signs them out everywhere."
        actions={[
          <Button key="add" onClick={() => setCreating(true)}>
            Add staff member
          </Button>,
        ]}
      />
      {query.isError ? (
        <LoadFailed error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={query.data ?? []}
          isLoading={query.isPending}
          totalPages={1}
          totalItems={query.data?.length ?? 0}
          tableState={table}
          showSearch={false}
          serialColumn={false}
        />
      )}
      <CreateStaffDialog open={creating} onOpenChange={setCreating} />
      {editing && <EditStaffDialog key={editing.id} member={editing} isSelf={editing.id === me?.id} onClose={() => setEditing(null)} />}
      {resetting && <ResetPasswordDialog key={resetting.id} member={resetting} onClose={() => setResetting(null)} />}
    </>
  );
}
