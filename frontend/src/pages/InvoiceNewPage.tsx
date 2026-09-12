import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PartnerAutocomplete } from "../components/PartnerAutocomplete";
import { ItemAutocomplete } from "../components/ItemAutocomplete";
import { createInvoice } from "../api/invoices";

import { getMerchantAccount } from "../api/partners";
import { apiErrorMessage } from "../api/client";
import { listSettings } from "../api/settings";
import { InvoiceCharge, lineTotalOf } from "../lib/invoiceCharge";
import { formatCount, formatCurrency, formatWeight, todayLocalDateString } from "../lib/format";
import type { MerchantAccountDto } from "../types";
import { CREDIT_LIMIT_UI_ENABLED } from "../lib/featureFlags";


interface Row {
  itemName: string;
  /** "العدد" — always typed. Prices the line when no weight is given. */
  quantity: string;
  /** "الوزن" — optional. When it is filled in, IT prices the line instead of العدد. */
  weightKg: string;
  /** "عدد الصناديق" — the crates going out with this line; what رسوم الصناديق is charged on. */
  boxQuantity: string;
  /** "عدد الكرتون" — tracked on the containers screen, never charged. */
  cartonQuantity: string;
  pricePerUnit: string;
  /** "" = not set (0); one of WOOD_PRICE_OPTIONS; or WOOD_PRICE_OTHER, in which case the
   *  actual value lives in woodPriceCustom instead (same "أخرى" pattern as PaymentLine's
   *  method/customMethod — see resolveWoodPrice below). */
  woodPrice: string;
  /** Free-typed value, only meaningful when woodPrice === WOOD_PRICE_OTHER. */
  woodPriceCustom: string;
}

function emptyRow(): Row {
  return { itemName: "", quantity: "", weightKg: "", boxQuantity: "", cartonQuantity: "", pricePerUnit: "", woodPrice: "", woodPriceCustom: "" };
}


// Fixed preset list for "سعر الخشب" (wood/crate price) — a picker, not free text — plus an
// "أخرى" escape hatch for the occasional value outside this list (request: "مرات بكون رقم
// غير عن هدول"). The backend accepts any decimal here, so this is a purely frontend picker
// constraint; WOOD_PRICE_OTHER is just the sentinel that reveals the free-value input below.
const WOOD_PRICE_OPTIONS = ["3", "5", "6", "7", "8"];
const WOOD_PRICE_OTHER = "أخرى";

/** Resolves a row's actual wood-price number, whether it came from the preset list or the
 *  free-typed "أخرى" field. */
function resolveWoodPrice(row: Row): number {
  return row.woodPrice === WOOD_PRICE_OTHER ? (parseFloat(row.woodPriceCustom) || 0) : (parseFloat(row.woodPrice) || 0);
}


