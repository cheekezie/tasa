import { useMemo, useState } from 'react';
import { useDebounce } from './useDebounce';
import { DEFAULT_PAGE_SIZE } from '@/lib/table';

// ─── Public types ─────────────────────────────────────────────────────────────

export type TableQueryParams<TFilters> = {
  search: string;
  page: number;
  pageSize: number;
} & TFilters;

export interface TableState<TFilters extends Record<string, unknown>> {
  // Search (searchInput = live value for the input, search inside queryParams = debounced)
  searchInput: string;
  setSearchInput: (value: string) => void;

  // Filters
  filters: TFilters;
  setFilter: <K extends keyof TFilters>(key: K, value: TFilters[K]) => void;
  resetFilters: () => void;

  // Pagination
  page: number;
  setPage: (page: number) => void;
  pageSize: number;

  // Drop this straight into useQuery's queryKey + queryFn args
  queryParams: TableQueryParams<TFilters>;
}

interface UseTableStateOptions<TFilters> {
  defaultFilters: TFilters;
  pageSize?: number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTableState<TFilters extends Record<string, unknown>>(
  options: UseTableStateOptions<TFilters>
): TableState<TFilters> {
  const { defaultFilters, pageSize = DEFAULT_PAGE_SIZE } = options;

  const [searchInput, setSearchRaw] = useState('');
  const [filters, setFilters] = useState<TFilters>(defaultFilters);
  const [page, setPageRaw] = useState(1);

  const debouncedSearch = useDebounce(searchInput, 300);

  // Reset to page 1 on any change that affects results
  const setSearchInput = (value: string) => {
    setSearchRaw(value);
    setPageRaw(1);
  };

  const setFilter = <K extends keyof TFilters>(key: K, value: TFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPageRaw(1);
  };

  const resetFilters = () => {
    setFilters(defaultFilters);
    setSearchRaw('');
    setPageRaw(1);
  };

  const queryParams = useMemo<TableQueryParams<TFilters>>(
    () => ({ search: debouncedSearch, page, pageSize, ...filters }),
    [debouncedSearch, page, pageSize, filters]
  );

  return {
    searchInput,
    setSearchInput,
    filters,
    setFilter,
    resetFilters,
    page,
    setPage: setPageRaw,
    pageSize,
    queryParams,
  };
}
