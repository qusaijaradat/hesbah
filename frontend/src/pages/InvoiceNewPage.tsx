import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PartnerAutocomplete } from "../components/PartnerAutocomplete";
import { ItemAutocomplete } from "../components/ItemAutocomplete";
import { createInvoice } from "../api/invoices";
import { getMerchantAccount } from "../api/partners";
import { apiErrorMessage } from "../api/client";
import { formatCurrency, formatQuantity, todayLocalDateString } from "../lib/format";
import type { MerchantAccountDto, UnitOfMeasure } from "../types";

interface Row {
  itemName: string;
  quantity: string;
  unit: UnitOfMeasure;
  pricePerUnit: string;
}

function emptyRow(): Row {
  return { itemName: "", quantity: "", unit: "Kg", pricePerUnit: "" };
}

const UNIT_OPTIONS: { value: UnitOfMeasure; label: string }[] = [
  { value: "Kg", label: "كيلو" },
  { value: "Box", label: "صندوق" },
];

function quantityLabel(unit: UnitOfMeasure) {
  return unit === "Kg" ? "الوزن (كغم)" : "عدد الصناديق";
}

function priceLabel(unit: UnitOfMeasure) {
  return unit === "Kg" ? "سعر الكيلو (₪)" : "سعر الصندوق (₪)";
}

