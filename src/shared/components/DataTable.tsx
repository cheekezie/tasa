import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Search } from "lucide-react";
import type { DateRange } from "react-day-picker";
import DateRangePicker from "@/shared/components/DateRangePicker";
import { dateToIso, parseISODate } from "@/lib/date";
import { cn } from "@/lib/utils";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { PopoverContent, Popover, PopoverTrigger } from "@/shared/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import {
  DEFAULT_FORMATS,
  EXPORT_FORMAT_LABELS,
  type ExportFormat,
} from "@/shared/hooks/useTableExport";
import { LoadingModal } from "@/shared/components/LoadingModal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import type { TableState } from "@/shared/hooks/useTableState";

// ─── Filter config types ──────────────────────────────────────────────────────

export type SelectFilterConfig = {
  type: "select";
  key: string;
  label: string;
  options: { label: string; value: string }[];
  /** Render a search box inside the dropdown (for long option lists). */
  searchable?: boolean;
};

export type DateRangeFilterConfig = {
  type: "daterange";
  label: string;
  fromKey: string;
  toKey: string;
};

export type FilterConfig = SelectFilterConfig | DateRangeFilterConfig;

// Internal alias — filter sub-components don't need the TFilters generic
type AnyState = TableState<Record<string, unknown>>;
const loosen = <T extends Record<string, unknown>>(s: TableState<T>): AnyState =>
  s as unknown as AnyState;

// ─── Select filter ────────────────────────────────────────────────────────────

