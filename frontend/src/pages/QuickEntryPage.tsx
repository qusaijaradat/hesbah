import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PartnerAutocomplete } from "../components/PartnerAutocomplete";
import { ItemAutocomplete } from "../components/ItemAutocomplete";
import { createInvoice } from "../api/invoices";
import { apiErrorMessage } from "../api/client";
import { formatCurrency, todayLocalDateString } from "../lib/format";
import { lineTotalOf } from "../lib/invoiceCharge";
import { auditRows, groupRows, isBlank, num } from "../lib/ledgerAudit";
import type { Finding, LedgerRow } from "../lib/ledgerAudit";

/**
 * "إدخال الدفتر" — EXPERIMENTAL. Types a page of the paper ledger in one pass.
 *
 * The market keeps four notebooks, one per person, and someone later copies them into the system
 * one invoice form at a time. That form is built for ONE invoice: pick a buyer, a seller, a driver,
 * then add lines. A notebook page is the opposite shape — one row per sale, mixed buyers and
 * sellers down the page — so copying it means opening and closing the form dozens of times and
 * re-picking the same three names over and over.
 *
 * This screen has the notebook's own columns in the notebook's own order, takes the whole page as
 * rows, and turns them into invoices at the end: rows sharing (buyer, seller, driver, date) become
 * ONE invoice, which is what an invoice already is here.
 *
 * Deliberately frontend-only. It calls the same createInvoice the normal form calls, so every money
 * rule — commission, crate fees, wood, transport — applies exactly as it does to a hand-typed
 * invoice; this screen fills the form in, it does not write to the database. Nothing was added to
 * the API or the schema for it, so if it turns out not to earn its place, deleting this one file
 * and its route removes it completely.
 *
 * Scanning the page with AI is where this is meant to go. Free OCR cannot read handwritten Arabic
 * well enough to trust with money, so the four name columns (مشتري/بائع/سائق/الصنف) are picked from
 * what is already on file — two keystrokes each — and the four number columns are typed. When the
 * scan does arrive, it fills this same grid and this same review happens; the grid is the part that
 * survives either way.
 */

// The checks and the grouping live in lib/ledgerAudit — pure, and covered by their own harness.
type Row = LedgerRow;

function emptyRow(): Row {
  return {
    merchant: null, merchantText: "", itemName: "", quantity: "", weightKg: "",
    pricePerUnit: "", driver: null, driverText: "", farmer: null, farmerText: "", boxQuantity: "",
  };
}

