import { formatCount, formatWeight } from "../lib/format";
import { usePagination } from "../lib/usePagination";
import { TablePagination } from "./TablePagination";
import type { GoodsStockRow } from "../types";
import { PartnerLink } from "./RecordLinks";

/**
 * "البضاعة المتوفرة حاليًا" across ALL farmers — one row per (farmer, item, unit): الوارد/المباع/
 * المتوفر computed per farmer, same received-minus-sold logic as the per-farmer stock table on
 * "بضاعة الباعة", but listing every farmer's own rows side by side (never summed together) with a
 * "البائع" column so it's clear whose stock each row is. Shown at the end of both "بضاعة الباعة"
 * (via api/goods.ts's getGoodsGlobalStock) and "الإغلاق اليومي" (via api/reports.ts's
 * getGoodsGlobalStockForReports) — same GoodsService.GetGlobalStockAsync data, reached through each
 * page's own permission. Always a live all-time running total, never scoped to any date filter the
 * page around it might have, and never tied to picking any one person.
 *
 * Only stock that's actually still there is listed — a (farmer, item) sold down to zero is dropped
 * from the result entirely, server-side. A NEGATIVE "المتوفر" is kept and shown in red: it means
 * more was sold than was ever logged as received, i.e. a missing "إضافة بضاعة" entry to go fix.
 */
export function GoodsGlobalStockCard({
  rows, loading, error,
}: {
  rows: GoodsStockRow[];
  loading: boolean;
  error: string | null;
}) {
  const pager = usePagination(rows);
  return (
    <div className="card overflow-x-auto mt-4 mb-4">
      <div className="px-4 pt-4 pb-1 text-sm font-semibold text-gray-700">البضاعة المتوفرة حاليًا — كل الباعة</div>
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2 mx-4">{error}</div>}
      <table className="table-base">
        <thead>
          <tr><th>البائع</th><th>الصنف</th><th>الوارد (عدد)</th><th>المباع (عدد)</th><th>المتوفر (عدد)</th><th>المتوفر (وزن)</th><th>صناديق خشب</th><th>مخالات</th></tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={7} className="text-center text-gray-400 py-6">جاري التحميل...</td></tr>
          ) : rows.length === 0 ? (
            // Sold-out rows are dropped server-side (see GoodsService.GetGlobalStockAsync), so an
            // empty table here means "nothing left in stock", not "nothing was ever recorded".
            <tr><td colSpan={7} className="text-center text-gray-400 py-6">لا توجد بضاعة متوفرة حاليًا</td></tr>
          ) : (
            pager.pageRows.map((r, idx) => (
              <tr key={idx}>
                {/* farmerId is populated only on this global "كل الباعة" view (see
                    GoodsStockRow) — exactly the view where "whose stock is this?" is worth
                    one click. */}
                <td className="font-medium">
                  <PartnerLink partnerId={r.farmerId} name={r.farmerName} side="seller" />
                </td>
                <td>{r.itemName}</td>
                <td>{formatCount(r.totalReceived)}</td>
                <td>{formatCount(r.totalSold)}</td>
                <td className={`font-semibold ${r.available < 0 ? "text-red-600" : ""}`}>{formatCount(r.available)}</td>
                <td className={`font-semibold ${r.weightAvailable < 0 ? "text-red-600" : ""}`}>{formatWeight(r.weightAvailable)}</td>
                <td>{r.woodReceived > 0 ? formatCount(r.woodReceived) : "—"}</td>
                <td>{r.sackReceived > 0 ? r.sackReceived.toLocaleString("en-US") : "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <TablePagination
        page={pager.page} pageSize={pager.pageSize} totalCount={pager.totalCount}
        itemLabel="سطر" onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize}
      />
    </div>
  );
}
