import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PartnerAutocomplete } from "../components/PartnerAutocomplete";
import { ItemAutocomplete } from "../components/ItemAutocomplete";
import { getInvoice, updateInvoice } from "../api/invoices";
import { getMerchantAccount } from "../api/partners";
import { apiErrorMessage } from "../api/client";
import { formatCurrency, formatQuantity, localDateInputValue } from "../lib/format";
import type { MerchantAccountDto, UnitOfMeasure } from "../types";

interface Row {
  itemName: string;
  quantity: string;
  unit: UnitOfMeasure;
  pricePerUnit: string;
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

/// <summary>
/// Requirement gap fix: previously the only way to correct a mistaken invoice (wrong date, typo'd
/// trader, wrong quantity/price) was to cancel it and re-enter it from scratch, which also burns
/// an invoice number and leaves a "cancelled" row behind for what was really just a typo. This
/// mirrors InvoiceNewPage's form but pre-filled from the existing invoice, saving via PUT instead
/// of POST. Only Active invoices are editable — a cancelled invoice is a historical record of the
/// cancellation itself and can't be un-cancelled here.
/// </summary>
export function InvoiceEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [notEditable, setNotEditable] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");

  const [date, setDate] = useState("");
  const [merchant, setMerchant] = useState<{ id: number; name: string } | null>(null);
  const [merchantText, setMerchantText] = useState("");
  const [merchantAccount, setMerchantAccount] = useState<MerchantAccountDto | null>(null);
  const [farmer, setFarmer] = useState<{ id: number; name: string } | null>(null);
  const [farmerText, setFarmerText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  // The invoice's total BEFORE this edit — captured once when it loads, not derived from the
  // (now-editable) rows — so the credit-limit projection below can subtract out this invoice's
  // own existing contribution to the merchant's balance before adding back the edited total.
  const [originalTotalValue, setOriginalTotalValue] = useState(0);
  const [originalMerchantId, setOriginalMerchantId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    getInvoice(Number(id)).then((invoice) => {
      if (invoice.status !== "Active") {
        setNotEditable(true);
        setLoading(false);
        return;
      }
      setInvoiceNumber(invoice.invoiceNumber);
      setDate(localDateInputValue(invoice.date));
      setMerchant({ id: invoice.merchantId, name: invoice.merchantName });
      setMerchantText(invoice.merchantName);
      if (invoice.farmerId && invoice.farmerName) {
        setFarmer({ id: invoice.farmerId, name: invoice.farmerName });
        setFarmerText(invoice.farmerName);
      }
      setRows(invoice.items.map((it) => ({
        itemName: it.itemName,
        quantity: String(it.quantity),
        unit: it.unit,
        pricePerUnit: String(it.pricePerUnit),
      })));
      setOriginalTotalValue(invoice.totalValue);
      setOriginalMerchantId(invoice.merchantId);
      setLoading(false);
    });
  }, [id]);

  const parsedRows = rows.map((r) => ({
    itemName: r.itemName,
    quantity: parseFloat(r.quantity) || 0,
    unit: r.unit,
    pricePerUnit: parseFloat(r.pricePerUnit) || 0,
  }));
  const totalWeight = parsedRows.filter((r) => r.unit === "Kg").reduce((sum, r) => sum + r.quantity, 0);
  const totalBoxes = parsedRows.filter((r) => r.unit === "Box").reduce((sum, r) => sum + r.quantity, 0);
  const totalValue = parsedRows.reduce((sum, r) => sum + r.quantity * r.pricePerUnit, 0);

  useEffect(() => {
    if (!merchant) { setMerchantAccount(null); return; }
    let cancelled = false;
    getMerchantAccount(merchant.id).then((account) => { if (!cancelled) setMerchantAccount(account); });
    return () => { cancelled = true; };
  }, [merchant]);

  // Projected balance excludes this invoice's OWN original value first (since it's already
  // counted in the merchant's existing balance) before adding back the edited total — otherwise
  // editing an invoice without changing anything would double-count it. Only applies while the
  // merchant hasn't been changed — if it has, the invoice was never part of the NEW merchant's
  // balance to begin with, so nothing needs to be subtracted out.
  const stillSameMerchant = merchant?.id === originalMerchantId;
  const projectedRemaining = (merchantAccount?.remaining ?? 0) - (stillSameMerchant ? originalTotalValue : 0) + totalValue;
  const wouldExceedCreditLimit = merchantAccount?.creditLimit != null && projectedRemaining > merchantAccount.creditLimit;

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((prev) => [...prev, { itemName: "", quantity: "", unit: "Kg", pricePerUnit: "" }]);
  }

  function removeRow(index: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  async function handleSubmit() {
    if (!id) return;
    setError(null);
    const merchantName = merchantText.trim();
    const farmerName = farmerText.trim();
    if (!merchant && !merchantName) { setError("يرجى إدخال اسم التاجر"); return; }
    const items = parsedRows.filter((r) => r.itemName.trim() && r.quantity > 0);
    if (items.length === 0) { setError("يجب إضافة صنف واحد على الأقل بكمية أكبر من صفر"); return; }

    setBusy(true);
    try {
      await updateInvoice(Number(id), {
        date: new Date(date).toISOString(),
        merchantId: merchant?.id,
        merchantName: merchant ? undefined : merchantName,
        farmerId: farmer?.id,
        farmerName: farmer ? undefined : (farmerName || undefined),
        items,
      });
      navigate(`/invoices/${id}`);
    } catch (err) {
      setError(apiErrorMessage(err, "فشل تعديل الفاتورة"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="text-gray-500">جاري التحميل...</div>;

  if (notEditable) {
    return (
      <div className="max-w-2xl">
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-4">
          لا يمكن تعديل هذه الفاتورة لأنها ملغاة. الفاتورة الملغاة تبقى كسجل تاريخي كما هي.
        </div>
        <Link to={`/invoices/${id}`} className="text-sm text-brand-700 hover:underline mt-3 inline-block">
          ← رجوع لتفاصيل الفاتورة
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">تعديل الفاتورة {invoiceNumber}</h1>

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
          />
          <PartnerAutocomplete
            label="المزارع (اختياري)" value={farmer} onChange={setFarmer}
            allowNew onFreeTextChange={setFarmerText}
            placeholder="اتركه فارغًا إن لم يكن معروفًا..."
          />
        </div>
        {wouldExceedCreditLimit && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
            ⚠️ هذا التاجر سيتجاوز حده الائتماني ({formatCurrency(merchantAccount!.creditLimit ?? 0)}) بعد هذا التعديل —
            الرصيد المتوقع بعدها {formatCurrency(projectedRemaining)}. هذا تنبيه فقط ولا يمنع الحفظ.
          </div>
        )}
      </div>

      <div className="card p-5 mb-4">
        <h2 className="font-semibold mb-3">بنود البضاعة</h2>
        <div className="space-y-3 sm:space-y-2">
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
        <button className="btn-secondary" onClick={() => navigate(`/invoices/${id}`)}>إلغاء</button>
        <button className="btn-primary" onClick={handleSubmit} disabled={busy}>{busy ? "جاري الحفظ..." : "حفظ التعديلات"}</button>
      </div>
    </div>
  );
}
