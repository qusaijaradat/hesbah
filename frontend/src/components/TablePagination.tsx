import { PAGE_SIZE_OPTIONS } from "../lib/usePagination";

/**
 * The one pagination bar every table in the app uses, so paging looks and behaves the same
 * everywhere instead of each page inventing its own السابق/التالي pair.
 *
 * Works for both kinds of list:
 *   • rows held in memory — drive it from usePagination()
 *   • rows paged by the backend (invoices, audit log) — pass the server's own page/pageSize/total
 *
 * When everything fits on one page it shows just the row count and no controls: a lone "صفحة 1 من
 * 1" with two dead buttons is noise on a five-row table.
 */
export function TablePagination({
  page, pageSize, totalCount, onPageChange, onPageSizeChange, itemLabel = "سجل",
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  /** Omit to hide the page-size picker (e.g. where the fetch size is fixed by the caller). */
  onPageSizeChange?: (pageSize: number) => void;
  /** What the rows are called, for the summary line ("42 فاتورة"). */
  itemLabel?: string;
}) {
  if (totalCount === 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const firstOnPage = (page - 1) * pageSize + 1;
  const lastOnPage = Math.min(page * pageSize, totalCount);
  const singlePage = totalPages <= 1;

  return (
    <div className="flex items-center justify-between flex-wrap gap-3 px-4 py-3 text-sm text-gray-600 border-t border-gray-200">
      <div>
        {singlePage ? (
          <span>{totalCount} {itemLabel}</span>
        ) : (
          <span>عرض {firstOnPage}–{lastOnPage} من {totalCount} {itemLabel}</span>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {onPageSizeChange && !singlePage && (
          <label className="flex items-center gap-1">
            <span className="text-gray-500">لكل صفحة:</span>
            <select
              className="input py-1 w-auto"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
            >
              {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
        )}
        {!singlePage && (
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary text-sm py-1" disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}>السابق</button>
            <span className="text-gray-500">صفحة {page} من {totalPages}</span>
            <button type="button" className="btn-secondary text-sm py-1" disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}>التالي</button>
          </div>
        )}
      </div>
    </div>
  );
}
