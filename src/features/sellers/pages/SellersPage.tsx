import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Link, useSearchParams } from "react-router-dom";
import { useSellers, type SellerRow, type SellerVerificationStatus } from "@/features/sellers/api";
import { SellerLogo, SuspendedBadge, VerificationBadge } from "@/features/sellers/components/badges";
import { count, date } from "@/lib/format";
import appRoutes, { toPath } from "@/routes/appRoutes";
import { DataTable, type FilterConfig } from "@/shared/components/DataTable";
import { LoadFailed } from "@/shared/components/Metric";
import PageHeader from "@/shared/components/PageHeader";
import { useTableState } from "@/shared/hooks/useTableState";

/** The API caps a page at 100 and refuses a one-letter search. */
const PAGE_SIZE = 50;
const MIN_SEARCH = 2;

type Filters = { verification: SellerVerificationStatus | ""; suspended: "true" | "false" | "" };

const FILTERS: FilterConfig[] = [
  {
    type: "select",
    key: "verification",
    label: "Verification",
    options: [
      { label: "Pending review", value: "pending" },
      { label: "Approved", value: "approved" },
      { label: "Rejected", value: "rejected" },
      { label: "Not submitted", value: "unsubmitted" },
    ],
  },
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

const displayName = (s: Pick<SellerRow, "organisation" | "name" | "username">) =>
  s.organisation ?? s.name ?? (s.username ? `@${s.username}` : "Unnamed organiser");

const columns: ColumnDef<SellerRow, unknown>[] = [
  {
    id: "organisation",
    header: "Organiser",
    cell: ({ row }) => {
      const s = row.original;
      return (
        <Link to={toPath(appRoutes.SELLER, { id: s.id })} className="flex min-w-48 items-center gap-3">
          <SellerLogo url={s.logoUrl} name={displayName(s)} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-primary hover:underline">{s.organisation ?? "No organisation name"}</span>
            <span className="block truncate text-xs text-grey-400">
              {s.name ?? "—"}
              {s.username && ` · @${s.username}`}
            </span>
          </span>
        </Link>
      );
    },
  },
  {
    id: "verification",
    header: "Verification",
    cell: ({ row }) => (
      <div className="space-y-1">
        <VerificationBadge status={row.original.verification.status} />
        {row.original.verification.status === "pending" && row.original.verification.submittedAt && (
          <p className="text-xs text-grey-400">Sent {date(row.original.verification.submittedAt)}</p>
        )}
      </div>
    ),
  },
  {
    id: "suspension",
    header: "Suspension",
    cell: ({ row }) => (row.original.suspension.active ? <SuspendedBadge suspension={row.original.suspension} /> : <span className="text-grey-300">—</span>),
  },
  { id: "events", header: "Events", cell: ({ row }) => count(row.original.events) },
  { id: "since", header: "Selling since", cell: ({ row }) => <span className="whitespace-nowrap">{date(row.original.since)}</span> },
];

/** Everyone who opted in to selling tickets. Filtered to pending, it's compliance's review queue. */
export default function SellersPage() {
  // The dashboard links here with ?verification=pending.
  const [searchParams] = useSearchParams();
  const fromUrl = searchParams.get("verification");
  const initialVerification = (["pending", "approved", "rejected", "unsubmitted"] as const).find((v) => v === fromUrl) ?? "";
  const table = useTableState<Filters>({ defaultFilters: { verification: initialVerification, suspended: "" }, pageSize: PAGE_SIZE });
  const { search, page, pageSize, verification, suspended } = table.queryParams;
  const params = useMemo(
    () => ({ page, limit: pageSize, verification, suspended, ...(search.trim().length >= MIN_SEARCH ? { search: search.trim() } : {}) }),
    [page, pageSize, verification, suspended, search],
  );
  const query = useSellers(params);
  const isQueue = verification === "pending";

  return (
    <>
      <PageHeader
        title={isQueue ? "Organiser review queue" : "Organisers"}
        subtitle={
          isQueue
            ? `Oldest first, so whoever has waited longest is at the top.${query.data ? ` ${count(query.data.total)} waiting.` : ""}`
            : "People selling tickets on Tasa. Organisers send a selfie and an ID before they can create events."
        }
      />
      {query.isError ? (
        <LoadFailed error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <DataTable
          getRowHref={(s) => toPath(appRoutes.SELLER, { id: s.id })}
          columns={columns}
          data={query.data?.items ?? []}
          isLoading={query.isPending}
          totalPages={query.data?.totalPages ?? 1}
          totalItems={query.data?.total ?? 0}
          tableState={table}
          filterConfigs={FILTERS}
          searchPlaceholder="Organisation, name, username, phone or email"
        />
      )}
    </>
  );
}
