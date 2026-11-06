import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Link, useSearchParams } from "react-router-dom";
import {
  WEBHOOK_PROVIDERS,
  WEBHOOK_STATUSES,
  useWebhooks,
  type WebhookEvent,
  type WebhookProvider,
  type WebhookStatus,
} from "@/features/webhooks/api";
import { PROVIDER_LABELS, SIGNATURE_LABELS, WEBHOOK_STATUS_VARIANTS } from "@/features/webhooks/labels";
import { count, dateTime, titleCase } from "@/lib/format";
import appRoutes, { toPath } from "@/routes/appRoutes";
import { DataTable, type FilterConfig } from "@/shared/components/DataTable";
import { LoadFailed } from "@/shared/components/Metric";
import PageHeader from "@/shared/components/PageHeader";
import StatusBadge from "@/shared/components/StatusBadge";
import { useTableState } from "@/shared/hooks/useTableState";
import { useCan } from "@/stores";

type Filters = { provider: WebhookProvider | ""; status: WebhookStatus | "" };

const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | "" =>
  value && (allowed as readonly string[]).includes(value) ? (value as T) : "";

const filterConfigs: FilterConfig[] = [
  { type: "select", key: "provider", label: "Provider", options: WEBHOOK_PROVIDERS.map((p) => ({ label: PROVIDER_LABELS[p], value: p })) },
  { type: "select", key: "status", label: "Status", options: WEBHOOK_STATUSES.map((s) => ({ label: titleCase(s), value: s })) },
];

/** Every provider callback as received. Failed ones are where missed credits and refunds hide. */
export default function WebhooksPage() {
  const canOpen = useCan("finance");
  const [searchParams, setSearchParams] = useSearchParams();
  // The dashboard links here as `?status=failed`.
  const [defaultFilters] = useState<Filters>(() => ({
    provider: pick(searchParams.get("provider"), WEBHOOK_PROVIDERS),
    status: pick(searchParams.get("status"), WEBHOOK_STATUSES),
  }));
  const table = useTableState<Filters>({ defaultFilters });
  const { page, pageSize, provider, status } = table.queryParams;
  const params = useMemo(() => ({ provider, status, page, limit: pageSize }), [provider, status, page, pageSize]);
  const query = useWebhooks(params);

  useEffect(() => {
    const next = new URLSearchParams();
    if (provider) next.set("provider", provider);
    if (status) next.set("status", status);
    setSearchParams(next, { replace: true });
  }, [provider, status, setSearchParams]);

  const columns = useMemo<ColumnDef<WebhookEvent, unknown>[]>(
    () => [
      {
        id: "received",
        header: "Received",
        cell: ({ row }) =>
          canOpen ? (
            <Link to={toPath(appRoutes.WEBHOOK, { id: row.original.id })} className="whitespace-nowrap font-medium text-primary hover:underline">
              {dateTime(row.original.createdAt)}
            </Link>
          ) : (
            <span className="whitespace-nowrap text-grey-600">{dateTime(row.original.createdAt)}</span>
          ),
      },
      {
        id: "provider",
        header: "Provider",
        cell: ({ row }) => (
          <div>
            <p className="text-sm text-grey-800">{PROVIDER_LABELS[row.original.provider]}</p>
            <p className={row.original.signature === "invalid" ? "text-xs text-destructive" : "text-xs text-grey-400"}>
              {SIGNATURE_LABELS[row.original.signature]}
            </p>
          </div>
        ),
      },
      {
        id: "reference",
        header: "Reference",
        cell: ({ row }) => <span className="font-mono text-xs text-grey-600">{row.original.reference ?? "—"}</span>,
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge variant={WEBHOOK_STATUS_VARIANTS[row.original.status]} label={row.original.status} />,
      },
      {
        id: "outcome",
        header: "Outcome",
        cell: ({ row }) =>
          row.original.error ? (
            <span className="line-clamp-2 max-w-md text-sm text-destructive">{row.original.error}</span>
          ) : (
            <span className="line-clamp-2 max-w-md text-sm text-grey-500">{row.original.result ?? "—"}</span>
          ),
      },
    ],
    [canOpen],
  );

  return (
    <>
      <PageHeader
        title="Webhooks"
        subtitle={
          query.data
            ? `${count(query.data.total)} matching. Kept for 180 days.${canOpen ? " Open one to see its body or replay it." : ""}`
            : "Callbacks from SaySwitch and VTpass, newest first."
        }
      />
      {query.isError ? (
        <LoadFailed error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <DataTable
          getRowHref={(w) => (canOpen ? toPath(appRoutes.WEBHOOK, { id: w.id }) : null)}
          columns={columns}
          data={query.data?.items ?? []}
          isLoading={query.isPending}
          totalPages={query.data?.totalPages ?? 1}
          totalItems={query.data?.total ?? 0}
          tableState={table}
          filterConfigs={filterConfigs}
          showSearch={false}
          serialColumn={false}
        />
      )}
    </>
  );
}
