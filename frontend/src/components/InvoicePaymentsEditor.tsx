import { useEffect, useImperativeHandle, useState } from "react";
import type { Ref } from "react";
import { createPayment, deletePayment, listPayments, updatePayment } from "../api/payments";
import { apiErrorMessage } from "../api/client";
import { formatCurrency, localDateInputValue } from "../lib/format";
import {
  CHECK_METHOD, PAYMENT_METHOD_OPTIONS, PaymentLineFields,
  emptyLine, lineTotal, paymentRequestsFromLine, validatePaymentLine,
} from "./PaymentLineFields";
import type { PaymentLine } from "./PaymentLineFields";
import type { CheckClearanceStatus, PaymentDto } from "../types";

/**
 * "الدفعات على هذه الفاتورة" — the invoice edit page's payments section (explicit request: "عند
 * خيار تعديل الفاتورة، ضيف خيار الدفع اقدر اعدلو واضيف عليه للشيكات والنقدي"). Previously a
 * payment could only be attached to an invoice at CREATION time ("دفعة عند الإصدار"); correcting
 * one, or adding a check that turned up later, meant leaving for the Payments page and hunting
 * for the row.
 *
 * Everything here is a FromMerchant payment linked to this invoice. Existing rows are edited in
 * place; new ones go through the same PaymentLineFields block the rest of the app uses, so a
 * single added "دفعة" can still be several checks, each with its own مبلغ/تاريخ/رقم.
 *
 * Nothing is written until the page's own "حفظ التعديلات" runs `save()` — one button for the
 * whole screen, so the invoice and its payments can't end up half-saved against each other.
 */

export interface InvoicePaymentsEditorHandle {
  /** Applies deletes, then edits, then additions. Throws with an Arabic message on the first
   * failure. `merchantId` comes from the just-saved invoice, so a payment added in the same edit
   * that also changed the buyer attaches to the NEW buyer, not the stale one. */
  save: (merchantId: number) => Promise<void>;
}

/** One existing payment row, as edited on screen. */
interface ExistingRow {
  id: number;
  original: PaymentDto;
  amount: string;
  date: string;
  method: string;
  customMethod: string;
  checkDueDate: string;
  checkNumber: string;
  checkStatus: CheckClearanceStatus;
  checkClearedDate: string;
  /** Marked for deletion, applied on save — reversible until then, unlike deleting immediately. */
  deleted: boolean;
}

/** A known method selects directly; anything else (including a payment saved before the method
 * picker existed) falls into "أخرى" with its original text kept. Same mapping the payments-page
 * edit modal uses. */
function rowFromPayment(payment: PaymentDto): ExistingRow {
  const known = payment.method != null && PAYMENT_METHOD_OPTIONS.slice(0, -1).includes(payment.method);
  return {
    id: payment.id,
    original: payment,
    amount: String(payment.amount),
    date: localDateInputValue(payment.date),
    method: known ? payment.method! : (payment.method ? "أخرى" : "نقدي"),
    customMethod: known ? "" : (payment.method ?? ""),
    checkDueDate: payment.checkDueDate ? localDateInputValue(payment.checkDueDate) : "",
    checkNumber: payment.checkNumber ?? "",
    checkStatus: payment.checkStatus ?? "Pending",
    checkClearedDate: payment.checkClearedDate ? localDateInputValue(payment.checkClearedDate) : "",
    deleted: false,
  };
}

function resolveRowMethod(row: ExistingRow): string {
  return row.method === "أخرى" ? row.customMethod.trim() : row.method;
}

/** Only rows the user actually touched are sent — leaving the rest alone matters when the invoice's
 * buyer changed in the same edit, since the backend rejects a payment whose invoice belongs to a
 * different partner. */
function isRowDirty(row: ExistingRow): boolean {
  const asSaved = rowFromPayment(row.original);
  return row.amount !== asSaved.amount
    || row.date !== asSaved.date
    || resolveRowMethod(row) !== resolveRowMethod(asSaved)
    || row.checkDueDate !== asSaved.checkDueDate
    || row.checkNumber !== asSaved.checkNumber
    || row.checkStatus !== asSaved.checkStatus
    || row.checkClearedDate !== asSaved.checkClearedDate;
}

