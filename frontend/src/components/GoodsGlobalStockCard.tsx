import { formatQuantity } from "../lib/format";
import type { GoodsStockRow } from "../types";

/**
 * "البضاعة المتوفرة حاليًا" summed across ALL farmers — one row per item+unit (الوارد/المباع/
 * المتوفر), same received-minus-sold logic as the per-farmer stock table on "بضاعة الباعة", but
 * pooling every farmer together. Shown at the end of both "بضاعة الباعة" (via api/goods.ts's
 * getGoodsGlobalStock) and "الإغلاق اليومي" (via api/reports.ts's getGoodsGlobalStockForReports) —
 * same GoodsService.GetGlobalStockAsync data, reached through each page's own permission. Always a
 * live all-time running total, never scoped to any date filter the page around it might have.
 */
export function GoodsGlobalStockCard({
  rows, loading, error,
}: {
  rows: GoodsStockRow[];
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="card overflow-x-auto mt-4 mb-4">
      <div className="px-4 pt-4 pb-1 text-sm font-semibold text-gray-700">البضاعة المتوفرة حاليًا — كل الباعة</div>
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2 mx-4">{error}</div>}
      <table className="table-base">
        <thead>
          <tr><th>الصنف</th><th>الوحدة</th><th>الوارد</th><th>المباع</th><th>المتوفر</th><th>صناديق خشب</th></tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={6} className="text-center text-gray-400 py-6">جاري التحميل...</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={6} className="text-center text-gray-400 py-6">لا توجد بضاعة مسجلة بعد</td></tr>
          ) : (
            rows.map((r, idx) => (
              <tr key={idx}>
                <td className="font-medium">{r.itemName}</td>
                <td>{r.unit === "Kg" ? "كيلو" : "صندوق"}</td>
                <td>{formatQuantity(r.totalReceived, r.unit)}</td>
                <td>{formatQuantity(r.totalSold, r.unit)}</td>
                <td className={`font-semibold ${r.available < 0 ? "text-red-600" : ""}`}>{formatQuantity(r.available, r.unit)}</td>
                <td>{r.woodReceived > 0 ? formatQuantity(r.woodReceived, "Box") : "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
