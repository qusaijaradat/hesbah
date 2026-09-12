import { useState } from "react";
import { createInvoiceReturn, deleteInvoiceReturn } from "../api/invoices";
import { apiErrorMessage } from "../api/client";
import { formatCount, formatCurrency, formatDate, formatWeight, todayLocalDateString } from "../lib/format";
import type { GoodsReturnDto, InvoiceDto } from "../types";

/**
 * "مرتجع بضاعة" on one invoice — produce spoils, and a buyer sending back 10 boxes out of 100 used
 * to have no home in this system: the only options were editing the invoice (which rewrites it as
 * though those goods were never sold) or cancelling and re-entering the whole thing.
 *
 * Recording a return moves money on BOTH sides — the buyer owes less, and the seller is credited
 * back the returned value minus the commission that was charged on it — so the card says so
 * plainly rather than leaving someone to discover it from the ledger later. The arithmetic itself
 * lives server-side (GoodsReturnService); this only collects quantities.
 *
 * The returnable quantity per line is what was sold minus what has already come back, computed
 * here so the field can't even be typed past its limit — the backend enforces the same rule
 * regardless, since a stale page could otherwise return the same crates twice.
 */
export function InvoiceReturnsCard({ invoice, canManage, onChanged }: {
  invoice: InvoiceDto;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState(() => todayLocalDateString());
  const [reason, setReason] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Same trimmed/case-insensitive (name, unit) key the backend matches lines on. */
  // Name alone: a line no longer has a unit to distinguish two rows of the same item by.
  const keyOf = (itemName: string) => itemName.trim().toLowerCase();

  // Sold per line, minus everything already returned against it.
  const returnedByKey = new Map<string, number>();
  for (const ret of invoice.returns) {
    for (const line of ret.items) {
      const k = keyOf(line.itemName);
      returnedByKey.set(k, (returnedByKey.get(k) ?? 0) + line.quantity);
    }
  }
  const returnableLines = invoice.items.map((item) => {
    const k = keyOf(item.itemName);
    return { item, key: k, returnable: item.quantity - (returnedByKey.get(k) ?? 0) };
  });

  async function handleSave() {
    const items = returnableLines
      .map(({ item, key }) => ({ itemName: item.itemName, quantity: parseFloat(quantities[key] ?? "") || 0 }))
      .filter((line) => line.quantity > 0);
    if (items.length === 0) { setError("أدخل كمية أكبر من صفر لصنف واحد على الأقل."); return; }

    setBusy(true);
    setError(null);
    try {
      await createInvoiceReturn(invoice.id, { date: new Date(date).toISOString(), reason: reason.trim() || undefined, items });
      setAdding(false);
      setQuantities({});
      setReason("");
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, "فشل تسجيل المرتجع"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(ret: GoodsReturnDto) {
    if (!window.confirm(`حذف مرتجع بتاريخ ${formatDate(ret.date)} بقيمة ${formatCurrency(ret.totalValue)}؟\nرح يرجع المبلغ على حساب المشتري ومستحق البائع.`)) return;
    setError(null);
    try {
      await deleteInvoiceReturn(ret.id);
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, "فشل حذف المرتجع"));
    }
  }

  const anythingReturnable = returnableLines.some((l) => l.returnable > 0);

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h2 className="font-semibold">مرتجع البضاعة</h2>
        {invoice.returnsTotal > 0 && (
          <span className="text-sm text-gray-500">
            إجمالي المرتجع: <span className="font-semibold text-red-600">{formatCurrency(invoice.returnsTotal)}</span>
          </span>
        )}
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2 mb-3">{error}</div>}

      {invoice.returns.length === 0 ? (
        <div className="text-sm text-gray-400 mb-3">ما في مرتجع على هذه الفاتورة.</div>
      ) : (
        <div className="space-y-2 mb-3">
          {invoice.returns.map((ret) => (
            <div key={ret.id} className="border border-gray-200 rounded-md p-3">
              <div className="flex items-center justify-between flex-wrap gap-2 text-sm">
                <div>
                  <span className="font-medium">{formatDate(ret.date)}</span>
                  <span className="text-red-600 font-semibold ms-3">- {formatCurrency(ret.totalValue)}</span>
                  {ret.reason && <span className="text-gray-500 ms-3">{ret.reason}</span>}
                </div>
                {canManage && (
                  <button type="button" className="text-xs text-red-500 hover:underline" onClick={() => handleDelete(ret)}>حذف</button>
                )}
              </div>
              <div className="text-xs text-gray-600 mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {ret.items.map((line, index) => (
                  <span key={index}>
                    {line.itemName}: {line.weightKg && line.weightKg > 0 ? formatWeight(line.weightKg) : formatCount(line.quantity)} × {formatCurrency(line.pricePerUnit)} = {formatCurrency(line.lineTotal)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {canManage && invoice.status === "Active" && (
        adding ? (
          <div className="border border-gray-200 rounded-md p-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
              <div>
                <label className="label">تاريخ المرتجع</label>
                <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <label className="label">السبب (اختياري)</label>
                <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: تالف" />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr><th>الصنف</th><th>المباع</th><th>القابل للإرجاع</th><th>الكمية المرتجعة</th><th>السعر</th></tr>
                </thead>
                <tbody>
                  {returnableLines.map(({ item, key, returnable }) => (
                    <tr key={item.id}>
                      <td>{item.itemName}</td>
                      <td>{formatCount(item.quantity)}</td>
                      <td className={returnable <= 0 ? "text-gray-400" : ""}>{formatCount(returnable)}</td>
                      <td>
                        <input
                          className="input w-28" type="number" min="0" step="0.001" max={returnable}
                          disabled={returnable <= 0}
                          value={quantities[key] ?? ""}
                          onChange={(e) => setQuantities((prev) => ({ ...prev, [key]: e.target.value }))}
                        />
                      </td>
                      <td>{item.pricePerUnit > 0 ? formatCurrency(item.pricePerUnit) : "غير مسعّر"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-gray-500">
              المرتجع بينزل من حساب المشتري، وبينزل من مستحق البائع بعد خصم عمولة الحسبة على القيمة المرتجعة.
              سعر الخشب ما بيتأثر — الصناديق ما بترجع لأنه اللي كان فيها رجع.
            </p>

            <div className="flex gap-2">
              <button className="btn-primary" disabled={busy} onClick={handleSave}>
                {busy ? "جاري الحفظ..." : "حفظ المرتجع"}
              </button>
              <button className="btn-secondary" onClick={() => { setAdding(false); setError(null); }}>إلغاء</button>
            </div>
          </div>
        ) : (
          <button
            className="btn-secondary" disabled={!anythingReturnable}
            title={anythingReturnable ? undefined : "كل الكميات على هذه الفاتورة رجعت بالفعل"}
            onClick={() => setAdding(true)}
          >
            + تسجيل مرتجع
          </button>
        )
      )}
    </div>
  );
}