function FilterSelect({
  config,
  state,
}: {
  config: SelectFilterConfig;
  state: AnyState;
}) {
  const current = state.filters[config.key] as string;
  const active = config.options.find((o) => o.value === current);
  const triggerLabel = active ? active.label : config.label;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const labelRef = useRef<HTMLSpanElement>(null);
  // Only enable the tooltip when the label is actually clipped by the trigger.
  const [truncated, setTruncated] = useState(false);

  const filtered = config.searchable
    ? config.options.filter((o) =>
        o.label.toLowerCase().includes(query.trim().toLowerCase())
      )
    : config.options;

  function select(value: string) {
    state.setFilter(config.key, value);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip {...(truncated ? {} : { open: false })}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              // size="sm"
              className={cn(
                "max-w-[180px] gap-2 border-grey-100 text-sm text-grey-300",
                active && "border-primary/40 bg-primary/5 text-primary"
              )}
              onPointerEnter={() => {
                const el = labelRef.current;
                if (el) setTruncated(el.scrollWidth > el.clientWidth);
              }}
            >
              <span ref={labelRef} className="min-w-0 truncate text-sm">
                {triggerLabel}
              </span>
              <ChevronDown className="size-5 shrink-0 opacity-60" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{triggerLabel}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="block w-72 space-y-1 p-1">
        {config.searchable && (
          <Input
            className="mb-1"
            placeholder="Search…"
            leftSlot={<Search size={15} />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
        <div className="max-h-64 space-y-1 overflow-y-auto">
          <button
            className={cn(
              "w-full rounded-md px-3 py-3 text-left text-sm transition-colors hover:bg-grey-25",
              !current && "font-medium text-primary"
            )}
            onClick={() => select("")}
          >
            All
          </button>
          {filtered.map((opt) => (
            <button
              key={opt.value}
              className={cn(
                "w-full truncate rounded-md px-3 py-3 text-left text-sm transition-colors hover:bg-grey-25",
                current === opt.value && "bg-primary/5 font-medium text-primary"
              )}
              onClick={() => select(opt.value)}
            >
              {opt.label}
            </button>
          ))}
          {config.searchable && filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-grey-300">
              No matches found.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Date range filter ────────────────────────────────────────────────────────

function FilterDateRange({
  config,
  state,
}: {
  config: DateRangeFilterConfig;
  state: AnyState;
}) {
  const from = (state.filters[config.fromKey] as string) ?? "";
  const to = (state.filters[config.toKey] as string) ?? "";

  const value: DateRange | undefined =
    from || to ? { from: parseISODate(from), to: parseISODate(to) } : undefined;

  function handleChange(range: DateRange | undefined) {
    state.setFilter(config.fromKey, range?.from ? dateToIso(range.from) : "");
    state.setFilter(config.toKey, range?.to ? dateToIso(range.to) : "");
  }

  function handleReset() {
    state.setFilter(config.fromKey, "");
    state.setFilter(config.toKey, "");
  }

  return (
    <DateRangePicker
      value={value}
      onRangeChange={handleChange}
      onClear={handleReset}
    />
  );
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function Toolbar<TFilters extends Record<string, unknown>>({
  state,
  filterConfigs,
  onExport,
  isExporting,
  exportFormats,
  searchPlaceholder,
  showSearch = true,
}: {
  state: TableState<TFilters>;
  filterConfigs?: FilterConfig[] | undefined;
  onExport?: ((format: ExportFormat) => void) | undefined;
  isExporting?: boolean | undefined;
  exportFormats?: ExportFormat[] | undefined;
  searchPlaceholder?: string | undefined;
  showSearch?: boolean;
}) {
  const anyState = loosen(state);

  const hasContent = showSearch || onExport || (filterConfigs && filterConfigs.length > 0);
  if (!hasContent) return null;

  return (
    <div className="flex flex-col gap-3 border-b border-grey-50 bg-white px-4 py-3 md:flex-row md:items-center md:justify-between">
      {showSearch && (
        <Input
          className="w-full md:w-65"
          placeholder={searchPlaceholder ?? "Search"}
          leftSlot={<Search size={15} />}
          value={state.searchInput}
          onChange={(e) => state.setSearchInput(e.target.value)}
        />
      )}
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 md:flex-wrap md:overflow-visible md:pb-0">
        {filterConfigs?.map((config, i) =>
          config.type === "select" ? (
            <FilterSelect key={i} config={config} state={anyState} />
          ) : (
            <FilterDateRange key={i} config={config} state={anyState} />
          )
        )}
        {onExport && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                disabled={isExporting}
                // size={"sm"}
                className="shrink-0 text-grey-600 gap-1.5 border-grey-100"
              >
                <div className="text-sm">Export Data</div>
                <ChevronDown className="size-4 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(exportFormats ?? DEFAULT_FORMATS).map((format) => (
                <DropdownMenuItem key={format} onClick={() => onExport(format)}>
                  Export as {EXPORT_FORMAT_LABELS[format]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function Pagination({
  page,
  totalPages,
  total,
  setPage,
}: {
  page: number;
  total: number;
  totalPages: number;
  setPage: (p: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-[#D9D9D9] bg-white px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-body text-grey-400">
        Page {page} of {totalPages} - {total} total {total > 1 ? "records" : "record"}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="text-grey-600 border-grey-100"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-grey-600 border-grey-100"
          disabled={page >= totalPages}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

// ─── Skeleton rows ────────────────────────────────────────────────────────────

function SkeletonRows({ cols, rows = 6 }: { cols: number; rows?: number | undefined }) {
  return Array.from({ length: rows }).map((_, i) => (
    <TableRow key={i}>
      {Array.from({ length: cols }).map((__, j) => (
        <TableCell key={j}>
          <div
            className="h-4 animate-pulse rounded bg-grey-50"
            style={{ width: `${60 + ((i + j) % 3) * 12}%` }}
          />
        </TableCell>
      ))}
    </TableRow>
  ));
}

// ─── DataTable ────────────────────────────────────────────────────────────────

export interface DataTableProps<TData, TFilters extends Record<string, unknown>> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  isLoading?: boolean;
  /** Total page count returned by your API */
  totalPages?: number;
  totalItems?: number;
  tableState: TableState<TFilters>;
  filterConfigs?: FilterConfig[];
  /** Called with the chosen format when the user triggers an export. */
  onExport?: (format: ExportFormat) => void;
  /** Disables the export trigger and shows the exporting modal while in flight. */
  isExporting?: boolean;
  /** Format options for the export menu. Defaults to CSV + XLSX. */
  exportFormats?: ExportFormat[];
  searchPlaceholder?: string;
  skeletonRows?: number;
  serialColumn?: boolean;
  showSearch?: boolean;
  className?: string;
  /** Makes each row open this page on click or Enter. Links and buttons inside a row still do their own thing. */
  getRowHref?: (row: TData) => string | null | undefined;
}

export function DataTable<TData, TFilters extends Record<string, unknown>>({
  columns,
  data,
  isLoading,
  totalPages = 1,
  totalItems = 0,
  tableState,
  filterConfigs,
  onExport,
  isExporting,
  exportFormats,
  searchPlaceholder,
  skeletonRows,
  serialColumn = true,
  showSearch,
  className,
  getRowHref,
}: DataTableProps<TData, TFilters>) {
  const navigate = useNavigate();
  // A click on something interactive inside the row is that thing's, not the row's.
  const ownClick = (target: EventTarget) => target instanceof Element && !!target.closest("a, button, input, select, textarea, [role='menuitem']");
  const openRow = (href: string, e: MouseEvent | KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey) window.open(href, "_blank");
    else navigate(href);
  };
  // Add a serial column to the columns array
  const serialColumns: ColumnDef<TData, unknown>[] = [
    {
      id: "serial",
      header: "S/N",
      cell: ({ row }) => (
        <span className="text-grey-400">
          {(tableState.page - 1) * tableState.pageSize + row.index + 1}
        </span>
      ),
    },
    ...columns,
  ];

  const table = useReactTable({
    data,
    columns: serialColumn ? serialColumns : columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className={`overflow-x-auto rounded-xl border border-grey-50 ${className}`}>
      <Toolbar
        state={tableState}
        filterConfigs={filterConfigs}
        onExport={onExport}
        isExporting={isExporting}
        exportFormats={exportFormats}
        searchPlaceholder={searchPlaceholder}
        showSearch={showSearch ?? true}
      />

      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>

        <TableBody>
          {isLoading ? (
            <SkeletonRows cols={columns.length} rows={skeletonRows} />
          ) : table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => {
              const href = getRowHref?.(row.original) ?? null;
              return (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() ? "selected" : undefined}
                {...(href && {
                  "data-clickable": "true",
                  tabIndex: 0,
                  role: "link",
                  className: "hover:bg-grey-25 focus-visible:bg-grey-25 focus-visible:outline-none",
                  onClick: (e: MouseEvent) => !ownClick(e.target) && openRow(href, e),
                  onKeyDown: (e: KeyboardEvent) => e.key === "Enter" && !ownClick(e.target) && openRow(href, e),
                })}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
              );
            })
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-32 text-center text-grey-400"
              >
                No results found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Pagination
        page={tableState.page}
        total={totalItems}
        totalPages={totalPages}
        setPage={tableState.setPage}
      />

      <LoadingModal
        open={!!isExporting}
        title="Exporting data"
        description="Preparing your file, please wait…"
      />
    </div>
  );
}
