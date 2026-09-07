import { useState } from "react";

/**
 * Client-side paging for a table whose rows are already in memory (explicit request: "بدي تضفلي
 * pagination على كل جداول لأنه البيانات اللي رح تدخل يومي كثار مش قليل"). A market's tables grow
 * every single day, and rendering a whole year of rows at once is both unreadable and slow.
 *
 * Pairs with <TablePagination> for the controls. For a list that's paged by the SERVER instead
 * (invoices, the audit log — where the backend already takes page/pageSize), use that component
 * directly with the server's own state; this hook is only for lists fetched whole.
 *
 * `page` is clamped on read rather than corrected in an effect, so shrinking the list — a filter,
 * a search, a delete — can never strand you on a page that no longer exists, and it does it
 * without an extra render pass.
 */
export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

export function usePagination<T>(rows: T[], initialPageSize = 25) {
  const [requestedPage, setRequestedPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const totalCount = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);

  function changePageSize(next: number) {
    setPageSize(next);
    // Jumping to a bigger page size from deep in the list would otherwise land somewhere
    // unrelated — going back to the top is the predictable behavior.
    setRequestedPage(1);
  }

  return { page, pageSize, totalCount, pageRows, setPage: setRequestedPage, setPageSize: changePageSize };
}
