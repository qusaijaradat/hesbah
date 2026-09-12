import { useEffect, useState } from "react";
import { usePagination } from "../lib/usePagination";
import { TablePagination } from "../components/TablePagination";
import { getFarmerGoods } from "../api/invoices";
import { createPartner } from "../api/partners";
import { createGoodsEntry, deleteGoodsEntry, getFarmerGoodsStock, getGoodsGlobalStock, printFarmerGoodsStockPdf, updateGoodsEntry } from "../api/goods";
import { apiErrorMessage } from "../api/client";
import { PartnerAutocomplete } from "../components/PartnerAutocomplete";
import { ItemAutocomplete } from "../components/ItemAutocomplete";
import { GoodsGlobalStockCard } from "../components/GoodsGlobalStockCard";
import { formatCount, formatDate, formatWeight, todayLocalDateString } from "../lib/format";
import { useAuth } from "../auth/AuthContext";
import type { FarmerGoodsRow, FarmerGoodsStockDto, GoodsEntryDto, GoodsStockRow } from "../types";
import { useSelection } from "../lib/useSelection";
import { runBulkDelete, summarizeBulkDelete } from "../lib/bulkDelete";
import { PdfActions } from "../components/PdfActions";


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
  const canCreatePartners = hasPermission("partners.create");

  const [farmerPick, setFarmerPick] = useState<{ id: number; name: string } | null>(null);

  /** A seller who turns up with goods before anyone has recorded them — added right here rather
   *  than on the partners page and back. Only the name and type; the rest of their details stay
   *  optional, exactly as they are for a seller first met on an invoice. */
  async function createFarmer(name: string) {
    try {
      const created = await createPartner({ name, type: "Farmer" });
      return { id: created.id, name: created.name };
    } catch (err) {
      throw new Error(apiErrorMessage(err, "فشلت إضافة البائع"));
    }
  }

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
  // العدد and الوزن, the same pair an invoice line carries — intake used to be one number plus a
  // Kg/Box unit, which could not be netted against a sale that had both.
  const [entryWeight, setEntryWeight] = useState("");
  const [entryQuantity, setEntryQuantity] = useState("");
  const [entryWoodQuantity, setEntryWoodQuantity] = useState("");
  const [entrySackQuantity, setEntrySackQuantity] = useState("");
  const [entryNotes, setEntryNotes] = useState("");
  const [savingEntry, setSavingEntry] = useState(false);
  const [entryError, setEntryError] = useState<string | null>(null);

  const [editingEntry, setEditingEntry] = useState<GoodsEntryDto | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const entriesSelection = useSelection();
  // Both halves of this page grow every day — the stock summary and the raw intake log.
  const stockPager = usePagination(stockData?.stock ?? []);
  const entriesPager = usePagination(stockData?.entries ?? []);
  const [bulkDeletingEntries, setBulkDeletingEntries] = useState(false);

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
    entriesSelection.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [farmerPick?.id]);

  function resetEntryForm() {
    setEntryDate(todayLocalDateString());
    setEntryItem("");
    setEntryWeight("");
    setEntryQuantity("");
    setEntryWoodQuantity("");
    setEntrySackQuantity("");
    setEntryNotes("");
    setEditingEntry(null);
    setEntryError(null);
  }

  function startEdit(entry: GoodsEntryDto) {
    setEditingEntry(entry);
    setEntryDate(entry.date.slice(0, 10));
    setEntryItem(entry.itemName);
    setEntryWeight(entry.weightKg != null && entry.weightKg > 0 ? String(entry.weightKg) : "");
    setEntryQuantity(String(entry.quantity));
    setEntryWoodQuantity(entry.woodQuantity > 0 ? String(entry.woodQuantity) : "");
    setEntrySackQuantity(entry.sackQuantity > 0 ? String(entry.sackQuantity) : "");
    setEntryNotes(entry.notes ?? "");
    setEntryError(null);
  }

  async function handleSaveEntry() {
    if (!farmerPick) return;
    const quantity = Number(entryQuantity);
    const woodQuantity = entryWoodQuantity ? Number(entryWoodQuantity) : 0;
    const sackQuantity = entrySackQuantity ? Number(entrySackQuantity) : 0;
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
        weightKg: entryWeight.trim() === "" ? null : (parseFloat(entryWeight) || 0),
        quantity,
        woodQuantity,
        sackQuantity,
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
    if (!window.confirm(`حذف "${entry.itemName}" (${formatCount(entry.quantity)}) بتاريخ ${formatDate(entry.date)}؟`)) return;
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

  async function handleBulkDeleteEntries() {
    if (!farmerPick || !stockData) return;
    const selected = stockData.entries.filter((e) => entriesSelection.selected.has(e.id));
    if (selected.length === 0) return;
    if (!window.confirm(`حذف ${selected.length} إضافة محددة؟ لا يمكن التراجع عن هذا.`)) return;
    setBulkDeletingEntries(true);
    setStockError(null);
    const outcome = await runBulkDelete(selected, (e) => e.id, (e) => `${e.itemName} (${formatDate(e.date)})`, deleteGoodsEntry);
    setBulkDeletingEntries(false);
    entriesSelection.clear();
    if (editingEntry && selected.some((e) => e.id === editingEntry.id)) resetEntryForm();
    await refreshStock(farmerPick.id);
    if (outcome.failedCount > 0) setStockError(summarizeBulkDelete(outcome));
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

  // "كم صندوق خشب إجمالًا؟" — every row now, not just the box-UNIT ones. A row priced by weight
  // carried crates too; it just had no way to say so, so its crates were left out of this total.
  const totalWoodBoxes = rows.reduce((sum, r) => sum + r.woodQuantity, 0);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">بضاعة الباعة</h1>

      <div className="card p-4 mb-4 space-y-3">
        <div className="w-full max-w-xs">
          {/* Unlike the invoice form, this picker cannot defer creating the person: everything
              below it loads THAT seller's own stock and entries, so it needs a real id in hand.
              So the "add new" row here creates the seller on the spot and selects them — shown
              only to someone who may create a partner at all, since the invoice-style "it will be
              added when you save" promise does not apply. */}
          <PartnerAutocomplete
            label="البائع" value={farmerPick} onChange={setFarmerPick}
            placeholder="اكتب اسم البائع واختره من القائمة..."
            types={["Farmer"]}
            allowNew={canCreatePartners}
            newTypeLabel="بائع"
            onCreateNew={canCreatePartners ? createFarmer : undefined}
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
                  <label className="label">العدد</label>
                  <input type="number" step="0.001" min="0" className="input w-32" value={entryQuantity} onChange={(e) => setEntryQuantity(e.target.value)} />
                </div>
                <div>
                  <label className="label">الوزن (كغم، اختياري)</label>
                  <input type="number" step="0.001" min="0" className="input w-32" value={entryWeight}
                    placeholder="اتركه فارغًا إذا مش موزون"
                    onChange={(e) => setEntryWeight(e.target.value)} />
                </div>
                <div>
                  {/* فيلد مستقل عن العدد/الوزن أعلاه — عدد صناديق الخشب الفعلي المستخدم بنقل
                      هالبضاعة، مش جزء أو نسبة منهن (ممكن ٣٠٠ كغم بـ٣ صناديق خشب). */}
                  <label className="label">صناديق خشب (اختياري)</label>
                  <input type="number" step="1" min="0" className="input w-32" value={entryWoodQuantity} onChange={(e) => setEntryWoodQuantity(e.target.value)} placeholder="0" />
                </div>
                <div>
                  {/* نفس فكرة صناديق الخشب — عدد المخالات الي إجت مع البضاعة، مستقل عن الكمية
                      وعن الصناديق، وبنحسب برصيده لحاله بشاشة الصناديق والمخالات. */}
                  <label className="label">مخالات (اختياري)</label>
                  <input type="number" step="1" min="0" className="input w-32" value={entrySackQuantity} onChange={(e) => setEntrySackQuantity(e.target.value)} placeholder="0" />
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
            <div className="flex items-center justify-between flex-wrap gap-2 px-4 pt-4 pb-1">
              <div className="text-sm font-semibold text-gray-700">المخزون المتوفر حاليًا — {stockData?.farmerName ?? farmerPick.name}</div>
              <div className="flex items-center gap-2">
                <PdfActions
                  fetchPdf={() => printFarmerGoodsStockPdf(farmerPick.id)}
                  fileName={`farmer-stock-${farmerPick.id}.pdf`}
                  shareTitle={`مخزون ${farmerPick.name}`}
                />
              </div>
            </div>
            {stockError && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2 mx-4">{stockError}</div>}
            <table className="table-base">
              <thead>
                {/* صناديق خشب ومخالات فيلدات مستقلة تمامًا عن الوارد/المباع/المتوفر — هدول عدد
                    الأوعية الفعلي، مش جزء من العدد ولا من الوزن. */}
                <tr><th>الصنف</th><th>الوارد (عدد)</th><th>المباع (عدد)</th><th>المتوفر (عدد)</th><th>المتوفر (وزن)</th><th>صناديق خشب</th><th>مخالات</th></tr>
              </thead>
              <tbody>
                {stockLoading ? (
                  <tr><td colSpan={6} className="text-center text-gray-400 py-6">جاري التحميل...</td></tr>
                ) : !stockData || stockData.stock.length === 0 ? (
                  <tr><td colSpan={7} className="text-center text-gray-400 py-6">لا توجد بضاعة مسجلة لهذا البائع بعد</td></tr>
                ) : (
                  stockPager.pageRows.map((r, idx) => (
                    <tr key={idx}>
                      <td className="font-medium">{r.itemName}</td>
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
              page={stockPager.page} pageSize={stockPager.pageSize} totalCount={stockPager.totalCount}
              itemLabel="سطر" onPageChange={stockPager.setPage} onPageSizeChange={stockPager.setPageSize}
            />
          </div>

          <div className="card overflow-x-auto mb-4">
            <div className="flex items-center justify-between flex-wrap gap-2 px-4 pt-4 pb-1">
              <div className="text-sm font-semibold text-gray-700">سجل الإضافات</div>
              {canDelete && entriesSelection.selected.size > 0 && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-600">محدد: <span className="font-semibold">{entriesSelection.selected.size}</span></span>
                  <button className="btn-danger text-sm" disabled={bulkDeletingEntries} onClick={handleBulkDeleteEntries}>
                    {bulkDeletingEntries ? "جاري الحذف..." : `حذف المحدد (${entriesSelection.selected.size})`}
                  </button>
                </div>
              )}
            </div>
            <table className="table-base">
              <thead>
                <tr>
                  {/* "صناديق خشب" فيلد مستقل — دايمًا عدد صناديق (مش وحدة الصنف e.unit) */}
                  {canDelete && (
                    <th className="w-8">
                      <input
                        type="checkbox"
                        checked={!!stockData && stockData.entries.length > 0 && stockData.entries.every((e) => entriesSelection.selected.has(e.id))}
                        onChange={() => entriesSelection.toggleAll(entriesPager.pageRows.map((e) => e.id))}
                      />
                    </th>
                  )}
                  <th>التاريخ</th><th>الصنف</th><th>العدد</th><th>الوزن</th><th>صناديق خشب</th><th>مخالات</th><th>ملاحظات</th>
                  {(canEdit || canDelete) && <th></th>}
                </tr>
              </thead>
              <tbody>
                {!stockData || stockData.entries.length === 0 ? (
                  <tr><td colSpan={(canEdit || canDelete ? 6 : 5) + (canDelete ? 1 : 0)} className="text-center text-gray-400 py-6">لا توجد إضافات مسجلة بعد</td></tr>
                ) : (
                  entriesPager.pageRows.map((e) => (
                    <tr key={e.id}>
                      {canDelete && (
                        <td>
                          <input type="checkbox" checked={entriesSelection.selected.has(e.id)} onChange={() => entriesSelection.toggleOne(e.id)} />
                        </td>
                      )}
                      <td>{formatDate(e.date)}</td>
                      <td className="font-medium">{e.itemName}</td>
                      <td>{formatCount(e.quantity)}</td>
                      <td>{e.weightKg != null && e.weightKg > 0 ? formatWeight(e.weightKg) : "—"}</td>
                      <td>{e.woodQuantity > 0 ? formatCount(e.woodQuantity) : "—"}</td>
                      <td>{e.sackQuantity > 0 ? e.sackQuantity.toLocaleString("en-US") : "—"}</td>
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
            <TablePagination
              page={entriesPager.page} pageSize={entriesPager.pageSize} totalCount={entriesPager.totalCount}
              itemLabel="إدخال" onPageChange={entriesPager.setPage} onPageSizeChange={entriesPager.setPageSize}
            />
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
                    <th>العدد</th>
                    <th>الوزن</th>
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
                        <td className="font-medium">{formatCount(r.totalQuantity)}</td>
                        <td>{formatWeight(r.totalWeightKg)}</td>
                        <td>{r.woodQuantity > 0 ? formatCount(r.woodQuantity) : "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="font-semibold border-t">
                      <td colSpan={3} className="text-gray-500">إجمالي صناديق الخشب</td>
                      <td>{totalWoodBoxes > 0 ? formatCount(totalWoodBoxes) : "—"}</td>
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
