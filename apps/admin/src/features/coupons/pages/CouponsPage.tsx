import { useState } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { useCoupons, type AdminCoupon, type CouponFilters } from "@/features/coupons/api";
import { CreateTasaCouponDialog } from "@/features/coupons/components/CreateTasaCouponDialog";
import { statusVariant } from "@/features/coupons/money";
import { count, date, naira, titleCase } from "@/lib/format";
import appRoutes, { toPath } from "@/routes/appRoutes";
import { DataTable, type FilterConfig } from "@/shared/components/DataTable";
import { LoadFailed } from "@/shared/components/Metric";
import PageHeader from "@/shared/components/PageHeader";
import StatusBadge from "@/shared/components/StatusBadge";
import { useTableState } from "@/shared/hooks/useTableState";
import { Button } from "@/shared/ui/button";
import { useCan } from "@/stores";

const FILTERS: FilterConfig[] = [
  { type: "select", key: "kind", label: "Kind", options: [{ label: "Giveaways", value: "coupon" }, { label: "Gifts", value: "gift" }] },
  { type: "select", key: "fundedBy", label: "Paid by", options: [{ label: "Tasa", value: "tasa" }, { label: "Users", value: "user" }] },
  {
    type: "select",
    key: "status",
    label: "Status",
    options: ["active", "paused", "expired", "cancelled"].map((s) => ({ label: titleCase(s), value: s })),
  },
];

const columns: ColumnDef<AdminCoupon, unknown>[] = [
  {
    id: "code",
    header: "Code",
    cell: ({ row }) => (
      <Link to={toPath(appRoutes.COUPON, { id: row.original.id })} className="font-mono text-sm font-medium text-primary hover:underline">
        {row.original.code}
      </Link>
    ),
  },
  {
    id: "title",
    header: "Title",
    cell: ({ row }) => (
      <div className="max-w-56">
        <p className="truncate text-grey-800">{row.original.title}</p>
        {row.original.recipient && (
          <p className="truncate text-xs text-grey-400">
            To {row.original.recipient.userName ?? row.original.recipient.name ?? row.original.recipient.label}
          </p>
        )}
      </div>
    ),
  },
  { id: "kind", header: "Kind", cell: ({ row }) => titleCase(row.original.kind) },
  {
    id: "fundedBy",
    header: "Paid by",
    cell: ({ row }) =>
      row.original.fundedBy === "tasa" ? (
        <div className="space-y-0.5">
          <StatusBadge variant="info" label="Tasa" />
          {row.original.createdByName && <p className="max-w-36 truncate text-xs text-grey-400">by {row.original.createdByName}</p>}
        </div>
      ) : row.original.owner ? (
        <Link to={toPath(appRoutes.USER, { id: row.original.owner })} className="block max-w-36 truncate text-primary hover:underline">
          {row.original.ownerName ?? "A user"}
        </Link>
      ) : (
        <span className="text-grey-500">User</span>
      ),
  },
  { id: "amount", header: "Per person", cell: ({ row }) => naira(row.original.amount) },
  { id: "claims", header: "Claimed", cell: ({ row }) => `${count(row.original.redeemed)} / ${count(row.original.quantity)}` },
  { id: "used", header: "Spent", cell: ({ row }) => naira(row.original.stats.used) },
  {
    id: "left",
    header: "Left",
    cell: ({ row }) => {
      const s = row.original.stats;
      return row.original.fundedBy === "tasa" ? (
        <span title="What it could still cost Tasa">{naira(s.exposureLeft)} exposure</span>
      ) : (
        <span title="The owner's money still in the pool">{naira(s.poolLeft)} in pool</span>
      );
    },
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        <StatusBadge variant={statusVariant(row.original.status)} label={row.original.status} />
        {/* A closed coupon can stay active for people who already claimed it; cancelled already says it all. */}
        {row.original.closed && row.original.status !== "cancelled" && <StatusBadge variant="closed" label="Closed" />}
      </div>
    ),
  },
  { id: "expiresAt", header: "Expires", cell: ({ row }) => <span className="whitespace-nowrap">{date(row.original.expiresAt)}</span> },
];

/** Every coupon and gift, from users and from Tasa, with what each has cost or still holds. */
export default function CouponsPage() {
  const canCreate = useCan("finance");
  const [creating, setCreating] = useState(false);
  const table = useTableState<CouponFilters>({ defaultFilters: { kind: "", fundedBy: "", status: "" } });
  const { search, page, pageSize, ...filters } = table.queryParams;
  const query = useCoupons({ ...filters, code: search.trim(), page, limit: pageSize });

  return (
    <>
      <PageHeader
        title="Giveaways & gifts"
        subtitle="Codes made by users and giveaways paid for by Tasa."
        actions={
          canCreate
            ? [
                <Button key="new" onClick={() => setCreating(true)}>
                  New Tasa giveaway
                </Button>,
              ]
            : []
        }
      />
      {query.isError && (
        <div className="mb-4">
          <LoadFailed error={query.error} onRetry={() => query.refetch()} />
        </div>
      )}
      <DataTable
        getRowHref={(c) => toPath(appRoutes.COUPON, { id: c.id })}
        columns={columns}
        data={query.data?.items ?? []}
        isLoading={query.isPending}
        totalPages={query.data?.totalPages ?? 1}
        totalItems={query.data?.total ?? 0}
        tableState={table}
        filterConfigs={FILTERS}
        searchPlaceholder="Find by exact code"
      />
      <CreateTasaCouponDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
