import { useCallback, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { X } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAdminEvents, useSetEventSales, type AdminEvent, type EventSales } from "@/features/events/api";
import { ApiError } from "@/lib/http";
import { count, dateTime, naira } from "@/lib/format";
import appRoutes, { toPath } from "@/routes/appRoutes";
import { DataTable, type FilterConfig } from "@/shared/components/DataTable";
import { LoadFailed } from "@/shared/components/Metric";
import PageHeader from "@/shared/components/PageHeader";
import StatusBadge from "@/shared/components/StatusBadge";
import { useTableState } from "@/shared/hooks/useTableState";
import { Button } from "@/shared/ui/button";
import { useCan } from "@/stores";
import { useAskAction } from "@/shared/hooks/useAskAction";

const PAGE_SIZE = 25;

type Filters = { sales: EventSales | ""; owner: string };

const FILTERS: FilterConfig[] = [
  {
    type: "select",
    key: "sales",
    label: "Sales",
    options: [
      { label: "On sale", value: "on_sale" },
      { label: "Paused (anyone)", value: "paused" },
      { label: "Paused by Tasa", value: "tasa_paused" },
      { label: "Ended", value: "ended" },
    ],
  },
];

const isObjectId = (v: string | null) => (v && /^[a-f0-9]{24}$/i.test(v) ? v : "");

function SalesCell({ event }: { event: AdminEvent }) {
  if (event.sales === "ended") return <StatusBadge variant="closed" label="Ended" />;
  if (event.sales === "on_sale") return <StatusBadge variant="success" label="On sale" />;
  return (
    <div className="space-y-1">
      <StatusBadge variant={event.adminPaused ? "error" : "warning"} label="Paused" />
      <p className="text-xs text-grey-400">
        {event.adminPaused && event.salesPaused ? "By Tasa and the organiser" : event.adminPaused ? "By Tasa" : "By the organiser"}
      </p>
    </div>
  );
}

/** Every ticketed event, with what it has sold. Staff can stop sales on an event as Tasa. */
export default function EventsPage() {
  const canPause = useCan("support", "finance");
  // The organiser page links here as `?owner=<id>`; there's no picker, only a removable chip.
  const [searchParams, setSearchParams] = useSearchParams();
  const [initialOwner] = useState(() => isObjectId(searchParams.get("owner")));
  const table = useTableState<Filters>({ defaultFilters: { sales: "", owner: initialOwner }, pageSize: PAGE_SIZE });
  const confirmSales = useConfirmSales();

  const { search, sales, owner, page, pageSize } = table.queryParams;
  const query = useAdminEvents({ page, limit: pageSize, sales, ...(owner ? { owner } : {}), ...(search.trim() ? { search: search.trim() } : {}) });
  const ownerName = owner ? query.data?.items[0]?.organiser.name : undefined;

  const clearOwner = () => {
    table.setFilter("owner", "");
    setSearchParams({}, { replace: true });
  };

  const columns = useMemo<ColumnDef<AdminEvent, unknown>[]>(
    () => [
      {
        id: "event",
        header: "Event",
        cell: ({ row }) => (
          <div className="min-w-48">
            <p className="font-medium text-grey-800">{row.original.title}</p>
            <p className="text-xs text-grey-400">
              <span className="font-mono">{row.original.code}</span> · {row.original.venue}
            </p>
            <p className="text-xs text-grey-400">{dateTime(row.original.startsAt)}</p>
          </div>
        ),
      },
      {
        id: "organiser",
        header: "Organiser",
        cell: ({ row }) => (
          <div>
            <Link to={toPath(appRoutes.SELLER, { id: row.original.organiser.id })} className="text-primary hover:underline">
              {row.original.organiser.name}
            </Link>
            <p className="text-xs text-grey-400">
              {count(row.original.organiser.events)} {row.original.organiser.events === 1 ? "event" : "events"}
              {row.original.organiser.rating !== null && ` · ★ ${row.original.organiser.rating} (${count(row.original.organiser.ratings)})`}
            </p>
          </div>
        ),
      },
      { id: "sales", header: "Sales", cell: ({ row }) => <SalesCell event={row.original} /> },
      {
        id: "sold",
        header: "Sold",
        cell: ({ row }) => {
          const capacity = row.original.tiers.every((t) => t.limit !== null) ? row.original.tiers.reduce((s, t) => s + (t.limit ?? 0), 0) : null;
          return (
            <div>
              <p className="text-grey-800">
                {count(row.original.sold)}
                {capacity !== null && <span className="text-grey-400"> / {count(capacity)}</span>}
              </p>
              <p className="text-xs text-grey-400">{naira(row.original.gross)} gross</p>
            </div>
          );
        },
      },
      { id: "checkedIn", header: "Checked in", cell: ({ row }) => count(row.original.checkedIn) },
      {
        id: "action",
        header: "",
        cell: ({ row }) =>
          canPause && row.original.sales !== "ended" ? (
            <Button size="sm" variant={row.original.adminPaused ? "outline" : "destructive"} onClick={() => confirmSales(row.original)}>
              {row.original.adminPaused ? "Lift Tasa pause" : "Pause sales"}
            </Button>
          ) : null,
      },
    ],
    [canPause, confirmSales],
  );

  return (
    <>
      <PageHeader title="Events" subtitle="Every ticketed event, newest first. Money is what tickets sold for, before refunds." />
      {owner && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 py-1 pr-1 pl-3 text-sm text-primary">
            <Link to={toPath(appRoutes.SELLER, { id: owner })} className="hover:underline">
              {ownerName ? `Organised by ${ownerName}` : "Filtered to one organiser"}
            </Link>
            <button
              type="button"
              aria-label="Show every organiser"
              onClick={clearOwner}
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
          columns={columns}
          data={query.data?.items ?? []}
          isLoading={query.isPending}
          totalPages={query.data?.totalPages ?? 1}
          totalItems={query.data?.total ?? 0}
          tableState={table}
          filterConfigs={FILTERS}
          searchPlaceholder="Title, venue, organiser or exact code"
        />
      )}
    </>
  );
}