export function InvoiceNewPage() {
  const navigate = useNavigate();
  const [date, setDate] = useState(() => todayLocalDateString());
  // Partner fields track BOTH a selected existing partner (id + name) and the raw typed
  // text — requirement: no separate "add partner" step, any typed name is fine and will
  // be created automatically server-side if it doesn't already match someone.
  const [merchant, setMerchant] = useState<{ id: number; name: string } | null>(null);
  const [merchantText, setMerchantText] = useState("");
  // Roadmap: "alert when a merchant exceeds a credit limit" — fetched once a known merchant is
  // selected, purely informational (never blocks saving the invoice).
  const [merchantAccount, setMerchantAccount] = useState<MerchantAccountDto | null>(null);
  // Farmer is optional — an invoice can be entered for the trader alone.
  const [farmer, setFarmer] = useState<{ id: number; name: string } | null>(null);
  const [farmerText, setFarmerText] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Requirement: after saving, jump straight into a fresh invoice instead of navigating
  // away — the market enters invoices back-to-back all day, so staying on this screen
  // (with a quick link to the one just saved) beats re-clicking "new invoice" every time.
  const [lastSaved, setLastSaved] = useState<{ id: number; invoiceNumber: string } | null>(null);

  const parsedRows = rows.map((r) => ({
    itemName: r.itemName,
    quantity: parseFloat(r.quantity) || 0,
    unit: r.unit,
    pricePerUnit: parseFloat(r.pricePerUnit) || 0,
  }));
  // Not everything is sold by weight — box-unit lines have their own total instead of
  // being folded into (or silently dropped from) the weight figure.
  const totalWeight = parsedRows.filter((r) => r.unit === "Kg").reduce((sum, r) => sum + r.quantity, 0);
  const totalBoxes = parsedRows.filter((r) => r.unit === "Box").reduce((sum, r) => sum + r.quantity, 0);
  const totalValue = parsedRows.reduce((sum, r) => sum + r.quantity * r.pricePerUnit, 0);

  useEffect(() => {
    if (!merchant) { setMerchantAccount(null); return; }
    let cancelled = false;
    getMerchantAccount(merchant.id).then((account) => { if (!cancelled) setMerchantAccount(account); });
    return () => { cancelled = true; };
  }, [merchant]);

  // Projected: what the merchant's remaining balance would be if this invoice is saved as-is.
  const projectedRemaining = (merchantAccount?.remaining ?? 0) + totalValue;
  const wouldExceedCreditLimit = merchantAccount?.creditLimit != null && projectedRemaining > merchantAccount.creditLimit;

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(index: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  function resetForm() {
    setDate(todayLocalDateString());
    setMerchant(null);
    setMerchantText("");
    setMerchantAccount(null);
    setFarmer(null);
    setFarmerText("");
    setRows([emptyRow()]);
  }

  async function handleSubmit() {
    setError(null);
    setLastSaved(null);
    const merchantName = merchantText.trim();
    const farmerName = farmerText.trim();
    if (!merchant && !merchantName) { setError("يرجى إدخال اسم التاجر"); return; }
    const items = parsedRows.filter((r) => r.itemName.trim() && r.quantity > 0);
    if (items.length === 0) { setError("يجب إضافة صنف واحد على الأقل بكمية أكبر من صفر"); return; }

    setBusy(true);
    try {
      const invoice = await createInvoice({
        date: new Date(date).toISOString(),
        merchantId: merchant?.id,
        merchantName: merchant ? undefined : merchantName,
        // Farmer is optional: only send an id/name if one was actually entered.
        farmerId: farmer?.id,
        farmerName: farmer ? undefined : (farmerName || undefined),
        items,
      });
      setLastSaved({ id: invoice.id, invoiceNumber: invoice.invoiceNumber });
      resetForm();
    } catch (err) {
      setError(apiErrorMessage(err, "فشل إنشاء الفاتورة"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">فاتورة بيع جديدة</h1>

      {lastSaved && (
        <div className="text-sm text-brand-800 bg-brand-50 border border-brand-200 rounded-md p-3 mb-4 flex items-center justify-between flex-wrap gap-2">
          <span>✅ تم حفظ الفاتورة {lastSaved.invoiceNumber} — جاهز لإدخال فاتورة جديدة.</span>
          <Link to={`/invoices/${lastSaved.id}`} className="text-brand-700 font-medium hover:underline">
            عرض / طباعة الفاتورة ←
          </Link>
        </div>
      )}

      <div className="card p-5 space-y-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="label">التاريخ</label>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <PartnerAutocomplete
            label="التاجر" value={merchant} onChange={setMerchant}
            allowNew onFreeTextChange={setMerchantText}
            placeholder="اكتب اسم التاجر أو اختره من القائمة..."
            types={["Merchant", "Both"]}
          />
          <PartnerAutocomplete
            label="البائع / السائق (اختياري)" value={farmer} onChange={setFarmer}
            allowNew onFreeTextChange={setFarmerText}
            placeholder="اتركه فارغًا إن لم يكن معروفًا..."
            types={["Farmer", "Driver", "Both"]}
          />
        </div>
        {wouldExceedCreditLimit && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
            ⚠️ هذا التاجر سيتجاوز حده الائتماني ({formatCurrency(merchantAccount!.creditLimit ?? 0)}) إذا حُفظت هذه الفاتورة —
            الرصيد المتوقع بعدها {formatCurrency(projectedRemaining)}. هذا تنبيه فقط ولا يمنع الحفظ.
          </div>
        )}
      </div>

      <div className="card p-5 mb-4">
        <h2 className="font-semibold mb-3">بنود البضاعة</h2>
        <div className="space-y-3 sm:space-y-2">
          {/* Column labels only make sense once fields sit side-by-side (sm+) — on mobile
              each field gets its own inline label instead (see below). */}
          <div className="hidden sm:grid grid-cols-12 gap-2 text-xs text-gray-500 px-1">
            <div className="col-span-4">الصنف</div>
            <div className="col-span-2">الوحدة</div>
            <div className="col-span-2">الكمية</div>
            <div className="col-span-2">السعر (₪)</div>
            <div className="col-span-2">الإجمالي</div>
          </div>
          {rows.map((row, idx) => {
            const lineTotal = (parseFloat(row.quantity) || 0) * (parseFloat(row.pricePerUnit) || 0);
            return (
              <div key={idx} className="grid grid-cols-2 sm:grid-cols-12 gap-2 sm:items-center border-b sm:border-0 pb-3 sm:pb-0">
                <div className="col-span-2 sm:col-span-4">
                  <label className="label sm:hidden">الصنف</label>
                  <ItemAutocomplete value={row.itemName} placeholder="مثال: بندورة"
                    onChange={(name) => updateRow(idx, { itemName: name })} />
                </div>
                <div className="col-span-1 sm:col-span-2">
                  <label className="label sm:hidden">الوحدة</label>
                  <select className="input" value={row.unit}
                    onChange={(e) => updateRow(idx, { unit: e.target.value as UnitOfMeasure })}>
                    {UNIT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="col-span-1 sm:col-span-2">
                  <label className="label sm:hidden">{quantityLabel(row.unit)}</label>
                  <input className="input" type="number" min="0" step="0.001" value={row.quantity}
                    placeholder={row.unit === "Kg" ? "كغم" : "عدد"}
                    onChange={(e) => updateRow(idx, { quantity: e.target.value })} />
                </div>
                <div className="col-span-1 sm:col-span-2">
                  <label className="label sm:hidden">{priceLabel(row.unit)}</label>
                  <input className="input" type="number" min="0" step="0.01" value={row.pricePerUnit}
                    placeholder={priceLabel(row.unit)}
                    onChange={(e) => updateRow(idx, { pricePerUnit: e.target.value })} />
                </div>
                <div className="col-span-1 sm:col-span-1 flex items-center justify-between sm:block">
                  <label className="label sm:hidden">الإجمالي</label>
                  <div className="text-sm font-medium">{formatCurrency(lineTotal)}</div>
                </div>
                <div className="col-span-2 sm:col-span-1 flex justify-end sm:justify-start">
                  <button className="text-red-500 text-sm" onClick={() => removeRow(idx)} title="حذف الصنف">
                    ✕ <span className="sm:hidden">حذف الصنف</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <button className="btn-secondary mt-3" onClick={addRow}>+ إضافة صنف</button>
      </div>

      <div className="card p-5 mb-4 flex flex-wrap gap-4 justify-between text-sm">
        {totalWeight > 0 && (
          <div>
            <div className="text-gray-500">إجمالي الوزن</div>
            <div className="font-bold text-lg">{formatQuantity(totalWeight, "Kg")}</div>
          </div>
        )}
        {totalBoxes > 0 && (
          <div>
            <div className="text-gray-500">إجمالي عدد الصناديق</div>
            <div className="font-bold text-lg">{formatQuantity(totalBoxes, "Box")}</div>
          </div>
        )}
        <div className="text-end ms-auto">
          <div className="text-gray-500">إجمالي قيمة البيع</div>
          <div className="font-bold text-lg text-brand-700">{formatCurrency(totalValue)}</div>
        </div>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-3 mb-4">{error}</div>}

      <div className="flex justify-end gap-2">
        <button className="btn-secondary" onClick={() => navigate("/invoices")}>إلغاء</button>
        <button className="btn-primary" onClick={handleSubmit} disabled={busy}>{busy ? "جاري الحفظ..." : "حفظ الفاتورة"}</button>
      </div>
    </div>
  );
}
