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
import { CollapsibleRows } from "../components/CollapsibleRows";
import { CHECK_METHOD, PAYMENT_METHOD_OPTIONS, PaymentLineFields, emptyLine, lineTotal, paymentRequestsFromLine, validatePaymentLine } from "../components/PaymentLineFields";
import type { PaymentLine } from "../components/PaymentLineFields";
import { InvoiceLink, PartnerLink } from "../components/RecordLinks";
import { PdfActions } from "../components/PdfActions";
import { useColumnFilters } from "../lib/useColumnFilters";
import type { ColumnFilterSpec } from "../lib/columnFilters";
import { ColumnFilterRow, ColumnFilterSummary } from "../components/ColumnFilterRow";
import { BulkEditDialog } from "../components/BulkEditDialog";
import type { BulkEditField } from "../components/BulkEditDialog";
import { OffsetDialog } from "../components/OffsetDialog";

// Module-level: useColumnFilters memoizes on the array identity, and these never vary.
//
// Both tables filter the date as yyyy-mm-dd text rather than a Date — a payment written at
// 20:00 local must not answer a "on the 9th" filter with the 8th because something re-read its
// timestamp as UTC. Same reasoning as the dateRange kind itself.
const PAYMENT_FILTERS: ColumnFilterSpec<PaymentDto>[] = [
  { key: "date", kind: "dateRange", value: (p) => p.date },
  { key: "partner", kind: "text", value: (p) => p.partnerName },
  { key: "direction", kind: "select", value: (p) => PAYMENT_DIRECTION_LABELS[p.direction] },
  { key: "amount", kind: "numberRange", value: (p) => p.amount },
  { key: "invoice", kind: "text", value: (p) => p.invoiceNumber ?? "" },
  { key: "method", kind: "select", value: (p) => p.method ?? "" },
  { key: "notes", kind: "text", value: (p) => p.notes ?? "" },
];

