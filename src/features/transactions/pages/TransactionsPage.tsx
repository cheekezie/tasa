import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { X } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import {
  TRANSACTION_KINDS,
  TRANSACTION_STATUSES,
  useTransactions,
  type AdminTransaction,
  type TransactionKind,
  type TransactionStatus,
} from "@/features/transactions/api";
import { KIND_LABELS, STATUS_VARIANTS } from "@/features/transactions/labels";
import { count, dateTime, naira, titleCase } from "@/lib/format";
import appRoutes, { toPath } from "@/routes/appRoutes";
import { DataTable, type FilterConfig } from "@/shared/components/DataTable";
import { LoadFailed } from "@/shared/components/Metric";
import PageHeader from "@/shared/components/PageHeader";
import StatusBadge from "@/shared/components/StatusBadge";
import { useTableState } from "@/shared/hooks/useTableState";
import { useUser } from "@/features/users/api";
import { userName } from "@/features/users/userName";
import { UserAvatar } from "@/shared/components/UserAvatar";

type Filters = {
  status: TransactionStatus | "";
  kind: TransactionKind | "";
  needsReview: "true" | "false" | "";
  channel: "app" | "web" | "";
  from: string;
  to: string;
  /** Set by the user detail page's link; no picker, only a removable chip. */
  user: string;
};

const pick = <T extends string>(value: string | null, allowed: readonly T[]): T | "" =>
  value && (allowed as readonly string[]).includes(value) ? (value as T) : "";

const isDay = (value: string | null) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "");

/** The dashboard links here with filters in the query string (`?kind=bill&status=pending`, `?needsReview=true`). */
function filtersFromUrl(params: URLSearchParams): Filters {
  return {
    status: pick(params.get("status"), TRANSACTION_STATUSES),
    kind: pick(params.get("kind"), TRANSACTION_KINDS),
    needsReview: pick(params.get("needsReview"), ["true", "false"] as const),
    channel: pick(params.get("channel"), ["app", "web"] as const),
    from: isDay(params.get("from")),
    to: isDay(params.get("to")),
    user: /^[a-f0-9]{24}$/i.test(params.get("user") ?? "") ? params.get("user")! : "",
  };
}

const filterConfigs: FilterConfig[] = [
  { type: "select", key: "status", label: "Status", options: TRANSACTION_STATUSES.map((s) => ({ label: titleCase(s), value: s })) },
  { type: "select", key: "kind", label: "Kind", searchable: true, options: TRANSACTION_KINDS.map((k) => ({ label: KIND_LABELS[k], value: k })) },
  {
    type: "select",
    key: "needsReview",
    label: "Review",
    options: [
      { label: "Needs review", value: "true" },
      { label: "Doesn't need review", value: "false" },
    ],
  },
  {
    type: "select",
    key: "channel",
    label: "Channel",
    options: [
      { label: "App", value: "app" },
      { label: "Website (no app)", value: "web" },
    ],
  },
  { type: "daterange", label: "Created", fromKey: "from", toKey: "to" },
];