/** Tasa's pause sits on top of the organiser's: they can't lift it, and lifting it doesn't lift theirs. */
function useConfirmSales() {
  const { mutateAsync } = useSetEventSales();
  const navigate = useNavigate();
  const { ask } = useAskAction();

  // Stable, so the table's memoised columns can depend on it.
  return useCallback((event: AdminEvent) => {
    const pausing = !event.adminPaused;
    ask({
      title: pausing ? "Pause ticket sales as Tasa?" : "Lift Tasa's pause?",
      variant: pausing ? "warning" : "primary",
      confirmText: pausing ? "Pause sales" : "Lift pause",
      description: (
        <div className="space-y-2">
          <p className="font-medium text-grey-800">
            {event.title} · {event.organiser.name}
          </p>
          {pausing ? (
            <>
              <p>Nobody can buy tickets for this event until Tasa lifts the pause. Tickets already sold stay valid and check-in carries on.</p>
              <p>The organiser can pause and resume their own sales, but they can't undo a Tasa pause. Only staff can lift it here.</p>
            </>
          ) : (
            <p>
              {event.salesPaused
                ? "The organiser has also paused sales themselves, so tickets stay off sale until they resume."
                : "Tickets go back on sale straight away."}
            </p>
          )}
        </div>
      ),
      onConfirm: async () => {
        const e = await mutateAsync({ id: event.id, paused: pausing });
        return {
          message: pausing ? `Sales paused on ${e.title}` : e.salesPaused ? "Tasa pause lifted. The organiser's own pause still applies." : `${e.title} is on sale again`,
        };
      },
      onError: (err) => {
        // A suspended organiser's events only come back when the suspension is lifted: point there.
        if (err instanceof ApiError && err.code === "SELLER_SUSPENDED") {
          toast.error(err.message, {
            action: { label: "Open organiser", onClick: () => navigate(toPath(appRoutes.SELLER, { id: event.organiser.id })) },
          });
        }
      },
    });
  }, [mutateAsync, navigate, ask]);
}