// "اختياري" — sometimes an item goes on the invoice before it's been priced (the market prices
// it later); leaving this blank saves the line at price 0, which InvoiceDetailPage/the printed
// PDF then show as "غير مسعّر" instead of "₪0.00" so it reads as "still needs a price", not "free".

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
  // Seller (بائع) and Driver (سائق) are both optional and independent — either, both, or
  // neither can be attached to the same invoice, each from its own type-filtered list.
  const [farmer, setFarmer] = useState<{ id: number; name: string } | null>(null);
  const [farmerText, setFarmerText] = useState("");
  const [driver, setDriver] = useState<{ id: number; name: string } | null>(null);
  const [driverText, setDriverText] = useState("");
  // Optional flat transport/delivery fee for the whole invoice ("أجرة النقل").
  const [transportFee, setTransportFee] = useState("");


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
    // Blank stays null, not 0 — a line that was never weighed is priced by its العدد, and the
    // difference between the two is the whole rule (see the backend InvoiceCalculator).
    weightKg: r.weightKg.trim() === "" ? null : (parseFloat(r.weightKg) || 0),
    boxQuantity: parseFloat(r.boxQuantity) || 0,
    cartonQuantity: parseFloat(r.cartonQuantity) || 0,
    pricePerUnit: parseFloat(r.pricePerUnit) || 0,
    woodPrice: resolveWoodPrice(r),
  }));
  // Every line has an العدد and, when it was weighed, a وزن — so both totals are plain sums now.
  // Each used to pick out only the lines of its own unit and ignore the rest entirely.
  const totalWeight = parsedRows.reduce((sum, r) => sum + (r.weightKg ?? 0), 0);
  const totalBoxes = parsedRows.reduce((sum, r) => sum + r.boxQuantity, 0);
  const totalCartons = parsedRows.reduce((sum, r) => sum + r.cartonQuantity, 0);
  // Product value alone — deliberately excludes wood/transport so this always matches what
  // the commission is computed on (see Invoice.TransportFee / InvoiceItem.WoodPrice on the backend).
  // Priced by the weight when there is one, otherwise by the count — the same rule the backend
  // applies on save (InvoiceCalculator.LineTotalFor), mirrored here so the form's running total
  // and the saved invoice can never disagree.
  const totalValue = parsedRows.reduce((sum, r) => sum + lineTotalOf(r), 0);
  const woodTotal = parsedRows.reduce((sum, r) => sum + r.woodPrice, 0);
  const transportFeeValue = parseFloat(transportFee) || 0;

  // The crate rate the backend will apply on save (Setting "boxes.price"). Read once — a preview
  // of a figure the server owns, not a second source for it.
  const [boxPrice, setBoxPrice] = useState(0);

  useEffect(() => {
    listSettings().then((settings) => {
      const raw = settings.find((s) => s.key === "boxes.price")?.value;
      setBoxPrice(raw ? parseFloat(raw) || 0 : 0);
    });
  }, []);

  // رسوم الصناديق, at the rate in settings — the buyer is charged it per crate the moment this is
  // saved, so the form has to show it. It did not, and "الإجمالي الكلي" here came out lower than the
  // invoice the same click produced: on 400 crates at ₪1, four hundred shekels lower.
  const boxFeeTotal = totalBoxes * boxPrice;

  // أجرة النقل is not in the buyer's total: it comes off the SELLER and goes to the driver (see
  // the backend InvoiceCharge). Kept in the form because it is entered here and drives both the
  // seller's deduction and the driver's due.
  const grandTotal = InvoiceCharge.forMerchant(totalValue, woodTotal, boxFeeTotal);


  useEffect(() => {
    if (!merchant) { setMerchantAccount(null); return; }
    let cancelled = false;
    getMerchantAccount(merchant.id).then((account) => { if (!cancelled) setMerchantAccount(account); });
    return () => { cancelled = true; };
  }, [merchant]);

  // Projected: what the merchant's remaining balance would be if this invoice is saved as-is.
  const projectedRemaining = (merchantAccount?.remaining ?? 0) + grandTotal;
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
    setDriver(null);
    setDriverText("");
    setTransportFee("");


    setRows([emptyRow()]);
  }

  async function handleSubmit() {
    setError(null);
    setLastSaved(null);
    const merchantName = merchantText.trim();
    const farmerName = farmerText.trim();
    const driverName = driverText.trim();
    if (!merchant && !merchantName) { setError("يرجى إدخال اسم المشتري"); return; }
    const items = parsedRows
      .filter((r) => r.itemName.trim() && r.quantity > 0)
      .map((r) => ({
        itemName: r.itemName, quantity: r.quantity, weightKg: r.weightKg,
        boxQuantity: r.boxQuantity, cartonQuantity: r.cartonQuantity,
        pricePerUnit: r.pricePerUnit, woodPrice: r.woodPrice,
      }));
    if (items.length === 0) { setError("يجب إضافة صنف واحد على الأقل بكمية أكبر من صفر"); return; }


    setBusy(true);
    try {
      const invoice = await createInvoice({
        date: new Date(date).toISOString(),
        merchantId: merchant?.id,
        merchantName: merchant ? undefined : merchantName,
        // Seller/Driver are both optional: only send an id/name if one was actually entered.
        farmerId: farmer?.id,
        farmerName: farmer ? undefined : (farmerName || undefined),
        driverId: driver?.id,
        driverName: driver ? undefined : (driverName || undefined),
        transportFee: transportFeeValue,

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
          <span>
            ✅ تم حفظ الفاتورة {lastSaved.invoiceNumber} — جاهز لإدخال فاتورة جديدة.
          </span>
          <Link to={`/invoices/${lastSaved.id}`} className="text-brand-700 font-medium hover:underline">
            عرض / طباعة الفاتورة ←
          </Link>
        </div>
      )}


      <div className="card p-5 space-y-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="label">التاريخ</label>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <PartnerAutocomplete
            label="المشتري" value={merchant} onChange={setMerchant}
            allowNew newTypeLabel="مشتري" text={merchantText} onFreeTextChange={setMerchantText}
            placeholder="اكتب اسم المشتري أو اختره من القائمة..."
            types={["Merchant"]}
          />
          <PartnerAutocomplete
            label="البائع (اختياري)" value={farmer} onChange={setFarmer}
            allowNew newTypeLabel="بائع" text={farmerText} onFreeTextChange={setFarmerText}
            placeholder="اتركه فارغًا إن لم يكن معروفًا..."
            types={["Farmer"]}
          />
          <PartnerAutocomplete
            label="السائق (اختياري)" value={driver} onChange={setDriver}
            allowNew newTypeLabel="سائق" text={driverText} onFreeTextChange={setDriverText}
            placeholder="اتركه فارغًا إن لم يكن معروفًا..."
            types={["Driver"]}
          />
        </div>
        {CREDIT_LIMIT_UI_ENABLED && wouldExceedCreditLimit && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
            ⚠️ هذا المشتري سيتجاوز حده الائتماني ({formatCurrency(merchantAccount!.creditLimit ?? 0)}) إذا حُفظت هذه الفاتورة —
            الرصيد المتوقع بعدها {formatCurrency(projectedRemaining)}. هذا تنبيه فقط ولا يمنع الحفظ.
          </div>
        )}
      </div>

      <div className="card p-5 mb-4">
        <h2 className="font-semibold mb-3">بنود البضاعة</h2>
        <div className="space-y-3 sm:space-y-2">
          {/* Column labels only make sense once fields sit side-by-side (sm+) — on mobile
              each field gets its own inline label instead (see below). */}
          <div className="hidden lg:flex gap-2 text-xs text-gray-500 px-1">
            <div className="grid grid-cols-12 gap-2 flex-1">
              <div className="col-span-3">الصنف</div>
              <div className="col-span-1">العدد</div>
              <div className="col-span-2">الوزن (كغم)</div>
              <div className="col-span-1">السعر (₪)</div>
              <div className="col-span-1">صناديق</div>
              <div className="col-span-1">كرتون</div>
              <div className="col-span-2">سعر الخشب</div>
              <div className="col-span-1">الإجمالي</div>
            </div>
            {/* Matches the delete button's own width below, so the columns stay lined up. */}
            <div className="w-7 shrink-0"></div>
          </div>
          {rows.map((row, idx) => {
            const lineTotal = (parseFloat(row.quantity) || 0) * (parseFloat(row.pricePerUnit) || 0);
            return (
              <div key={idx} className="flex items-start gap-2 border-b lg:border-0 pb-3 lg:pb-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2 lg:items-center flex-1">
                  <div className="sm:col-span-2 lg:col-span-3">
                    <label className="label lg:hidden">الصنف</label>
                    <ItemAutocomplete value={row.itemName} placeholder="مثال: بندورة"
                      onChange={(name) => updateRow(idx, { itemName: name })} />
                  </div>
                  <div className="lg:col-span-1">
                    <label className="label lg:hidden">العدد</label>
                    <input className="input" type="number" min="0" step="0.001" value={row.quantity}
                      placeholder="عدد"
                      onChange={(e) => updateRow(idx, { quantity: e.target.value })} />
                  </div>
                  <div className="lg:col-span-2">
                    <label className="label lg:hidden">الوزن (كغم، اختياري)</label>
                    <input className="input" type="number" step="0.001" min="0" value={row.weightKg}
                      placeholder="اتركه فارغًا إذا مش موزون"
                      title="إذا حطيت وزن، بينحسب السطر بالوزن × السعر. إذا تركته فاضي، بينحسب بالعدد × السعر."
                      onChange={(e) => updateRow(idx, { weightKg: e.target.value })} />
                  </div>
                  <div className="lg:col-span-1">
                    <label className="label lg:hidden">{row.weightKg.trim() === "" ? "سعر الوحدة (₪)" : "سعر الكيلو (₪)"}</label>
                    <input className="input" type="number" min="0" step="0.01" value={row.pricePerUnit}
                      placeholder="اتركه فارغًا"
                      onChange={(e) => updateRow(idx, { pricePerUnit: e.target.value })} />
                  </div>
                  {/* The two container counts. Only الصناديق carries رسوم الصناديق and the driver's
                      أجرة الصناديق; الكرتون is counted and tracked, never charged. */}
                  <div className="lg:col-span-1">
                    <label className="label lg:hidden">عدد الصناديق</label>
                    <input className="input" type="number" step="1" min="0" value={row.boxQuantity}
                      placeholder="صناديق"
                      onChange={(e) => updateRow(idx, { boxQuantity: e.target.value })} />
                  </div>
                  <div className="lg:col-span-1">
                    <label className="label lg:hidden">عدد الكرتون</label>
                    <input className="input" type="number" step="1" min="0" value={row.cartonQuantity}
                      placeholder="كرتون"
                      onChange={(e) => updateRow(idx, { cartonQuantity: e.target.value })} />
                  </div>
                  <div className="lg:col-span-2">
                    <label className="label lg:hidden">سعر الخشب (اختياري)</label>
                    <select className="input" value={row.woodPrice}
                      onChange={(e) => updateRow(idx, { woodPrice: e.target.value })}>
                      <option value="">بدون</option>
                      {WOOD_PRICE_OPTIONS.map((p) => <option key={p} value={p}>₪{p}</option>)}
                      <option value={WOOD_PRICE_OTHER}>{WOOD_PRICE_OTHER}</option>
                    </select>
                    {row.woodPrice === WOOD_PRICE_OTHER && (
                      <input className="input mt-1" type="number" min="0" step="0.01" value={row.woodPriceCustom}
                        placeholder="القيمة"
                        onChange={(e) => updateRow(idx, { woodPriceCustom: e.target.value })} />
                    )}
                  </div>
                  <div className="lg:col-span-1 flex items-center justify-between lg:block">
                    <label className="label lg:hidden">الإجمالي</label>
                    {/* A blank/zero price means "not priced yet", not "free" (produce is never sold
                        for ₪0 here) — flagging it now so it's obvious at a glance which lines still
                        need a price before/after saving, same convention as the detail page/PDF. */}
                    {row.pricePerUnit.trim() === "" || (parseFloat(row.pricePerUnit) || 0) === 0 ? (
                      <div className="text-xs font-medium text-amber-600 whitespace-nowrap">غير مسعّر</div>
                    ) : (
                      <div className="text-xs font-medium whitespace-nowrap">{formatCurrency(lineTotal)}</div>
                    )}
                  </div>
                </div>
                {/* Outside the grid, not a twelve-column row of its own underneath — that row was
                    both wasted height and the reason every field above it was a column too narrow. */}
                <button
                  className="w-7 h-9 shrink-0 text-red-500 hover:bg-red-50 rounded-md lg:mt-0"
                  onClick={() => removeRow(idx)}
                  title="حذف الصنف"
                  aria-label="حذف الصنف"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
        <button className="btn-secondary mt-3" onClick={addRow}>+ إضافة صنف</button>
      </div>

      <div className="card p-5 mb-4 space-y-4">
        <div className="max-w-xs">
          <label className="label">أجرة النقل (₪، اختياري)</label>
          <input className="input" type="number" min="0" step="0.01" value={transportFee}
            onChange={(e) => setTransportFee(e.target.value)} placeholder="اتركه فارغًا إن لم يوجد" />
        </div>


        <div className="flex flex-wrap gap-4 justify-between text-sm">
          {totalWeight > 0 && (
            <div>
              <div className="text-gray-500">إجمالي الوزن</div>
              <div className="font-bold text-lg">{formatWeight(totalWeight)}</div>
            </div>
          )}
          {totalBoxes > 0 && (
            <div>
              <div className="text-gray-500">إجمالي عدد الصناديق</div>
              <div className="font-bold text-lg">{formatCount(totalBoxes)}</div>
            </div>
          )}
          <div>
            <div className="text-gray-500">قيمة البضاعة</div>
            <div className="font-medium">{formatCurrency(totalValue)}</div>
          </div>
          {woodTotal > 0 && (
            <div>
              <div className="text-gray-500">إجمالي الخشب</div>
              <div className="font-medium">{formatCurrency(woodTotal)}</div>
            </div>
          )}
          {totalCartons > 0 && (
            <div>
              <div className="text-gray-500">عدد الكرتون</div>
              <div className="font-medium">{formatCount(totalCartons)}</div>
            </div>
          )}
          {boxFeeTotal > 0 && (
            <div>
              <div className="text-gray-500">رسوم الصناديق</div>
              <div className="font-medium">{formatCurrency(boxFeeTotal)}</div>
            </div>
          )}
          {transportFeeValue > 0 && (
            <div>
              <div className="text-gray-500">أجرة النقل (على البائع)</div>
              <div className="font-medium">{formatCurrency(transportFeeValue)}</div>
            </div>
          )}
          <div className="text-end ms-auto">
            <div className="text-gray-500">الإجمالي الكلي</div>
            <div className="font-bold text-lg text-brand-700">{formatCurrency(grandTotal)}</div>
          </div>
        </div>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-3 mb-4">{error}</div>}

      <div className="flex justify-end gap-2">
        <button className="btn-secondary" onClick={() => navigate("/invoices")}>إلغاء</button>
        {/* data-enter-target: Enter in the last field lands here (see lib/formNavigation) so a
            whole invoice can be typed and saved without reaching for the mouse. */}
        <button className="btn-primary" onClick={handleSubmit} disabled={busy} data-enter-target>{busy ? "جاري الحفظ..." : "حفظ الفاتورة"}</button>
      </div>
    </div>
  );
}