const columns: ColumnDef<AdminTransaction, unknown>[] = [
  {
    id: "reference",
    header: "Reference",
    cell: ({ row }) => (
      <Link to={toPath(appRoutes.TRANSACTION, { id: row.original.id })} className="font-mono text-xs font-medium text-primary hover:underline">
        {row.original.reference}
      </Link>
    ),
  },
  {
    id: "what",
    header: "Transaction",
    cell: ({ row }) => (
      <div className="min-w-48">
        <p className="text-sm text-grey-800">{row.original.title}</p>
        <p className="text-xs text-grey-400">
          {KIND_LABELS[row.original.kind]}
          {row.original.subtitle ? ` · ${row.original.subtitle}` : ""}
        </p>
        {row.original.channel === "web" && <StatusBadge variant="info" label="Website" className="mt-1" />}
      </div>
    ),
  },
  {
    id: "total",
    header: "Amount",
    cell: ({ row }) => (
      <div className="whitespace-nowrap">
        <p className={row.original.direction === "credit" ? "text-success-500" : "text-grey-800"}>
          {row.original.direction === "credit" ? "+" : "−"}
          {naira(row.original.total)}
        </p>
        {row.original.fee > 0 && <p className="text-xs text-grey-400">incl. {naira(row.original.fee)} charges</p>}
      </div>
    ),
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        <StatusBadge variant={STATUS_VARIANTS[row.original.status]} label={row.original.status} />
        {row.original.needsReview && <StatusBadge variant="error" label="Needs review" />}
      </div>
    ),
  },
  {
    id: "user",
    header: "User",
    cell: ({ row }) => (
      <Link to={toPath(appRoutes.USER, { id: row.original.user })} className="block max-w-40 truncate text-sm text-primary hover:underline">
        {row.original.userName ?? "Unknown user"}
      </Link>
    ),
  },
  { id: "date", header: "Created", cell: ({ row }) => <span className="whitespace-nowrap text-grey-500">{dateTime(row.original.date)}</span> },
];

/** Every transaction, newest first. The place to find a stuck bill or a user's missing money. */
export default function TransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [initial] = useState(() => ({ filters: filtersFromUrl(searchParams), reference: searchParams.get("reference") ?? "" }));
  const table = useTableState<Filters>({ defaultFilters: initial.filters });
  // useTableState has no initial search, so seed a `?reference=` once, during the first render.
  const [seeded, setSeeded] = useState(false);
  if (!seeded) {
    setSeeded(true);
    if (initial.reference) table.setSearchInput(initial.reference);
  }

  const { search, page, pageSize, status, kind, needsReview, channel, from, to, user } = table.queryParams;
  const params = useMemo(
    () => ({ status, kind, needsReview, channel, user, reference: search.trim(), from, to, page, limit: pageSize }),
    [status, kind, needsReview, channel, user, search, from, to, page, pageSize],
  );
  const query = useTransactions(params);

  // Keep the URL in step with the filters, so a filtered view can be shared or bookmarked.
  useEffect(() => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ status, kind, needsReview, channel, from, to, user, reference: search.trim() })) {
      if (value) next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  }, [status, kind, needsReview, channel, from, to, user, search, setSearchParams]);

  // Whose transactions these are, by name, while the list is filtered to one user.
  const filteredUser = useUser(user, { enabled: !!user });

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle={
          query.data
            ? `${count(query.data.total)} matching. Open one to see its events, ledger lines and actions.`
            : "Every wallet movement, newest first."
        }
      />
      {user && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 py-1 pr-1 pl-3 text-sm text-primary">
            <Link to={toPath(appRoutes.USER, { id: user })} className="inline-flex items-center gap-1.5 hover:underline">
              {filteredUser.data && <UserAvatar url={filteredUser.data.avatarUrl} name={userName(filteredUser.data)} size="sm" className="size-5 text-[9px]" />}
              {filteredUser.data ? userName(filteredUser.data) : filteredUser.isError ? "Filtered to one user" : "Loading…"}
            </Link>
            <button
              type="button"
              aria-label="Show all users"
              onClick={() => table.setFilter("user", "")}
              className="flex size-5 items-center justify-center rounded-full hover:bg-primary/10"
            >
              <X className="size-3.5" />
            </button>
          </span>
        </div>
      )}
      {query.isError ? (
        <LoadFailed error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <DataTable
          getRowHref={(t) => toPath(appRoutes.TRANSACTION, { id: t.id })}
          columns={columns}
          data={query.data?.items ?? []}
          isLoading={query.isPending}
          totalPages={query.data?.totalPages ?? 1}
          totalItems={query.data?.total ?? 0}
          tableState={table}
          filterConfigs={filterConfigs}
          searchPlaceholder="Exact reference"
          serialColumn={false}
        />
      )}
    </>
  );
}
