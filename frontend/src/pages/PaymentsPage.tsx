import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  createExpense, createPayment, deleteExpense, deletePayment,
  listExpenses, listPayments, printExpensesPdf, printPaymentsListPdf, updateExpense, updatePayment,
} from "../api/payments";
import { listEmployees } from "../api/employees";
import { listInvoices } from "../api/invoices";
import type { CheckClearanceStatus, EmployeeDto, ExpenseDto, InvoiceListItemDto, PaymentDirection, PaymentDto } from "../types";
import { PartnerAutocomplete } from "../components/PartnerAutocomplete";
import { formatCurrency, formatDate, todayLocalDateString, PAYMENT_DIRECTION_LABELS } from "../lib/format";
import { apiErrorMessage } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useSelection } from "../lib/useSelection";
import { runBulkDelete, summarizeBulkDelete } from "../lib/bulkDelete";
import { usePagination } from "../lib/usePagination";
import { TablePagination } from "../components/TablePagination";
import { CHECK_METHOD, PAYMENT_METHOD_OPTIONS, PaymentLineFields, emptyLine, lineTotal, paymentRequestsFromLine, validatePaymentLine } from "../components/PaymentLineFields";
import type { PaymentLine } from "../components/PaymentLineFields";
import { InvoiceLink, PartnerLink } from "../components/RecordLinks";
import { PdfActions } from "../components/PdfActions";

export function PaymentsPage() {
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<"payments" | "expenses">("payments");

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">الدفعات والمصاريف</h1>
      <div className="flex gap-2 mb-4">
        <button className={tab === "payments" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("payments")}>الدفعات</button>
        <button className={tab === "expenses" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("expenses")}>مصاريف الحسبة</button>
      </div>
      {tab === "payments" ? (
        <PaymentsTab
          canCreate={hasPermission("payments.create")}
          canEdit={hasPermission("payments.edit")}
          canDelete={hasPermission("payments.delete")}
        />
      ) : (
        <ExpensesTab
          canCreate={hasPermission("expenses.create")}
          canEdit={hasPermission("expenses.edit")}
          canDelete={hasPermission("expenses.delete")}
        />
      )}
    </div>
  );
}

