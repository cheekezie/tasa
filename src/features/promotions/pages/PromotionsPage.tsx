import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { AUDIENCE_LABELS, useEndPromotion, usePromotions, useUpdatePromotion, type Promotion } from "@/features/promotions/api";
import { PromotionDialog } from "@/features/promotions/components/PromotionDialog";
import { serviceLabel, statusVariant } from "@/features/coupons/money";
import { count, date, naira, titleCase } from "@/lib/format";
import { DataTable, type FilterConfig } from "@/shared/components/DataTable";
import { LoadFailed } from "@/shared/components/Metric";
import PageHeader from "@/shared/components/PageHeader";
import { RowActionsMenu } from "@/shared/components/RowActionsMenu";
import StatusBadge from "@/shared/components/StatusBadge";
import { useTableState } from "@/shared/hooks/useTableState";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { useCan } from "@/stores";
import { useAskAction } from "@/shared/hooks/useAskAction";

const FILTERS: FilterConfig[] = [
  { type: "select", key: "status", label: "Status", options: ["active", "paused", "expired", "cancelled"].map((s) => ({ label: titleCase(s), value: s })) },
];

/** Tela-paid promo codes: what each gives, who can use it, and how much of its budget is gone. */
export default function PromotionsPage() {
  const canEdit = useCan("finance");
  const table = useTableState<{ status: string }>({ defaultFilters: { status: "" } });
  const query = usePromotions({ status: table.queryParams.status, page: table.queryParams.page, limit: table.queryParams.pageSize });
  const update = useUpdatePromotion();
  const end = useEndPromotion();

  const [editing, setEditing] = useState<{ promo: Promotion | null } | null>(null);
  const { ask } = useAskAction();

  /** Ending is final, unlike pausing, so it says so and offers the alternative. */
  const confirmEnd = (p: Promotion) =>
    ask({
      title: `End ${p.code}?`,
      variant: "danger",
      confirmText: "End now",
      description: (
        <p>
          The code stops working immediately and can't be restarted. Discounts already given ({naira(p.stats.spent)}) stay given. To stop it for a while
          instead, pause it.
        </p>
      ),
      onConfirm: async () => {
        await end.mutateAsync(p.id);
        return { message: `${p.code} has ended` };
      },
    });
  const [warnings, setWarnings] = useState<{ code: string; items: string[] } | null>(null);

  const setStatus = (p: Promotion, status: "active" | "paused") =>
    update.mutate(
      { id: p.id, status },
      {
        onSuccess: ({ warnings: w }) => {
          toast.success(status === "paused" ? `${p.code} paused` : `${p.code} is live again`);
          if (w.length) setWarnings({ code: p.code, items: w });
        },
      },
    );

  const columns: ColumnDef<Promotion, unknown>[] = [
    {
      id: "code",
      header: "Code",
      cell: ({ row }) => (
        <div>
          <p className="font-mono text-sm font-medium text-grey-800">{row.original.code}</p>
          <p className="max-w-48 truncate text-xs text-grey-400">{row.original.title}</p>
        </div>
      ),
    },
    {
      id: "terms",
      header: "Gives",
      cell: ({ row }) => (
        <div className="max-w-64">
          <p className="text-grey-800">{row.original.terms.summary}</p>
          <p className="text-xs text-grey-400">
            {row.original.services === "all" ? "Every bill" : row.original.services.map(serviceLabel).join(", ")}
            {row.original.providers.length > 0 && ` · ${row.original.providers.join(", ")}`}
          </p>
        </div>
      ),
    },
    {
      id: "audience",
      header: "Who",
      cell: ({ row }) => (
        <div className="space-y-1">
          <p>{AUDIENCE_LABELS[row.original.rules.audience]}</p>
          <div className="flex gap-1">
            {row.original.rules.autoApply && <StatusBadge variant="info" label="Auto" />}
            {!row.original.rules.listed && <StatusBadge variant="neutral" label="Hidden" />}
          </div>
        </div>
      ),
    },
    { id: "uses", header: "Uses", cell: ({ row }) => `${count(row.original.stats.uses)} by ${count(row.original.stats.users)}` },
    {
      id: "budget",
      header: "Budget",
      cell: ({ row }) => {
        const { spent, budgetLeft } = row.original.stats;
        const budget = row.original.rules.budget;
        const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;
        return (
          <div className="w-36">
            <p className="text-sm">
              {naira(spent)} <span className="text-grey-400">of {naira(budget, { compact: true })}</span>
            </p>
            <div className="mt-1 h-1.5 rounded-full bg-grey-50">
              <div className={`h-1.5 rounded-full ${pct >= 90 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-0.5 text-xs text-grey-400">{naira(budgetLeft)} left</p>
          </div>
        );
      },
    },
    { id: "status", header: "Status", cell: ({ row }) => <StatusBadge variant={statusVariant(row.original.status)} label={row.original.status} /> },
    {
      id: "dates",
      header: "Runs",
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-sm">
          {date(row.original.startsAt)} – {date(row.original.expiresAt)}
        </span>
      ),
    },
    ...(canEdit
      ? [
          {
            id: "actions",
            header: "",
            cell: ({ row }: { row: { original: Promotion } }) => {
              const p = row.original;
              if (p.status !== "active" && p.status !== "paused") return null;
              return (
                <RowActionsMenu
                  actions={[
                    { label: "Edit", onClick: () => setEditing({ promo: p }) },
                    p.status === "active" ? { label: "Pause", onClick: () => setStatus(p, "paused") } : { label: "Resume", onClick: () => setStatus(p, "active") },
                    { label: "End now", onClick: () => confirmEnd(p), variant: "destructive" },
                  ]}
                />
              );
            },
          } satisfies ColumnDef<Promotion, unknown>,
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Promotions"
        subtitle="Discount codes paid for by Tela. Each discount is booked as a cost when it's used."
        actions={
          canEdit
            ? [
                <Button key="new" onClick={() => setEditing({ promo: null })}>
                  New promotion
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
        columns={columns}
        data={query.data?.items ?? []}
        isLoading={query.isPending}
        totalPages={query.data?.totalPages ?? 1}
        totalItems={query.data?.total ?? 0}
        tableState={table}
        filterConfigs={FILTERS}
        showSearch={false}
      />

      <PromotionDialog
        open={editing !== null}
        promo={editing?.promo ?? null}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={(items, code) => items.length && setWarnings({ code, items })}
      />


      <Dialog open={warnings !== null} onOpenChange={(open) => !open && setWarnings(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">{warnings?.code} is saved. Check these before it goes out</DialogTitle>
            <DialogDescription>Allowed, but this setup is easy to farm.</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-2 pl-5 text-sm text-grey-500">
            {warnings?.items.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <DialogFooter>
            <Button onClick={() => setWarnings(null)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
