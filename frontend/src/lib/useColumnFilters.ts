import { useMemo, useState } from "react";
import { activeFilterCount, applyColumnFilters } from "./columnFilters";
import type { ColumnFilterSpec, ColumnFilterState } from "./columnFilters";

/**
 * The React half of per-column table filtering — state, and the filtered rows. All the matching
 * lives in lib/columnFilters, which has no React in it and is covered by its own harness.
 *
 * Pass the FULL row list, then paginate the result:
 *
 *   const filters = useColumnFilters(partners, PARTNER_FILTERS);
 *   const pager = usePagination(filters.rows);
 *
 * That order matters. Paginating first and filtering the page would filter 25 rows out of 400 and
 * report the answer as though it were the whole table — the same lie this feature exists to avoid.
 */
export function useColumnFilters<T>(rows: T[], specs: ColumnFilterSpec<T>[]) {
  const [state, setState] = useState<ColumnFilterState>({});

  function setFilter(key: string, a: string, b?: string) {
    setState((prev) => ({ ...prev, [key]: { a, b } }));
  }

  function clear() {
    setState({});
  }

  const filtered = useMemo(() => applyColumnFilters(rows, specs, state), [rows, specs, state]);

  return {
    /** What the inputs are bound to. */
    state,
    setFilter,
    clear,
    /** The rows to render — hand these to usePagination, not the originals. */
    rows: filtered,
    activeCount: activeFilterCount(state),
    /** For "٧ من ٤٠٠" next to the clear button, so a narrowed table says so out loud. */
    totalCount: rows.length,
  };
}