export function InvoicePaymentsEditor({
  ref, invoiceId, invoiceNumber, date, canCreate, canEdit, canDelete, onTotalChange,
}: {
  ref?: Ref<InvoicePaymentsEditorHandle>;
  invoiceId: number;
  invoiceNumber: string;
  /** The invoice's (possibly just-edited) date — the default date for anything added here. */
  date: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Reports the section's current total up to the page, for its "المدفوع / الباقي" figures. */
  onTotalChange?: (total: number) => void;
}) {
  const [rows, setRows] = useState<ExistingRow[]>([]);
  const [newLines, setNewLines] = useState<PaymentLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listPayments({ invoiceId, pageSize: 200 })
      .then((result) => {
        if (cancelled) return;
        setRows(result.items.map(rowFromPayment));
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(apiErrorMessage(err, "تعذر تحميل دفعات هذه الفاتورة"));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [invoiceId]);

  // A check counts as paid only once it's مصروف — the same rule every balance in the app uses
  // (backend Domain/Services/PaymentRules). An uncleared check is still shown, on its own line
  // below, so it's clear the money is recorded but not in yet rather than just missing from the
  // total. A newly added check line is Pending by definition, so it never counts here either.
  const live = rows.filter((r) => !r.deleted);
  const countsAsPaid = (row: ExistingRow) => row.method !== CHECK_METHOD || row.checkStatus === "Cleared";
  const total = live.filter(countsAsPaid).reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  const pendingChecksTotal =
    live.filter((r) => r.method === CHECK_METHOD && r.checkStatus === "Pending").reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0)
    + newLines.filter((line) => line.method === CHECK_METHOD).reduce((sum, line) => sum + lineTotal(line), 0);
  const addedTotal = newLines.filter((line) => line.method !== CHECK_METHOD).reduce((sum, line) => sum + lineTotal(line), 0);
  const paidTotal = total + addedTotal;

  useEffect(() => { onTotalChange?.(paidTotal); }, [paidTotal, onTotalChange]);

  function updateRow(id: number, patch: Partial<ExistingRow>) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function handleCheckStatusChange(row: ExistingRow, next: CheckClearanceStatus) {
    updateRow(row.id, {
      checkStatus: next,
      // Defaults to the invoice's own date the first time a check is marked cleared with no date
      // of its own, rather than leaving the field empty and silently saving null.
      checkClearedDate: next === "Cleared" && !row.checkClearedDate ? date : row.checkClearedDate,
    });
  }

  function updateNewLine(index: number, patch: Partial<PaymentLine>) {
    setNewLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function save(merchantId: number) {
    // Validate everything up front — a bad check date shouldn't surface only after some rows
    // were already written.
    for (const row of rows) {
      if (row.deleted || !isRowDirty(row)) continue;
      const amount = parseFloat(row.amount) || 0;
      if (amount <= 0) throw new Error(`الدفعات: مبلغ الدفعة بتاريخ ${row.date} يجب أن يكون أكبر من صفر`);
      if (row.method === CHECK_METHOD && !row.checkDueDate) throw new Error(`الدفعات: تاريخ استحقاق الشيك مطلوب`);
      if (row.method === "أخرى" && !row.customMethod.trim()) throw new Error(`الدفعات: يرجى تحديد طريقة الدفع`);
    }
    for (const [i, line] of newLines.entries()) {
      const problem = validatePaymentLine(line, `الدفعة المضافة ${i + 1}`);
      if (problem) throw new Error(problem);
      if (lineTotal(line) <= 0) throw new Error(`الدفعة المضافة ${i + 1}: المبلغ يجب أن يكون أكبر من صفر`);
    }

    for (const row of rows.filter((r) => r.deleted)) {
      try {
        await deletePayment(row.id);
      } catch (err) {
        throw new Error(`تعذر حذف دفعة ${formatCurrency(row.original.amount)}: ${apiErrorMessage(err, "فشل الحذف")}`);
      }
    }

    for (const row of rows.filter((r) => !r.deleted && isRowDirty(r))) {
      const isCheck = row.method === CHECK_METHOD;
      try {
        await updatePayment(row.id, {
          amount: parseFloat(row.amount),
          date: new Date(row.date).toISOString(),
          method: resolveRowMethod(row) || undefined,
          notes: row.original.notes ?? undefined,
          invoiceId,
          checkDueDate: isCheck ? new Date(row.checkDueDate).toISOString() : null,
          checkNumber: isCheck ? (row.checkNumber.trim() || undefined) : undefined,
          checkStatus: isCheck ? row.checkStatus : null,
          checkClearedDate: isCheck && row.checkStatus === "Cleared" && row.checkClearedDate
            ? new Date(row.checkClearedDate).toISOString()
            : null,
        });
      } catch (err) {
        throw new Error(`تعذر تعديل دفعة ${formatCurrency(row.original.amount)}: ${apiErrorMessage(err, "فشل الحفظ")}`);
      }
    }

    for (const [i, line] of newLines.entries()) {
      try {
        // One Payment row per check on a شيك line — see paymentRequestsFromLine.
        for (const request of paymentRequestsFromLine(line)) {
          await createPayment({
            partnerId: merchantId,
            direction: "FromMerchant",
            amount: request.amount,
            date: new Date(date).toISOString(),
            method: request.method,
            notes: `دفعة على الفاتورة ${invoiceNumber}`,
            invoiceId,
            checkDueDate: request.checkDueDate,
            checkNumber: request.checkNumber,
          });
        }
      } catch (err) {
        throw new Error(`تعذر إضافة (الدفعة المضافة ${i + 1}): ${apiErrorMessage(err, "فشل الحفظ")}`);
      }
    }
  }

  // No dep array on purpose: the handle is rebuilt every render so `save` always closes over the
  // current rows/newLines rather than a stale snapshot.
  useImperativeHandle(ref, () => ({ save }));

  if (loading) return <div className="text-sm text-gray-400">جاري تحميل الدفعات...</div>;
  if (loadError) return <div className="text-sm text-red-600 bg-red-50 rounded-md p-3">{loadError}</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold">الدفعات على هذه الفاتورة</h2>
        <div className="text-sm text-gray-500 flex flex-wrap gap-3">
          {paidTotal > 0 && <span>إجمالي المدفوع: <span className="font-semibold">{formatCurrency(paidTotal)}</span></span>}
          {pendingChecksTotal > 0 && (
            <span className="text-amber-600">شيكات قيد التحصيل (لم تُحتسب): <span className="font-semibold">{formatCurrency(pendingChecksTotal)}</span></span>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="text-sm text-gray-400">لا توجد دفعات مسجلة على هذه الفاتورة.</div>
      ) : (
        rows.map((row) => {
          const isCheck = row.method === CHECK_METHOD;
          return (
            <div key={row.id} className={`border border-gray-200 rounded-md p-3 space-y-2 ${row.deleted ? "opacity-50 bg-red-50" : ""}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  دفعة مسجلة{row.original.notes ? ` — ${row.original.notes}` : ""}
                </span>
                {canDelete && (
                  row.deleted ? (
                    <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => updateRow(row.id, { deleted: false })}>
                      تراجع عن الحذف
                    </button>
                  ) : (
                    <button type="button" className="text-xs text-red-500 hover:underline" onClick={() => updateRow(row.id, { deleted: true })}>
                      حذف
                    </button>
                  )
                )}
              </div>
              {/* A deleted row collapses to its summary — no point editing fields that are about
                  to be removed on save. */}
              {row.deleted ? (
                <div className="text-sm text-gray-600">
                  {formatCurrency(row.original.amount)} — {row.original.method || "—"} (سيتم حذفها عند الحفظ)
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="label">المبلغ (₪)</label>
                      <input className="input" type="number" min="0" step="0.01" value={row.amount} disabled={!canEdit}
                        onChange={(e) => updateRow(row.id, { amount: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">التاريخ</label>
                      <input className="input" type="date" value={row.date} disabled={!canEdit}
                        onChange={(e) => updateRow(row.id, { date: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">طريقة الدفع</label>
                      <select className="input" value={row.method} disabled={!canEdit}
                        onChange={(e) => updateRow(row.id, { method: e.target.value })}>
                        {PAYMENT_METHOD_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  </div>
                  {row.method === "أخرى" && (
                    <div>
                      <label className="label">حدد طريقة الدفع</label>
                      <input className="input" value={row.customMethod} disabled={!canEdit}
                        onChange={(e) => updateRow(row.id, { customMethod: e.target.value })} />
                    </div>
                  )}
                  {isCheck && (
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 bg-gray-50 rounded-md p-2">
                      <div>
                        <label className="label">تاريخ الاستحقاق</label>
                        <input className="input" type="date" value={row.checkDueDate} disabled={!canEdit}
                          onChange={(e) => updateRow(row.id, { checkDueDate: e.target.value })} />
                      </div>
                      <div>
                        <label className="label">رقم الشيك</label>
                        <input className="input" value={row.checkNumber} disabled={!canEdit}
                          onChange={(e) => updateRow(row.id, { checkNumber: e.target.value })} />
                      </div>
                      <div>
                        <label className="label">حالة الشيك</label>
                        <select className="input" value={row.checkStatus} disabled={!canEdit}
                          onChange={(e) => handleCheckStatusChange(row, e.target.value as CheckClearanceStatus)}>
                          <option value="Pending">قيد التحصيل</option>
                          <option value="Cleared">تم الصرف</option>
                          <option value="Bounced">مرتجع</option>
                        </select>
                      </div>
                      {row.checkStatus === "Cleared" && (
                        <div>
                          <label className="label">تاريخ الصرف الفعلي</label>
                          <input className="input" type="date" value={row.checkClearedDate} disabled={!canEdit}
                            onChange={(e) => updateRow(row.id, { checkClearedDate: e.target.value })} />
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })
      )}

      {canCreate && (
        <div className="space-y-2">
          {newLines.map((line, i) => (
            <PaymentLineFields
              key={i} line={line} onChange={(patch) => updateNewLine(i, patch)}
              onRemove={() => setNewLines((prev) => prev.filter((_, index) => index !== i))} showRemove
            />
          ))}
          <button type="button" className="text-sm text-brand-700 hover:underline"
            onClick={() => setNewLines((prev) => [...prev, emptyLine()])}>
            + إضافة دفعة (نقدي أو شيكات)
          </button>
        </div>
      )}
    </div>
  );
}
