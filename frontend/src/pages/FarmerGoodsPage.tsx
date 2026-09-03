import { useEffect, useState } from "react";
import { getFarmerGoods } from "../api/invoices";
import { createGoodsEntry, deleteGoodsEntry, getFarmerGoodsStock, getGoodsGlobalStock, updateGoodsEntry } from "../api/goods";
import { apiErrorMessage } from "../api/client";
import { PartnerAutocomplete } from "../components/PartnerAutocomplete";
import { ItemAutocomplete } from "../components/ItemAutocomplete";
import { GoodsGlobalStockCard } from "../components/GoodsGlobalStockCard";
import { formatDate, formatQuantity, todayLocalDateString } from "../lib/format";
import { useAuth } from "../auth/AuthContext";
import type { FarmerGoodsRow, FarmerGoodsStockDto, GoodsEntryDto, GoodsStockRow, UnitOfMeasure } from "../types";

const UNIT_OPTIONS: { value: UnitOfMeasure; label: string }[] = [
  { value: "Kg", label: "كيلو" },
  { value: "Box", label: "صندوق" },
];

/// <summary>
/// Standalone "بضاعة الباعة" page: pick a farmer, then
///   1) log what he brings in as it arrives ("إضافة بضاعة") — before any of it is sold,
///   2) see what's still available right now per item (المخزون المتوفر حاليًا) — computed live as
///      received-minus-sold (see backend GoodsService/FarmerGoodsEntry's doc comment: never a
///      stored running balance, and never blocks a sale even if it goes negative),
///   3) review/correct the raw intake log (سجل الإضافات),
///   4) and — unchanged from before — what he's actually SOLD, grouped by day + item, over an
///      optional date range (see backend InvoiceService.GetFarmerGoodsAsync / FarmerGoodsRow's doc
///      comment). Leaving both dates blank shows the farmer's entire sales history at once.
/// </summary>
export function FarmerGoodsPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("farmerGoods.create");
  const canEdit = hasPermission("farmerGoods.edit");
  const canDelete = hasPermission("farmerGoods.delete");

  const [farmerPick, setFarmerPick] = useState<{ id: number; name: string } | null>(null);

  // "البضاعة المتوفرة حاليًا — كل الباعة": a global summary across every farmer, independent of
  // whichever single farmer is picked above — loads once on mount, shown at the end of the page.
  const [globalStock, setGlobalStock] = useState<GoodsStockRow[]>([]);
  const [globalStockLoading, setGlobalStockLoading] = useState(true);
  const [globalStockError, setGlobalStockError] = useState<string | null>(null);

  useEffect(() => {
    getGoodsGlobalStock()
      .then((rows) => setGlobalStock(rows))
      .catch((err) => setGlobalStockError(apiErrorMessage(err, "فشل تحميل البضاعة المتوفرة")))
      .finally(() => setGlobalStockLoading(false));
  }, []);

  // Stock (intake entries + computed available-per-item) — loads automatically as soon as a
  // farmer is picked, independent of the sales-history date filter below.
  const [stockData, setStockData] = useState<FarmerGoodsStockDto | null>(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);

  // "إضافة بضاعة" form.
  const [entryDate, setEntryDate] = useState(() => todayLocalDateString());
  const [entryItem, setEntryItem] = useState("");
  const [entryUnit, setEntryUnit] = useState<UnitOfMeasure>("Kg");
  const [entryQuantity, setEntryQuantity] = useState("");
  const [entryWoodQuantity, setEntryWoodQuantity] = useState("");
  const [entryNotes, setEntryNotes] = useState("");
  const [savingEntry, setSavingEntry] = useState(false);
  const [entryError, setEntryError] = useState<string | null>(null);

  const [editingEntry, setEditingEntry] = useState<GoodsEntryDto | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Sales-history report (unchanged from before).
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

  async function refreshStock(farmerId: number) {
    setStockLoading(true);
    setStockError(null);
    try {
      setStockData(await getFarmerGoodsStock(farmerId));
    } catch (err) {
      setStockError(apiErrorMessage(err, "فشل تحميل بضاعة البائع"));
      setStockData(null);
    } finally {
      setStockLoading(false);
    }
  }

  useEffect(() => {
    if (farmerPick) refreshStock(farmerPick.id);
    else setStockData(null);
    // Reset the "add goods"/sales-history state when the farmer changes.
    setSearched(false);
    setRows([]);
    setFarmerName(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmerPick?.id]);

  function resetEntryForm() {
    setEntryDate(todayLocalDateString());
    setEntryItem("");
    setEntryUnit("Kg");
    setEntryQuantity("");
    setEntryWoodQuantity("");
    setEntryNotes("");
    setEditingEntry(null);
    setEntryError(null);
  }

  function startEdit(entry: GoodsEntryDto) {
    setEditingEntry(entry);
    setEntryDate(entry.date.slice(0, 10));
    setEntryItem(entry.itemName);
    setEntryUnit(entry.unit);
    setEntryQuantity(String(entry.quantity));
    setEntryWoodQuantity(entry.woodQuantity > 0 ? String(entry.woodQuantity) : "");
    setEntryNotes(entry.notes ?? "");
    setEntryError(null);
  }

  async function handleSaveEntry() {
    if (!farmerPick) return;
    const quantity = Number(entryQuantity);
    const woodQuantity = entryWoodQuantity ? Number(entryWoodQuantity) : 0;
    if (!entryItem.trim() || !quantity || quantity <= 0) {
      setEntryError("الصنف والكمية مطلوبان");
      return;
    }
    setSavingEntry(true);
    setEntryError(null);
    try {
      const payload = {
        date: new Date(entryDate).toISOString(),
        itemName: entryItem.trim(),
        unit: entryUnit,
        quantity,
        woodQuantity,
        notes: entryNotes.trim() || null,
      };
      if (editingEntry) {
        await updateGoodsEntry(editingEntry.id, payload);
      } else {
        await createGoodsEntry({ farmerId: farmerPick.id, ...payload });
      }
      resetEntryForm();
      await refreshStock(farmerPick.id);
    } catch (err) {
      setEntryError(apiErrorMessage(err, "فشل حفظ البضاعة"));
    } finally {
      setSavingEntry(false);
    }
  }

  async function handleDeleteEntry(entry: GoodsEntryDto) {
    if (!farmerPick) return;
    if (!window.confirm(`حذف "${entry.itemName}" (${formatQuantity(entry.quantity, entry.unit)}) بتاريخ ${formatDate(entry.date)}؟`)) return;
    setDeletingId(entry.id);
    setStockError(null);
    try {
      await deleteGoodsEntry(entry.id);
      if (editingEntry?.id === entry.id) resetEntryForm();
      await refreshStock(farmerPick.id);
    } catch (err) {
      setStockError(apiErrorMessage(err, "فشل حذف البضاعة"));
    } finally {
      setDeletingId(null);
    }
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
        <div className="w-full max-w-xs">
          <PartnerAutocomplete
            label="البائع" value={farmerPick} onChange={setFarmerPick}
            placeholder="اكتب اسم البائع واختره من القائمة..."
            types={["Farmer", "Both"]}
          />
        </div>
      </div>

      {farmerPick && (
        <>
          {canCreate && (
            <div className="card p-4 mb-4 space-y-3">
              <h2 className="font-semibold text-gray-700">{editingEntry ? "تعديل بضاعة" : "إضافة بضاعة"}</h2>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="label">التاريخ</label>
                  <input type="date" className="input" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
                </div>
                <div className="w-full max-w-xs">
                  <label className="label">الصنف</label>
                  <ItemAutocomplete value={entryItem} onChange={setEntryItem} placeholder="اسم الصنف..." />
                </div>
                <div>
                  <label className="label">الوحدة</label>
                  <select className="input" value={entryUnit} onChange={(e) => setEntryUnit(e.target.value as UnitOfMeasure)}>
                    {UNIT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{entryUnit === "Kg" ? "الوزن (كغم)" : "عدد الصناديق"}</label>
                  <input type="number" step="0.001" min="0" className="input w-32" value={entryQuantity} onChange={(e) => setEntryQuantity(e.target.value)} />
                </div>
                <div>
                  {/* فيلد مستقل عن "العدد"/"الوزن" أعلاه — عدد صناديق الخشب الفعلي المستخدم بنقل
                      هالبضاعة، مش جزء أو نسبة من الكمية (ممكن ٥٠ كغم بس ٣ صناديق خشب). */}
                  <label className="label">صناديق خشب (اختياري)</label>
                  <input type="number" step="1" min="0" className="input w-32" value={entryWoodQuantity} onChange={(e) => setEntryWoodQuantity(e.target.value)} placeholder="0" />
                </div>
                <div className="w-full max-w-xs">
                  <label className="label">ملاحظات (اختياري)</label>
                  <input className="input" value={entryNotes} onChange={(e) => setEntryNotes(e.target.value)} />
                </div>
                <button className="btn-primary" disabled={savingEntry} onClick={handleSaveEntry}>
                  {savingEntry ? "جاري الحفظ..." : editingEntry ? "حفظ التعديل" : "+ إضافة"}
                </button>
                {editingEntry && (
                  <button className="btn-secondary" onClick={resetEntryForm}>إلغاء</button>
                )}
              </div>
              {entryError && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2">{entryError}</div>}
            </div>
          )}

          <div className="card overflow-x-auto mb-4">
            <div className="px-4 pt-4 pb-1 text-sm font-semibold text-gray-700">المخزون المتوفر حاليًا — {stockData?.farmerName ?? farmerPick.name}</div>
            {stockError && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2 mx-4">{stockError}</div>}
            <table className="table-base">
              <thead>
                {/* صناديق خشب فيلد مستقل تمامًا عن الوارد/المباع/المتوفر (اللي هني بوحدة الصنف
                    نفسها كيلو أو صندوق) — هاد عدد صناديق الخشب الفعلي المسجّل، دايمًا "صندوق"
                    بغض النظر عن وحدة الصنف. */}
                <tr><th>الصنف</th><th>الوحدة</th><th>الوارد</th><th>المباع</th><th>المتوفر</th><th>صناديق خشب</th></tr>
              </thead>
              <tbody>
                {stockLoading ? (
                  <tr><td colSpan={6} className="text-center text-gray-400 py-6">جاري التحميل...</td></tr>
                ) : !stockData || stockData.stock.length === 0 ? (
                  <tr><td colSpan={6} className="text-center text-gray-400 py-6">لا توجد بضاعة مسجلة لهذا البائع بعد</td></tr>
                ) : (
                  stockData.stock.map((r, idx) => (
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

          <div className="card overflow-x-auto mb-4">
            <div className="px-4 pt-4 pb-1 text-sm font-semibold text-gray-700">سجل الإضافات</div>
            <table className="table-base">
              <thead>
                <tr>
                  {/* "صناديق خشب" فيلد مستقل — دايمًا عدد صناديق (مش وحدة الصنف e.unit) */}
                  <th>التاريخ</th><th>الصنف</th><th>الكمية</th><th>صناديق خشب</th><th>ملاحظات</th>
                  {(canEdit || canDelete) && <th></th>}
                </tr>
              </thead>
              <tbody>
                {!stockData || stockData.entries.length === 0 ? (
                  <tr><td colSpan={(canEdit || canDelete) ? 6 : 5} className="text-center text-gray-400 py-6">لا توجد إضافات مسجلة بعد</td></tr>
                ) : (
                  stockData.entries.map((e) => (
                    <tr key={e.id}>
                      <td>{formatDate(e.date)}</td>
                      <td className="font-medium">{e.itemName}</td>
                      <td>{formatQuantity(e.quantity, e.unit)}</td>
                      <td>{e.woodQuantity > 0 ? formatQuantity(e.woodQuantity, "Box") : "—"}</td>
                      <td className="text-gray-500 text-sm">{e.notes ?? "—"}</td>
                      {(canEdit || canDelete) && (
                        <td className="whitespace-nowrap">
                          {canEdit && <button className="text-brand-700 text-sm hover:underline me-2" onClick={() => startEdit(e)}>تعديل</button>}
                          {canDelete && (
                            <button className="text-red-600 text-sm hover:underline" disabled={deletingId === e.id} onClick={() => handleDeleteEntry(e)}>
                              {deletingId === e.id ? "جاري الحذف..." : "حذف"}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="card p-4 mb-4 space-y-3">
            <h2 className="font-semibold text-gray-700">سجل المبيعات</h2>
            <p className="text-xs text-gray-500">الفترة اختيارية — اتركها فارغة لعرض كل سجل البائع.</p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label">من تاريخ (اختياري)</label>
                <input type="date" className="input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <label className="label">إلى تاريخ (اختياري)</label>
                <input type="date" className="input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
              <button className="btn-primary" disabled={loading} onClick={handleSearch}>
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
                    <tr><td colSpan={4} className="text-center text-gray-400 py-6">لا توجد بضاعة مباعة مسجلة لهذا البائع ضمن الفترة المحددة</td></tr>
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
        </>
      )}

      <GoodsGlobalStockCard rows={globalStock} loading={globalStockLoading} error={globalStockError} />
    </div>
  );
}