export function QuickEntryPage() {
  const [date, setDate] = useState(() => todayLocalDateString());
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: 8 }, emptyRow));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ count: number; invoices: { id: number; number: string }[] } | null>(null);

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setSaved(null);
  }

  /** "زي اللي فوق" — the page is mixed, but consecutive rows repeat the same three names constantly. */
  function copyDown(index: number) {
    if (index === 0) return;
    setRows((prev) => prev.map((r, i) => (i === index ? {
      ...r,
      merchant: prev[i - 1].merchant, merchantText: prev[i - 1].merchantText,
      farmer: prev[i - 1].farmer, farmerText: prev[i - 1].farmerText,
      driver: prev[i - 1].driver, driverText: prev[i - 1].driverText,
    } : r)));
  }

  const live = rows.filter((r) => !isBlank(r));
  const findings = useMemo(() => auditRows(rows), [rows]);
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warn");
  const findingsByRow = useMemo(() => {
    const m = new Map<number, Finding[]>();
    for (const f of findings) {
      if (!m.has(f.rowIndex)) m.set(f.rowIndex, []);
      m.get(f.rowIndex)!.push(f);
    }
    return m;
  }, [findings]);

  const pageTotal = live.reduce((sum, r) => sum + lineTotalOf({
    quantity: num(r.quantity),
    weightKg: r.weightKg.trim() === "" ? null : num(r.weightKg),
    pricePerUnit: num(r.pricePerUnit),
  }), 0);

  const groups = useMemo(() => groupRows(rows), [rows]);

  async function handleSaveAll() {
    if (live.length === 0) { setError("ما في ولا سطر معبّى."); return; }
    if (errors.length > 0) { setError("في أخطاء لازم تتصلّح قبل الحفظ."); return; }

    setBusy(true);
    setError(null);
    setSaved(null);
    const created: { id: number; number: string }[] = [];
    try {
      // One invoice per group, in order. If one fails partway, the ones already created stay —
      // they are real invoices — and the message says how many went in, so nobody re-enters the
      // whole page on top of them.
      for (const group of groups) {
        const head = group[0];
        const invoice = await createInvoice({
          date: new Date(date).toISOString(),
          merchantId: head.merchant?.id,
          merchantName: head.merchant ? undefined : head.merchantText.trim(),
          farmerId: head.farmer?.id,
          farmerName: head.farmer ? undefined : (head.farmerText.trim() || undefined),
          driverId: head.driver?.id,
          driverName: head.driver ? undefined : (head.driverText.trim() || undefined),
          items: group.map((r) => ({
            itemName: r.itemName.trim(),
            quantity: num(r.quantity),
            weightKg: r.weightKg.trim() === "" ? null : num(r.weightKg),
            pricePerUnit: num(r.pricePerUnit),
            boxQuantity: num(r.boxQuantity),
          })),
        });
        created.push({ id: invoice.id, number: invoice.invoiceNumber });
      }
      setSaved({ count: created.length, invoices: created });
      setRows(Array.from({ length: 8 }, emptyRow));
    } catch (err) {
      setError(
        `${apiErrorMessage(err, "فشل الحفظ")}${created.length > 0
          ? ` — انحفظت ${created.length} فاتورة قبل الخطأ، ما تعيد إدخالها.`
          : ""}`,
      );
      if (created.length > 0) setSaved({ count: created.length, invoices: created });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-2xl font-bold">إدخال الدفتر</h1>
          <p className="text-sm text-gray-500 mt-1">
            نفس أعمدة الدفتر وبنفس الترتيب — اكتب الصفحة كلها وبعدين احفظ مرة وحدة.
            الأسطر اللي إلها نفس (المشتري + البائع + السائق) بتنحفظ بفاتورة وحدة.
          </p>
        </div>
        <span className="text-xs bg-amber-100 text-amber-800 rounded-full px-3 py-1 font-medium">تجريبي</span>
      </div>

      <div className="card p-4 mb-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="label">تاريخ الصفحة</label>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="text-sm text-gray-600">
          <div>أسطر معبّاية: <span className="font-semibold text-gray-900">{live.length}</span></div>
          <div>رح تنحفظ: <span className="font-semibold text-gray-900">{groups.length}</span> فاتورة</div>
        </div>
        <div className="text-sm text-gray-600 ms-auto text-end">
          <div className="text-gray-500">مجموع الصفحة</div>
          <div className="font-bold text-lg text-brand-700">{formatCurrency(pageTotal)}</div>
        </div>
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <div className="card p-4 mb-4">
          <div className="font-semibold mb-2">
            التدقيق
            {errors.length > 0 && <span className="text-red-700"> — {errors.length} خطأ</span>}
            {warnings.length > 0 && <span className="text-amber-700"> — {warnings.length} تنبيه</span>}
          </div>
          {/* No total is written at the bottom of the page, so nothing here is checked against the
              paper — every line below is the rows disagreeing with each other or with what is on file. */}
          <ul className="text-sm space-y-1 max-h-48 overflow-y-auto">
            {findings.map((f, i) => (
              <li key={i} className={f.severity === "error" ? "text-red-700" : "text-amber-700"}>
                سطر {f.rowIndex + 1}: {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3 mb-4">{error}</div>}
      {saved && (
        <div className="text-sm text-brand-800 bg-brand-50 border border-brand-200 rounded-md p-3 mb-4">
          ✅ انحفظت {saved.count} فاتورة:{" "}
          {saved.invoices.map((inv, i) => (
            <span key={inv.id}>
              {i > 0 && "، "}
              <Link to={`/invoices/${inv.id}`} className="font-medium hover:underline">{inv.number}</Link>
            </span>
          ))}
        </div>
      )}

      <div className="card overflow-x-auto mb-4">
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-8"></th>
              <th className="min-w-40">المشتري</th>
              <th className="min-w-36">الصنف</th>
              <th className="w-24">العدد</th>
              <th className="w-24">الوزن</th>
              <th className="w-24">السعر</th>
              <th className="min-w-36">السائق</th>
              <th className="min-w-36">البائع</th>
              <th className="w-24">الصناديق</th>
              <th className="w-24">الإجمالي</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const rowFindings = findingsByRow.get(idx) ?? [];
              const hasError = rowFindings.some((f) => f.severity === "error");
              const hasWarn = !hasError && rowFindings.length > 0;
              const total = lineTotalOf({
                quantity: num(row.quantity),
                weightKg: row.weightKg.trim() === "" ? null : num(row.weightKg),
                pricePerUnit: num(row.pricePerUnit),
              });
              return (
                <tr key={idx} className={hasError ? "bg-red-50" : hasWarn ? "bg-amber-50" : undefined}>
                  <td className="text-xs text-gray-400 text-center">{idx + 1}</td>
                  <td>
                    <PartnerAutocomplete
                      label="المشتري" labelHidden value={row.merchant}
                      onChange={(p) => updateRow(idx, { merchant: p })}
                      text={row.merchantText}
                      onFreeTextChange={(t) => updateRow(idx, { merchantText: t })}
                      allowNew newTypeLabel="مشتري" types={["Merchant"]}
                    />
                  </td>
                  <td>
                    <ItemAutocomplete value={row.itemName} onChange={(name) => updateRow(idx, { itemName: name })} />
                  </td>
                  <td>
                    <input className="input" type="number" min="0" step="0.001" value={row.quantity}
                      onChange={(e) => updateRow(idx, { quantity: e.target.value })} />
                  </td>
                  <td>
                    <input className="input" type="number" min="0" step="0.001" value={row.weightKg}
                      placeholder="—"
                      onChange={(e) => updateRow(idx, { weightKg: e.target.value })} />
                  </td>
                  <td>
                    <input className="input" type="number" min="0" step="0.01" value={row.pricePerUnit}
                      onChange={(e) => updateRow(idx, { pricePerUnit: e.target.value })} />
                  </td>
                  <td>
                    <PartnerAutocomplete
                      label="السائق" labelHidden value={row.driver}
                      onChange={(p) => updateRow(idx, { driver: p })}
                      text={row.driverText}
                      onFreeTextChange={(t) => updateRow(idx, { driverText: t })}
                      allowNew newTypeLabel="سائق" types={["Driver", "Farmer"]}
                    />
                  </td>
                  <td>
                    <PartnerAutocomplete
                      label="البائع" labelHidden value={row.farmer}
                      onChange={(p) => updateRow(idx, { farmer: p })}
                      text={row.farmerText}
                      onFreeTextChange={(t) => updateRow(idx, { farmerText: t })}
                      allowNew newTypeLabel="بائع" types={["Farmer"]}
                    />
                  </td>
                  <td>
                    <input className="input" type="number" min="0" step="1" value={row.boxQuantity}
                      onChange={(e) => updateRow(idx, { boxQuantity: e.target.value })} />
                  </td>
                  <td className="text-sm whitespace-nowrap">
                    {num(row.pricePerUnit) > 0 ? formatCurrency(total) : <span className="text-amber-600 text-xs">غير مسعّر</span>}
                  </td>
                  <td>
                    {idx > 0 && (
                      <button
                        className="text-xs text-brand-700 hover:underline whitespace-nowrap"
                        onClick={() => copyDown(idx)}
                        title="ينسخ المشتري والبائع والسائق من السطر اللي فوق"
                      >
                        ↑ زي فوق
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-secondary" onClick={() => setRows((prev) => [...prev, ...Array.from({ length: 5 }, emptyRow)])}>
          + ٥ أسطر
        </button>
        <button
          className="btn-primary"
          onClick={handleSaveAll}
          disabled={busy || live.length === 0 || errors.length > 0}
          data-enter-target
        >
          {busy ? "جاري الحفظ..." : `حفظ ${groups.length} فاتورة`}
        </button>
        {errors.length > 0 && (
          <span className="text-sm text-red-700">صلّح الأخطاء أولًا.</span>
        )}
      </div>
    </div>
  );
}
