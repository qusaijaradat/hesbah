import { derivedOptions } from "../lib/columnFilters";
import type { ColumnFilterSpec } from "../lib/columnFilters";
import type { useColumnFilters } from "../lib/useColumnFilters";

interface Props<T> {
  /**
   * One entry per column of the table, in the same order as the <th> cells — a filter key, or
   * null for a column that is not filtered (the checkbox column, the actions column).
   *
   * Explicit rather than inferred: a table whose leading checkbox appears only for users who may
   * delete has a different number of columns per user, and a filter row that guessed would land
   * every input one cell to the side for everyone else.
   */
  columns: (string | null)[];
  specs: ColumnFilterSpec<T>[];
  filters: ReturnType<typeof useColumnFilters<T>>;
  /** The unfiltered rows — `select` columns collect their options from these. */
  rows: T[];
}

/**
 * The filter row that sits under a table's header: one input per filtered column, right where the
 * column is, so there is nothing to read to work out what a box applies to.
 *
 * Belongs inside <thead>, immediately after the header <tr>.
 */
export function ColumnFilterRow<T>({ columns, specs, filters, rows }: Props<T>) {
  const byKey = new Map(specs.map((s) => [s.key, s]));

  return (
    <tr className="bg-gray-50">
      {columns.map((key, i) => {
        const spec = key ? byKey.get(key) : undefined;
        if (!spec) return <th key={i} className="p-1"></th>;

        const value = filters.state[spec.key] ?? { a: "", b: "" };
        const small = "input text-xs py-1 px-2 font-normal";

        return (
          <th key={i} className="p-1 font-normal">
            {spec.kind === "text" && (
              <input
                className={small}
                placeholder={spec.placeholder ?? "بحث..."}
                value={value.a}
                onChange={(e) => filters.setFilter(spec.key, e.target.value)}
              />
            )}

            {spec.kind === "select" && (
              <select
                className={small}
                value={value.a}
                onChange={(e) => filters.setFilter(spec.key, e.target.value)}
              >
                <option value="">الكل</option>
                {derivedOptions(rows, spec).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            )}

            {spec.kind === "boolean" && (
              <select
                className={small}
                value={value.a}
                onChange={(e) => filters.setFilter(spec.key, e.target.value)}
              >
                <option value="">الكل</option>
                <option value="yes">نعم</option>
                <option value="no">لا</option>
              </select>
            )}

            {/* Two boxes, one column: a range is one question ("between what and what"), and
                splitting it across two table columns would tie it to a neighbour it has nothing
                to do with. */}
            {spec.kind === "numberRange" && (
              <div className="flex gap-1">
                <input
                  className={small} type="number" placeholder="من"
                  value={value.a}
                  onChange={(e) => filters.setFilter(spec.key, e.target.value, value.b)}
                />
                <input
                  className={small} type="number" placeholder="إلى"
                  value={value.b ?? ""}
                  onChange={(e) => filters.setFilter(spec.key, value.a, e.target.value)}
                />
              </div>
            )}

            {spec.kind === "dateRange" && (
              <div className="flex gap-1">
                <input
                  className={small} type="date"
                  value={value.a}
                  onChange={(e) => filters.setFilter(spec.key, e.target.value, value.b)}
                />
                <input
                  className={small} type="date"
                  value={value.b ?? ""}
                  onChange={(e) => filters.setFilter(spec.key, value.a, e.target.value)}
                />
              </div>
            )}
          </th>
        );
      })}
    </tr>
  );
}

/**
 * "٧ من ٤٠٠ — مسح الفلاتر". Shown only while something is filtered, because a table that is
 * showing everything has nothing to say about it, and a permanently visible "clear" button
 * invites the reader to wonder what is hidden.
 */
export function ColumnFilterSummary<T>({ filters }: { filters: ReturnType<typeof useColumnFilters<T>> }) {
  if (filters.activeCount === 0) return null;
  return (
    <div className="flex items-center gap-3 mb-3 text-sm">
      <span className="text-gray-600">
        ظاهر <span className="font-semibold text-gray-900">{filters.rows.length}</span> من {filters.totalCount}
      </span>
      <button className="btn-link text-brand-700 hover:underline" onClick={filters.clear}>
        مسح الفلاتر ({filters.activeCount})
      </button>
    </div>
  );
}