const EXPENSE_FILTERS: ColumnFilterSpec<ExpenseDto>[] = [
  { key: "date", kind: "dateRange", value: (e) => e.date },
  { key: "description", kind: "text", value: (e) => e.description },
  { key: "category", kind: "select", value: (e) => e.category ?? "" },
  { key: "employee", kind: "select", value: (e) => e.employeeName ?? "" },
  { key: "amount", kind: "numberRange", value: (e) => e.amount },
];

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
  // "مقاصّة" — see components/OffsetDialog. It writes two ordinary payments, so it belongs to
  // payments.create like any other.
  const [offsetting, setOffsetting] = useState(false);
  const showActionsColumn = canEdit || canDelete;
  const [payments, setPayments] = useState<PaymentDto[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PaymentDto | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const selection = useSelection();
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkEditing, setBulkEditing] = useState(false);
  const filters = useColumnFilters(payments, PAYMENT_FILTERS);

  // Paged in the browser: the fetch pulls a generous slice and the table shows one page of it, so
  // a busy day's payments stay readable instead of scrolling forever (see lib/usePagination).
  // Filter first, paginate the result — the other order narrows one page and reports it as the
  // answer for the whole list.
  const pager = usePagination(filters.rows);

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


  // Only the date.
  //
  // طريقة الدفع is deliberately absent even though it looks like an innocent attribute: a شيك
  // carries a due date, a number and a clearance status, and PaymentRules decides from those when
  // it counts against a balance. Switching a batch INTO شيك would invent checks with no number and
  // no due date; switching a batch OUT of it would strand the ones already recorded. Either way
  // money moves, which is the one thing bulk edit here does not do.
  const paymentBulkFields: BulkEditField<PaymentDto>[] = [
    {
      key: "date", label: "التاريخ", kind: "date",
      current: (p) => p.date.slice(0, 10),
      apply: (p, v) => updatePayment(p.id, {
        amount: p.amount, date: new Date(v).toISOString(), method: p.method ?? undefined,
        notes: p.notes ?? undefined, invoiceId: p.invoiceId ?? null,
        checkDueDate: p.checkDueDate ?? null, checkNumber: p.checkNumber ?? null,
        checkStatus: p.checkStatus ?? null, checkClearedDate: p.checkClearedDate ?? null,
      }).then(() => undefined),
    },
  ];

  /**
   * A row's own buttons. Defined once and rendered twice — in the desktop row and on the
   * phone's card — because a button that exists on only one of them is a button half the
   * market does not have, and the half that goes missing is always the phone's.
   */
  function rowActions(p: PaymentDto) {
    if (!canEdit && !canDelete) return null;
    return (
      <span className="flex flex-wrap gap-3">
        {canEdit && <button className="btn-link text-brand-700 text-sm hover:underline" onClick={() => setEditing(p)}>تعديل</button>}
        {canDelete && <button className="btn-link text-red-500 text-sm hover:underline" onClick={() => handleDelete(p)}>حذف</button>}
      </span>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {canCreate && (
          <button className="btn-primary" onClick={() => setShowForm(true)}>+ تسجيل دفعة</button>
        )}
        {/* For the man who is a seller and a buyer at once — the market has always had them, and
            until now it counted cash out to him and back in from him on the same day. */}
        {canCreate && (
          <button className="btn-secondary" onClick={() => setOffsetting(true)}>⇄ مقاصّة</button>
        )}
        <Link to="/checks" className="btn-secondary">📅 الشيكات</Link>
        <PdfActions
          fetchPdf={() => printPaymentsListPdf({})}
          fileName={`payments-${todayLocalDateString()}.pdf`}
          shareTitle="قائمة الدفعات"
        />
      </div>

      {bulkError && <div className="text-sm text-red-600 bg-red-50 rounded-md p-3 mb-4 whitespace-pre-line">{bulkError}</div>}

      {selection.selected.size > 0 && (canDelete || canEdit) && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <span className="text-sm text-gray-600">محدد: <span className="font-semibold">{selection.selected.size}</span></span>
          {canEdit && (
            <button className="btn-secondary text-sm" onClick={() => setBulkEditing(true)}>
              تعديل المحدد ({selection.selected.size})
            </button>
          )}
          {canDelete && (
            <button className="btn-danger text-sm" disabled={bulkDeleting} onClick={handleBulkDelete}>
              {bulkDeleting ? "جاري الحذف..." : `حذف المحدد (${selection.selected.size})`}
            </button>
          )}
        </div>
      )}

      {bulkEditing && (
        <BulkEditDialog
          rows={payments.filter((p) => selection.selected.has(p.id))}
          fields={paymentBulkFields}
          label={(p) => `${p.partnerName} — ${formatCurrency(p.amount)}`}
          onClose={() => setBulkEditing(false)}
          onDone={async (message) => { setBulkError(message); selection.clear(); await refresh(); }}
        />
      )}

      <ColumnFilterSummary filters={filters} />

      <div className="card">
        <div className="sm:hidden">
          <CollapsibleRows
            rows={pager.pageRows}
            rowKey={(p) => p.id}
            title={(p) => p.partnerName}
            value={(p) => formatCurrency(p.amount)}
            leading={canDelete ? (p) => (
              <input type="checkbox" checked={selection.selected.has(p.id)} onChange={() => selection.toggleOne(p.id)} />
            ) : undefined}
            details={(p) => [
              { label: "التاريخ", value: formatDate(p.date) },
              { label: "الاتجاه", value: PAYMENT_DIRECTION_LABELS[p.direction] },
              { label: "الفاتورة", value: p.invoiceNumber || "—" },
              { label: "طريقة الدفع", value: p.method || "—" },
              { label: "ملاحظات", value: p.notes || "—" },
              ...(canEdit || canDelete ? [{ label: "", value: rowActions(p) }] : []),
            ]}
            empty="لا توجد دفعات"
          />
        </div>
        <div className="hidden sm:block overflow-x-auto">
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
            <ColumnFilterRow
              columns={[
                ...(canDelete ? [null] : []),
                "date", "partner", "direction", "amount", "invoice", "method", "notes",
                ...(showActionsColumn ? [null] : []),
              ]}
              specs={PAYMENT_FILTERS}
              filters={filters}
              rows={payments}
            />
          </thead>
          <tbody>
            {filters.rows.length === 0 ? (
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
                <td className="text-gray-500">
                  {/* Said on the row, not just in the method column: somebody counting the day's
                      cash has to be able to see at a glance that this one moved none. */}
                  {p.offsetGroupId && (
                    <span className="inline-block text-xs bg-brand-50 text-brand-800 border border-brand-200 rounded px-1.5 py-0.5 me-2">
                      مقاصّة — بدون كاش
                    </span>
                  )}
                  {p.notes || "—"}
                </td>
                {showActionsColumn && <td className="whitespace-nowrap">{rowActions(p)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <TablePagination
          page={pager.page} pageSize={pager.pageSize} totalCount={pager.totalCount}
          itemLabel="دفعة" onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize}
        />
      </div>

      {showForm && <PaymentFormModal onClose={() => setShowForm(false)} onSaved={refresh} />}
      {editing && <PaymentEditModal payment={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}

      {offsetting && (
        <OffsetDialog onClose={() => setOffsetting(false)} onSaved={() => { setOffsetting(false); refresh(); }} />
      )}
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
    <div className="modal-backdrop">
      <div className="modal-card p-6">
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
            <button type="button" className="btn-link text-sm text-brand-700 hover:underline" onClick={addLine}>
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
    <div className="modal-backdrop">
      <div className="modal-card sm:max-w-md p-6">
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
            <button type="button" className="btn-link text-sm text-brand-700 hover:underline"
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
  const [bulkEditing, setBulkEditing] = useState(false);
  const filters = useColumnFilters(expenses, EXPENSE_FILTERS);

  // Same browser-side paging as the payments tab above, over the FILTERED rows.
  const pager = usePagination(filters.rows);

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

  // Attributes only. The amount is not here and will not be: setting thirty expenses to the
  // same figure is not a correction, it is a fabrication, and it would move the day's closing.
  const expenseBulkFields: BulkEditField<ExpenseDto>[] = [
    {
      key: "date", label: "التاريخ", kind: "date",
      current: (e) => e.date.slice(0, 10),
      apply: (e, v) => updateExpense(e.id, {
        date: new Date(v).toISOString(), description: e.description, amount: e.amount,
        category: e.category ?? undefined, employeeId: e.employeeId ?? null,
      }).then(() => undefined),
    },
    {
      key: "category", label: "الفئة", kind: "text",
      current: (e) => e.category ?? "",
      apply: (e, v) => updateExpense(e.id, {
        date: e.date, description: e.description, amount: e.amount,
        category: v, employeeId: e.employeeId ?? null,
      }).then(() => undefined),
    },
  ];

  /**
   * A row's own buttons. Defined once and rendered twice — in the desktop row and on the
   * phone's card — because a button that exists on only one of them is a button half the
   * market does not have, and the half that goes missing is always the phone's.
   */
  function expenseActions(e: ExpenseDto) {
    if (!canEdit && !canDelete) return null;
    return (
      <span className="flex flex-wrap gap-3">
        {canEdit && <button className="btn-link text-brand-700 text-sm hover:underline" onClick={() => setEditing(e)}>تعديل</button>}
        {canDelete && <button className="btn-link text-red-500 text-sm hover:underline" onClick={() => handleDelete(e)}>حذف</button>}
      </span>
    );
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

      {selection.selected.size > 0 && (canDelete || canEdit) && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <span className="text-sm text-gray-600">محدد: <span className="font-semibold">{selection.selected.size}</span></span>
          {canEdit && (
            <button className="btn-secondary text-sm" onClick={() => setBulkEditing(true)}>
              تعديل المحدد ({selection.selected.size})
            </button>
          )}
          {canDelete && (
            <button className="btn-danger text-sm" disabled={bulkDeleting} onClick={handleBulkDelete}>
              {bulkDeleting ? "جاري الحذف..." : `حذف المحدد (${selection.selected.size})`}
            </button>
          )}
        </div>
      )}

      {bulkEditing && (
        <BulkEditDialog
          rows={expenses.filter((e) => selection.selected.has(e.id))}
          fields={expenseBulkFields}
          label={(e) => `${e.description} — ${formatCurrency(e.amount)}`}
          onClose={() => setBulkEditing(false)}
          onDone={async (message) => { setBulkError(message); selection.clear(); await refresh(); }}
        />
      )}

      <ColumnFilterSummary filters={filters} />

      <div className="card">
        <div className="sm:hidden">
          <CollapsibleRows
            rows={pager.pageRows}
            rowKey={(e) => e.id}
            title={(e) => e.description}
            value={(e) => formatCurrency(e.amount)}
            leading={canDelete ? (e) => (
              <input type="checkbox" checked={selection.selected.has(e.id)} onChange={() => selection.toggleOne(e.id)} />
            ) : undefined}
            details={(e) => [
              { label: "التاريخ", value: formatDate(e.date) },
              { label: "الفئة", value: e.category || "—" },
              { label: "الموظف", value: e.employeeName || "—" },
              ...(canEdit || canDelete ? [{ label: "", value: expenseActions(e) }] : []),
            ]}
            empty="لا توجد مصاريف"
          />
        </div>
        <div className="hidden sm:block overflow-x-auto">
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
            <ColumnFilterRow
              columns={[
                ...(canDelete ? [null] : []),
                "date", "description", "category", "employee", "amount",
                ...(showActionsColumn ? [null] : []),
              ]}
              specs={EXPENSE_FILTERS}
              filters={filters}
              rows={expenses}
            />
          </thead>
          <tbody>
            {filters.rows.length === 0 ? (
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
                {showActionsColumn && <td className="whitespace-nowrap">{expenseActions(e)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
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
    <div className="modal-backdrop">
      <div className="modal-card sm:max-w-md p-6">
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
    <div className="modal-backdrop">
      <div className="modal-card sm:max-w-md p-6">
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