function PaymentsTab({ canCreate, canEdit, canDelete }: { canCreate: boolean; canEdit: boolean; canDelete: boolean }) {
  const showActionsColumn = canEdit || canDelete;
  const [payments, setPayments] = useState<PaymentDto[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PaymentDto | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const selection = useSelection();
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Paged in the browser: the fetch pulls a generous slice and the table shows one page of it, so
  // a busy day's payments stay readable instead of scrolling forever (see lib/usePagination).
  const pager = usePagination(payments);

  async function refresh() {
    const result = await listPayments({ pageSize: 500 });
    setPayments(result.items);
  }

  useEffect(() => { refresh(); }, []);

  async function handleDelete(p: PaymentDto) {
    if (!window.confirm(`حذف دفعة ${formatCurrency(p.amount)} لـ ${p.partnerName}؟`)) return;
    try {
      await deletePayment(p.id);
      refresh();
    } catch (err) {
      alert(apiErrorMessage(err, "فشل الحذف"));
    }
  }

  async function handleBulkDelete() {
    const selected = payments.filter((p) => selection.selected.has(p.id));
    if (selected.length === 0) return;
    if (!window.confirm(`حذف ${selected.length} دفعة محددة؟ لا يمكن التراجع عن هذا.`)) return;
    setBulkDeleting(true);
    setBulkError(null);
    const outcome = await runBulkDelete(selected, (p) => p.id, (p) => `${formatCurrency(p.amount)} - ${p.partnerName}`, deletePayment);
    setBulkDeleting(false);
    selection.clear();
    await refresh();
    if (outcome.failedCount > 0) setBulkError(summarizeBulkDelete(outcome));
  }


  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {canCreate && (
          <button className="btn-primary" onClick={() => setShowForm(true)}>+ تسجيل دفعة</button>
        )}
        <Link to="/checks" className="btn-secondary">📅 الشيكات</Link>
        <PdfActions
          fetchPdf={() => printPaymentsListPdf({})}
          fileName={`payments-${todayLocalDateString()}.pdf`}
          shareTitle="قائمة الدفعات"
        />
      </div>

      {bulkError && <div className="text-sm text-red-600 bg-red-50 rounded-md p-3 mb-4 whitespace-pre-line">{bulkError}</div>}

      {canDelete && selection.selected.size > 0 && (
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-gray-600">محدد: <span className="font-semibold">{selection.selected.size}</span></span>
          <button className="btn-danger text-sm" disabled={bulkDeleting} onClick={handleBulkDelete}>
            {bulkDeleting ? "جاري الحذف..." : `حذف المحدد (${selection.selected.size})`}
          </button>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              {canDelete && (
                <th className="w-8">
                  <input
                    type="checkbox"
                    checked={pager.pageRows.length > 0 && pager.pageRows.every((p) => selection.selected.has(p.id))}
                    onChange={() => selection.toggleAll(pager.pageRows.map((p) => p.id))}
                  />
                </th>
              )}
              <th>التاريخ</th><th>الشخص</th><th>الاتجاه</th><th>المبلغ</th><th>الفاتورة</th><th>طريقة الدفع</th><th>ملاحظات</th>{showActionsColumn && <th></th>}
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <tr><td colSpan={(showActionsColumn ? 8 : 7) + (canDelete ? 1 : 0)} className="text-center text-gray-400 py-6">لا توجد دفعات</td></tr>
            ) : pager.pageRows.map((p) => (
              <tr key={p.id}>
                {canDelete && (
                  <td>
                    <input type="checkbox" checked={selection.selected.has(p.id)} onChange={() => selection.toggleOne(p.id)} />
                  </td>
                )}
                <td>{formatDate(p.date)}</td>
                <td>
                  {/* FromMerchant settles a buyer's account; ToFarmer/ToDriver settle a
                      seller's or driver's — so the direction already says which of the two
                      account pages this name belongs to. */}
                  <PartnerLink
                    partnerId={p.partnerId} name={p.partnerName}
                    side={p.direction === "FromMerchant" ? "merchant" : "seller"}
                  />
                </td>
                <td>{PAYMENT_DIRECTION_LABELS[p.direction]}</td>
                <td className="font-medium">{formatCurrency(p.amount)}</td>
                <td className="text-sm">
                  {/* The invoice this payment settles — the number was already on screen, it
                      just wasn't clickable, so "which invoice was this?" meant going to the
                      invoices list and finding it by hand. */}
                  <InvoiceLink invoiceId={p.invoiceId} invoiceNumber={p.invoiceNumber} />
                </td>
                <td>
                  {p.method || "—"}
                  {p.checkDueDate && (
                    <div className="text-xs text-gray-400">يستحق: {formatDate(p.checkDueDate)}</div>
                  )}
                </td>
                <td className="text-gray-500">{p.notes || "—"}</td>
                {showActionsColumn && (
                  <td className="whitespace-nowrap">
                    {canEdit && <button className="text-brand-700 text-sm hover:underline ms-2" onClick={() => setEditing(p)}>تعديل</button>}
                    {canDelete && <button className="text-red-500 text-sm hover:underline ms-2" onClick={() => handleDelete(p)}>حذف</button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <TablePagination
          page={pager.page} pageSize={pager.pageSize} totalCount={pager.totalCount}
          itemLabel="دفعة" onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize}
        />
      </div>

      {showForm && <PaymentFormModal onClose={() => setShowForm(false)} onSaved={refresh} />}
      {editing && <PaymentEditModal payment={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </div>
  );
}

/** Shared invoice-link picker: lists the selected partner's own invoices (merchant/farmer/driver
 * side depending on direction) so a payment can optionally be tied to one specific invoice
 * instead of only reducing the partner's aggregate balance. */
function InvoiceLinkPicker({ partnerId, direction, invoiceId, onChange }: {
  partnerId: number | null;
  direction: PaymentDirection;
  invoiceId: number | null;
  onChange: (id: number | null) => void;
}) {
  const [invoices, setInvoices] = useState<InvoiceListItemDto[]>([]);

  useEffect(() => {
    if (!partnerId) { setInvoices([]); onChange(null); return; }
    // Three separate directions now (see PaymentDirection's doc comment) — each one only ever
    // queries its own matching side, instead of the old "ToFarmer" merge of farmer + driver.
    if (direction === "FromMerchant") {
      listInvoices({ merchantId: partnerId, pageSize: 100 }).then((r) => setInvoices(r.items));
    } else if (direction === "ToFarmer") {
      listInvoices({ farmerId: partnerId, pageSize: 100 }).then((r) => setInvoices(r.items));
    } else {
      listInvoices({ driverId: partnerId, pageSize: 100 }).then((r) => setInvoices(r.items));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnerId, direction]);

  if (!partnerId) return null;

  return (
    <div>
      <label className="label">ربط بفاتورة محددة (اختياري)</label>
      <select className="input" value={invoiceId ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">بدون ربط (يخفض الرصيد العام)</option>
        {invoices.map((inv) => (
          <option key={inv.id} value={inv.id}>{inv.invoiceNumber} — {formatDate(inv.date)} — {formatCurrency(inv.totalValue)}</option>
        ))}
      </select>
    </div>
  );
}

function PaymentFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [partner, setPartner] = useState<{ id: number; name: string } | null>(null);
  const [partnerText, setPartnerText] = useState("");
  const [direction, setDirection] = useState<PaymentDirection>("ToFarmer");
  const [invoiceId, setInvoiceId] = useState<number | null>(null);
  // Several lines = the same payment split across methods at once (e.g. part نقدي + part شيك
  // against the same invoice) — each becomes its own Payment row on save, all sharing the same
  // partner/direction/invoice/date/notes below.
  const [lines, setLines] = useState<PaymentLine[]>([emptyLine()]);
  const [date, setDate] = useState(() => todayLocalDateString());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);

  function updateLine(index: number, patch: Partial<PaymentLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }
  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    const partnerName = partnerText.trim();
    if (!partner && !partnerName) { setError("يرجى إدخال اسم الشخص"); return; }
    for (const [i, line] of lines.entries()) {
      const problem = validatePaymentLine(line, `السطر ${i + 1}`);
      if (problem) { setError(problem); return; }
      if (lineTotal(line) <= 0) { setError(`السطر ${i + 1}: المبلغ يجب أن يكون أكبر من صفر`); return; }
    }
    setBusy(true);
    setError(null);
    try {
      for (const [i, line] of lines.entries()) {
        try {
          // A شيك line fans out into one Payment row per check, so each shows up and clears
          // independently on the "الشيكات" page — see paymentRequestsFromLine.
          for (const request of paymentRequestsFromLine(line)) {
            await createPayment({
              partnerId: partner?.id,
              partnerName: partner ? undefined : partnerName,
              direction, amount: request.amount, date: new Date(date).toISOString(),
              method: request.method, notes: notes || undefined,
              invoiceId: partner ? invoiceId : null,
              checkDueDate: request.checkDueDate,
              checkNumber: request.checkNumber,
            });
          }
        } catch (err) {
          throw new Error(`السطر ${i + 1}: ${apiErrorMessage(err, "فشل الحفظ")}${i > 0 ? " — الأسطر السابقة انحفظت فعليًا" : ""}`);
        }
      }
      onSaved();
      // Stay open for the next payment (direction/date carried over — usually the same for a run
      // of entries — only the person/notes/invoice-link/lines reset).
      setPartner(null); setPartnerText(""); setNotes(""); setInvoiceId(null); setLines([emptyLine()]);
      setJustAdded(true);
      setSavedOnce(true);
      setTimeout(() => setJustAdded(false), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : apiErrorMessage(err, "فشل تسجيل الدفعة"));
    } finally {
      setBusy(false);
    }
  }

  const linesTotal = lines.reduce((sum, l) => sum + lineTotal(l), 0);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-4">تسجيل دفعة</h2>
        <div className="space-y-3">
          <div>
            <label className="label">الاتجاه</label>
            <select
              className="input"
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value as PaymentDirection);
                setInvoiceId(null);
                // The person picked under the old direction is very likely the wrong partner type
                // for the new one (e.g. switching من "للبائع" إلى "للسائق") — clear it instead of
                // silently keeping a mismatched selection around.
                setPartner(null);
                setPartnerText("");
              }}
            >
              <option value="ToFarmer">دفعة للبائع (يخفض مستحقاته)</option>
              <option value="ToDriver">دفعة للسائق (يخفض مستحقاته)</option>
              <option value="FromMerchant">دفعة من المشتري (تخفض دينه)</option>
            </select>
          </div>
          <PartnerAutocomplete
            label="الشخص"
            value={partner}
            onChange={setPartner}
            allowNew
            text={partnerText}
            onFreeTextChange={setPartnerText}
            // ToDriver lists sellers as well — the man who hauls his own produce is one account,
            // and paying him here grants him the driver role rather than making a second record.
            types={direction === "FromMerchant" ? ["Merchant"] : direction === "ToFarmer" ? ["Farmer"] : ["Driver", "Farmer"]}
            // The chosen direction is what decides which side a new name is created as — the same
            // mapping the backend applies to PartnerName (see PaymentService.ResolvePartnerAsync).
            newTypeLabel={direction === "FromMerchant" ? "مشتري" : direction === "ToFarmer" ? "بائع" : "سائق"}
          />
          <InvoiceLinkPicker partnerId={partner?.id ?? null} direction={direction} invoiceId={invoiceId} onChange={setInvoiceId} />
          <div>
            <label className="label">التاريخ</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="label mb-0">طريقة/طرق الدفع</label>
              {lines.length > 1 && <span className="text-xs text-gray-400">المجموع: {formatCurrency(linesTotal)}</span>}
            </div>
            {lines.map((line, i) => (
              <PaymentLineFields key={i} line={line} onChange={(patch) => updateLine(i, patch)} onRemove={() => removeLine(i)} showRemove={lines.length > 1} />
            ))}
            <button type="button" className="text-sm text-brand-700 hover:underline" onClick={addLine}>
              + إضافة طريقة دفع أخرى لنفس الدفعة (مثلاً: جزء نقدي وجزء شيكات)
            </button>
          </div>

          <div>
            <label className="label">ملاحظات</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {justAdded && <div className="text-sm text-brand-700">✅ تم تسجيل الدفعة — تابع بدفعة جديدة أو اضغط "تم"</div>}
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button className="btn-secondary" onClick={onClose}>{savedOnce ? "تم" : "إلغاء"}</button>
          <button className="btn-primary" onClick={handleSave} disabled={busy}>{busy ? "جاري الحفظ..." : "حفظ"}</button>
        </div>
      </div>
    </div>
  );
}

function PaymentEditModal({ payment, onClose, onSaved }: { payment: PaymentDto; onClose: () => void; onSaved: () => void }) {
  const [invoiceId, setInvoiceId] = useState<number | null>(payment.invoiceId ?? null);
  const [amount, setAmount] = useState(String(payment.amount));
  const [date, setDate] = useState(payment.date.slice(0, 10));
  // A known method (نقدي/حوالة/شيك) selects directly; anything else (including a payment saved
  // before this picker existed) falls into "أخرى" with its original text preserved.
  const knownMethod = payment.method != null && PAYMENT_METHOD_OPTIONS.slice(0, -1).includes(payment.method);
  const [method, setMethod] = useState(knownMethod ? payment.method! : (payment.method ? "أخرى" : "نقدي"));
  const [customMethod, setCustomMethod] = useState(knownMethod ? "" : (payment.method ?? ""));
  const [checkDueDate, setCheckDueDate] = useState(payment.checkDueDate ? payment.checkDueDate.slice(0, 10) : "");
  const [checkNumber, setCheckNumber] = useState(payment.checkNumber ?? "");
  const [checkStatus, setCheckStatus] = useState<CheckClearanceStatus>(payment.checkStatus ?? "Pending");
  // Only ever meaningful while checkStatus === "Cleared" — the actual date the check was
  // cashed/deposited, distinct from checkDueDate (the nominal due date). Defaults to today the
  // first time a check is marked Cleared, if it doesn't already have one.
  const [checkClearedDate, setCheckClearedDate] = useState(payment.checkClearedDate ? payment.checkClearedDate.slice(0, 10) : "");
  const [notes, setNotes] = useState(payment.notes ?? "");
  // Extra methods/checks to record ALONGSIDE this row, for "دفعت كمان شيكين على نفس الدفعة".
  // Each one is saved as its own new payment (same person/direction/invoice/date), because that's
  // how a split payment is stored everywhere else — this row itself stays exactly one check.
  const [extraLines, setExtraLines] = useState<PaymentLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isCheck = method === CHECK_METHOD;
  const isCleared = checkStatus === "Cleared";

  function handleCheckStatusChange(next: CheckClearanceStatus) {
    setCheckStatus(next);
    if (next === "Cleared" && !checkClearedDate) setCheckClearedDate(todayLocalDateString());
  }

  function updateExtraLine(index: number, patch: Partial<PaymentLine>) {
    setExtraLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function handleSave() {
    const amountValue = parseFloat(amount);
    if (!amountValue || amountValue <= 0) { setError("المبلغ يجب أن يكون أكبر من صفر"); return; }
    if (isCheck && !checkDueDate) { setError("تاريخ استحقاق الشيك مطلوب"); return; }
    if (method === "أخرى" && !customMethod.trim()) { setError("يرجى تحديد طريقة الدفع"); return; }
    for (const [i, line] of extraLines.entries()) {
      const problem = validatePaymentLine(line, `الإضافة ${i + 1}`);
      if (problem) { setError(problem); return; }
      if (lineTotal(line) <= 0) { setError(`الإضافة ${i + 1}: المبلغ يجب أن يكون أكبر من صفر`); return; }
    }
    setBusy(true);
    setError(null);
    try {
      await updatePayment(payment.id, {
        amount: amountValue, date: new Date(date).toISOString(),
        method: (method === "أخرى" ? customMethod.trim() : method) || undefined, notes: notes || undefined, invoiceId,
        checkDueDate: isCheck ? new Date(checkDueDate).toISOString() : null,
        checkNumber: isCheck ? (checkNumber || undefined) : undefined,
        checkStatus: isCheck ? checkStatus : null,
        checkClearedDate: isCheck && isCleared && checkClearedDate ? new Date(checkClearedDate).toISOString() : null,
      });
      // Only after the edit itself lands, so a rejected edit doesn't leave new rows behind for a
      // payment that never changed.
      for (const [i, line] of extraLines.entries()) {
        try {
          for (const request of paymentRequestsFromLine(line)) {
            await createPayment({
              partnerId: payment.partnerId, direction: payment.direction,
              amount: request.amount, date: new Date(date).toISOString(),
              method: request.method, notes: notes || undefined, invoiceId,
              checkDueDate: request.checkDueDate, checkNumber: request.checkNumber,
            });
          }
        } catch (err) {
          throw new Error(`تم حفظ التعديل، لكن تعذر إضافة (الإضافة ${i + 1}): ${apiErrorMessage(err, "فشل الحفظ")}`);
        }
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : apiErrorMessage(err, "فشل الحفظ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-4">تعديل دفعة — {payment.partnerName}</h2>
        <div className="space-y-3">
          <InvoiceLinkPicker partnerId={payment.partnerId} direction={payment.direction} invoiceId={invoiceId} onChange={setInvoiceId} />
          <div>
            <label className="label">المبلغ (₪)</label>
            <input className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="label">التاريخ</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label">طريقة الدفع</label>
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHOD_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          {method === "أخرى" && (
            <div>
              <label className="label">حدد طريقة الدفع</label>
              <input className="input" value={customMethod} onChange={(e) => setCustomMethod(e.target.value)} />
            </div>
          )}
          {isCheck && (
            <>
              <div>
                <label className="label">تاريخ استحقاق الشيك</label>
                <input className="input" type="date" value={checkDueDate} onChange={(e) => setCheckDueDate(e.target.value)} />
              </div>
              <div>
                <label className="label">رقم الشيك (اختياري)</label>
                <input className="input" value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} />
              </div>
              <div>
                <label className="label">حالة الشيك</label>
                <select className="input" value={checkStatus} onChange={(e) => handleCheckStatusChange(e.target.value as CheckClearanceStatus)}>
                  <option value="Pending">قيد التحصيل</option>
                  <option value="Cleared">تم الصرف</option>
                  <option value="Bounced">مرتجع</option>
                </select>
              </div>
              {isCleared && (
                <div>
                  <label className="label">تاريخ الصرف الفعلي</label>
                  <input className="input" type="date" value={checkClearedDate} onChange={(e) => setCheckClearedDate(e.target.value)} />
                </div>
              )}
            </>
          )}

          {/* Adding to an existing payment: extra methods, or extra checks on top of this one.
              Each becomes its own new payment row for the same person/invoice/date. */}
          <div className="space-y-2 border-t border-gray-200 pt-3">
            {extraLines.length > 0 && <label className="label mb-0">إضافات على نفس الدفعة</label>}
            {extraLines.map((line, i) => (
              <PaymentLineFields
                key={i} line={line} onChange={(patch) => updateExtraLine(i, patch)}
                onRemove={() => setExtraLines((prev) => prev.filter((_, index) => index !== i))} showRemove
              />
            ))}
            <button type="button" className="text-sm text-brand-700 hover:underline"
              onClick={() => setExtraLines((prev) => [...prev, emptyLine()])}>
              + إضافة شيكات أو طريقة دفع أخرى على نفس الدفعة
            </button>
          </div>

          <div>
            <label className="label">ملاحظات</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button className="btn-secondary" onClick={onClose}>إلغاء</button>
          <button className="btn-primary" onClick={handleSave} disabled={busy}>{busy ? "جاري الحفظ..." : "حفظ"}</button>
        </div>
      </div>
    </div>
  );
}

/** Simple dropdown of active employees for "attribute this expense/withdrawal to" — a plain
 * <select> rather than an autocomplete since the employee list is a short, internal staff
 * roster (unlike partners, which can run into the hundreds). Only active employees are offered
 * for NEW entries; an edit modal also injects the currently-linked employee even if since made
 * inactive, so switching away from them isn't forced just to save an unrelated edit. */
function EmployeeSelect({ employeeId, onChange, currentName }: {
  employeeId: number | null;
  onChange: (id: number | null) => void;
  currentName?: string | null;
}) {
  const [employees, setEmployees] = useState<EmployeeDto[]>([]);

  useEffect(() => {
    listEmployees({ activeOnly: true }).then(setEmployees);
  }, []);

  const hasCurrentInList = employeeId != null && employees.some((e) => e.id === employeeId);

  return (
    <div>
      <label className="label">الموظف (اختياري — لتتبع كم أُعطي له)</label>
      <select className="input" value={employeeId ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">بدون موظف</option>
        {!hasCurrentInList && employeeId != null && (
          <option value={employeeId}>{currentName ?? `#${employeeId}`} (غير نشط)</option>
        )}
        {employees.map((emp) => (
          <option key={emp.id} value={emp.id}>{emp.name}</option>
        ))}
      </select>
    </div>
  );
}

function ExpensesTab({ canCreate, canEdit, canDelete }: { canCreate: boolean; canEdit: boolean; canDelete: boolean }) {
  const showActionsColumn = canEdit || canDelete;
  const [expenses, setExpenses] = useState<ExpenseDto[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ExpenseDto | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const selection = useSelection();
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Same browser-side paging as the payments tab above.
  const pager = usePagination(expenses);

  async function refresh() {
    const result = await listExpenses({ pageSize: 500 });
    setExpenses(result.items);
  }

  useEffect(() => { refresh(); }, []);

  async function handleDelete(e: ExpenseDto) {
    if (!window.confirm(`حذف مصروف "${e.description}" بقيمة ${formatCurrency(e.amount)}؟`)) return;
    try {
      await deleteExpense(e.id);
      refresh();
    } catch (err) {
      alert(apiErrorMessage(err, "فشل الحذف"));
    }
  }

  async function handleBulkDelete() {
    const selected = expenses.filter((e) => selection.selected.has(e.id));
    if (selected.length === 0) return;
    if (!window.confirm(`حذف ${selected.length} مصروف محدد؟ لا يمكن التراجع عن هذا.`)) return;
    setBulkDeleting(true);
    setBulkError(null);
    const outcome = await runBulkDelete(selected, (e) => e.id, (e) => e.description, deleteExpense);
    setBulkDeleting(false);
    selection.clear();
    await refresh();
    if (outcome.failedCount > 0) setBulkError(summarizeBulkDelete(outcome));
  }


  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {canCreate && <button className="btn-primary" onClick={() => setShowForm(true)}>+ إضافة مصروف</button>}
        <PdfActions
          fetchPdf={() => printExpensesPdf({})}
          fileName={`expenses-${todayLocalDateString()}.pdf`}
          shareTitle="قائمة المصاريف"
        />
      </div>

      {bulkError && <div className="text-sm text-red-600 bg-red-50 rounded-md p-3 mb-4 whitespace-pre-line">{bulkError}</div>}

      {canDelete && selection.selected.size > 0 && (
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-gray-600">محدد: <span className="font-semibold">{selection.selected.size}</span></span>
          <button className="btn-danger text-sm" disabled={bulkDeleting} onClick={handleBulkDelete}>
            {bulkDeleting ? "جاري الحذف..." : `حذف المحدد (${selection.selected.size})`}
          </button>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              {canDelete && (
                <th className="w-8">
                  <input
                    type="checkbox"
                    checked={pager.pageRows.length > 0 && pager.pageRows.every((e) => selection.selected.has(e.id))}
                    onChange={() => selection.toggleAll(pager.pageRows.map((e) => e.id))}
                  />
                </th>
              )}
              <th>التاريخ</th><th>الوصف</th><th>الفئة</th><th>الموظف</th><th>المبلغ</th>{showActionsColumn && <th></th>}
            </tr>
          </thead>
          <tbody>
            {expenses.length === 0 ? (
              <tr><td colSpan={(showActionsColumn ? 6 : 5) + (canDelete ? 1 : 0)} className="text-center text-gray-400 py-6">لا توجد مصاريف</td></tr>
            ) : pager.pageRows.map((e) => (
              <tr key={e.id}>
                {canDelete && (
                  <td>
                    <input type="checkbox" checked={selection.selected.has(e.id)} onChange={() => selection.toggleOne(e.id)} />
                  </td>
                )}
                <td>{formatDate(e.date)}</td>
                <td>{e.description}</td>
                <td>{e.category || "—"}</td>
                <td>{e.employeeName || "—"}</td>
                <td className="font-medium">{formatCurrency(e.amount)}</td>
                {showActionsColumn && (
                  <td className="whitespace-nowrap">
                    {canEdit && <button className="text-brand-700 text-sm hover:underline ms-2" onClick={() => setEditing(e)}>تعديل</button>}
                    {canDelete && <button className="text-red-500 text-sm hover:underline ms-2" onClick={() => handleDelete(e)}>حذف</button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <TablePagination
          page={pager.page} pageSize={pager.pageSize} totalCount={pager.totalCount}
          itemLabel="مصروف" onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize}
        />
      </div>
      {showForm && <ExpenseFormModal onClose={() => setShowForm(false)} onSaved={refresh} />}
      {editing && <ExpenseEditModal expense={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </div>
  );
}

function ExpenseFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [date, setDate] = useState(() => todayLocalDateString());
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const descRef = useRef<HTMLInputElement>(null);

  async function handleSave() {
    if (!description.trim()) { setError("الوصف مطلوب"); return; }
    const amountValue = parseFloat(amount);
    if (isNaN(amountValue) || amountValue < 0) { setError("المبلغ غير صحيح"); return; }
    setBusy(true);
    setError(null);
    try {
      await createExpense({ date: new Date(date).toISOString(), description, amount: amountValue, category: category || undefined, employeeId });
      onSaved();
      // Stay open for the next expense (category/date/employee carried over, description/amount reset).
      setDescription(""); setAmount("");
      setJustAdded(true);
      setSavedOnce(true);
      descRef.current?.focus();
      setTimeout(() => setJustAdded(false), 1200);
    } catch (err) {
      setError(apiErrorMessage(err, "فشل حفظ المصروف"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-4">إضافة مصروف</h2>
        <div className="space-y-3">
          <div><label className="label">الوصف</label><input ref={descRef} className="input" value={description} onChange={(e) => setDescription(e.target.value)} autoFocus /></div>
          <div><label className="label">المبلغ (₪)</label><input className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><label className="label">الفئة</label><input className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="كهرباء / إيجار / صيانة / سحب..." /></div>
          <div><label className="label">التاريخ</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <EmployeeSelect employeeId={employeeId} onChange={setEmployeeId} />
          {justAdded && <div className="text-sm text-brand-700">✅ تم حفظ المصروف — تابع بمصروف جديد أو اضغط "تم"</div>}
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button className="btn-secondary" onClick={onClose}>{savedOnce ? "تم" : "إلغاء"}</button>
          <button className="btn-primary" onClick={handleSave} disabled={busy}>{busy ? "جاري الحفظ..." : "حفظ"}</button>
        </div>
      </div>
    </div>
  );
}

function ExpenseEditModal({ expense, onClose, onSaved }: { expense: ExpenseDto; onClose: () => void; onSaved: () => void }) {
  const [description, setDescription] = useState(expense.description);
  const [amount, setAmount] = useState(String(expense.amount));
  const [category, setCategory] = useState(expense.category ?? "");
  const [date, setDate] = useState(expense.date.slice(0, 10));
  const [employeeId, setEmployeeId] = useState<number | null>(expense.employeeId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    if (!description.trim()) { setError("الوصف مطلوب"); return; }
    const amountValue = parseFloat(amount);
    if (isNaN(amountValue) || amountValue < 0) { setError("المبلغ غير صحيح"); return; }
    setBusy(true);
    setError(null);
    try {
      await updateExpense(expense.id, { date: new Date(date).toISOString(), description, amount: amountValue, category: category || undefined, employeeId });
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err, "فشل الحفظ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-4">تعديل مصروف</h2>
        <div className="space-y-3">
          <div><label className="label">الوصف</label><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} autoFocus /></div>
          <div><label className="label">المبلغ (₪)</label><input className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><label className="label">الفئة</label><input className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="كهرباء / إيجار / صيانة / سحب..." /></div>
          <div><label className="label">التاريخ</label><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <EmployeeSelect employeeId={employeeId} onChange={setEmployeeId} currentName={expense.employeeName} />
          {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button className="btn-secondary" onClick={onClose}>إلغاء</button>
          <button className="btn-primary" onClick={handleSave} disabled={busy}>{busy ? "جاري الحفظ..." : "حفظ"}</button>
        </div>
      </div>
    </div>
  );
}
