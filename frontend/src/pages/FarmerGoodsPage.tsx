import { useState } from "react";
import { getFarmerGoods } from "../api/invoices";
import { apiErrorMessage } from "../api/client";
import { PartnerAutocomplete } from "../components/PartnerAutocomplete";
import { formatDate, formatQuantity } from "../lib/format";
import type { FarmerGoodsRow } from "../types";

/// <summary>
/// Standalone "بضاعة الباعة" page (its own nav entry, separate from the financial "كشف حساب بائع"
/// page): pick a farmer, optionally narrow to a date range, and see exactly what he brought and
/// when — grouped by day + item, with WoodQuantity as its OWN column (not a yes/no flag) showing
/// how much of that day's quantity for that item came in wood crates, out of the total quantity
/// (see backend InvoiceService.GetFarmerGoodsAsync / FarmerGoodsRow's doc comment). Leaving both
/// dates blank shows the farmer's entire history at once.
/// </summary>
export function FarmerGoodsPage() {
  const [farmerPick, setFarmerPick] = useState<{ id: number; name: string } | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [farmerName, setFarmerName] = useState<string | null>(null);
  const [rows, setRows] = useState<FarmerGoodsRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  function startOfDay(d: Date) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function endOfDay(d: Date) {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  }

  async function handleSearch() {
    if (!farmerPick) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const from = dateFrom ? startOfDay(new Date(dateFrom)).toISOString() : undefined;
      const to = dateTo ? endOfDay(new Date(dateTo)).toISOString() : undefined;
      const result = await getFarmerGoods(farmerPick.id, from, to);
      setFarmerName(result.farmerName);
      setRows(result.rows);
    } catch (err) {
      setError(apiErrorMessage(err, "فشل تحميل بضاعة البائع"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  // Boxes and kilograms don't add up into one number — this footer is specifically "كم صندوق
  // خشب إجمالًا؟", so it only sums the Box-unit rows' WoodQuantity, same as the request's wording.
  const totalWoodBoxes = rows.filter((r) => r.unit === "Box").reduce((sum, r) => sum + r.woodQuantity, 0);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">بضاعة الباعة</h1>

      <div className="card p-4 mb-4 space-y-3">
        <p className="text-xs text-gray-500">اختر البائع — الفترة اختيارية، اتركها فارغة لعرض كل سجل البائع.</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full max-w-xs">
            <PartnerAutocomplete
              label="البائع" value={farmerPick} onChange={setFarmerPick}
              placeholder="اكتب اسم البائع واختره من القائمة..."
              types={["Farmer", "Both"]}
            />
          </div>
          <div>
            <label className="label">من تاريخ (اختياري)</label>
            <input type="date" className="input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">إلى تاريخ (اختياري)</label>
            <input type="date" className="input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <button className="btn-primary" disabled={!farmerPick || loading} onClick={handleSearch}>
            {loading ? "جاري البحث..." : "🔍 عرض"}
          </button>
        </div>
        {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2">{error}</div>}
      </div>

      {searched && !loading && (
        <div className="card overflow-x-auto">
          {farmerName && <div className="px-4 pt-4 pb-1 text-sm font-semibold text-gray-700">البائع: {farmerName}</div>}
          <table className="table-base">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>الصنف</th>
                <th>الكمية</th>
                <th>منها صندوق خشب</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={4} className="text-center text-gray-400 py-6">لا توجد بضاعة مسجلة لهذا البائع ضمن الفترة المحددة</td></tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={idx}>
                    <td>{formatDate(r.date)}</td>
                    <td>{r.itemName}</td>
                    <td className="font-medium">{formatQuantity(r.totalQuantity, r.unit)}</td>
                    <td>{r.woodQuantity > 0 ? formatQuantity(r.woodQuantity, r.unit) : "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="font-semibold border-t">
                  <td colSpan={3} className="text-gray-500">إجمالي صناديق الخشب</td>
                  <td>{totalWoodBoxes > 0 ? formatQuantity(totalWoodBoxes, "Box") : "—"}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
