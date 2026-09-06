// Shared "طريقة/طرق الدفع" building blocks — originally built for PaymentsPage's "تسجيل دفعة"
// modal (splitting one payment across several methods at once, e.g. part نقدي + part شيك), now
// reused wherever else a payment can be recorded with more than one method (explicit request:
// "بدي اطبق طريقة الدفع بأكثر من طريقة ... وعلى أي اشي إلو علاقة بدفعات" — the invoice-creation
// "دفعة عند الإصدار" shortcut, the invoice-EDIT page's payments section, and the payments edit
// modal's "add more" block).
//
// A شيك line carries a LIST of checks rather than one, each with its own مبلغ / تاريخ استحقاق /
// رقم (explicit request: "في حال كانت شيك، ممكن يكون اكتر من شيك وكل شيك بتاريخ معين ومبلغ معين
// ورقم معين"). Every check still becomes its OWN Payment row on save — see
// paymentRequestsFromLine below — because that's what makes each one show up, track and clear
// independently on the "الشيكات" page. Nothing downstream (the ledger, statements, reports, the
// checks page) needed to change for this: it only ever saw individual check rows to begin with.

// "أخرى" (other) reveals a free-text field for anything not covered by the other three. "شيك" is
// what reveals the per-check list below.
export const PAYMENT_METHOD_OPTIONS = ["نقدي", "حوالة", "شيك", "أخرى"];

export const CHECK_METHOD = "شيك";

/** One physical check: its own amount, due date and (optional) number. */
export interface PaymentCheck {
  amount: string;
  dueDate: string;
  number: string;
}

export interface PaymentLine {
  method: string;
  customMethod: string;
  /** The amount for a NON-check method. On a شيك line this is ignored — the amount is the sum of
   * `checks` (see lineTotal), since each check carries its own. */
  amount: string;
  /** Only meaningful while method === CHECK_METHOD. Always holds at least one (empty) check so
   * switching the method to شيك immediately shows a row to fill in. */
  checks: PaymentCheck[];
}

export function emptyCheck(): PaymentCheck {
  return { amount: "", dueDate: "", number: "" };
}

export function emptyLine(): PaymentLine {
  return { method: "نقدي", customMethod: "", amount: "", checks: [emptyCheck()] };
}

export function resolveMethod(line: PaymentLine): string {
  return line.method === "أخرى" ? line.customMethod.trim() : line.method;
}

/** What this line is worth in total — the sum of its checks, or its single amount. */
export function lineTotal(line: PaymentLine): number {
  if (line.method !== CHECK_METHOD) return parseFloat(line.amount) || 0;
  return line.checks.reduce((sum, check) => sum + (parseFloat(check.amount) || 0), 0);
}

/**
 * The payment rows one line turns into: one per check on a شيك line, otherwise a single row.
 * Every caller fans a line out through here rather than reading line.amount/line.checks itself,
 * so "one Payment row per check" stays decided in exactly one place.
 *
 * Zero-amount entries are dropped — an untouched line (or a stray blank check row) means "nothing
 * paid", not a ₪0 payment. Dates are returned as ISO strings ready for the API.
 */
export function paymentRequestsFromLine(line: PaymentLine): {
  amount: number;
  method: string | undefined;
  checkDueDate: string | null;
  checkNumber: string | undefined;
}[] {
  const method = resolveMethod(line) || undefined;
  if (line.method !== CHECK_METHOD) {
    const amount = parseFloat(line.amount) || 0;
    return amount > 0 ? [{ amount, method, checkDueDate: null, checkNumber: undefined }] : [];
  }
  return line.checks
    .filter((check) => (parseFloat(check.amount) || 0) > 0)
    .map((check) => ({
      amount: parseFloat(check.amount),
      method,
      checkDueDate: new Date(check.dueDate).toISOString(),
      checkNumber: check.number.trim() || undefined,
    }));
}

/**
 * Everything wrong with one line, as a ready-to-show Arabic message — or null when it's fine.
 * `label` names the line for the caller's own error banner ("السطر 2", "الدفعة - السطر 1", ...).
 * Shared so all four entry points reject the same things with the same wording, instead of each
 * re-deriving "a check needs a due date".
 */
export function validatePaymentLine(line: PaymentLine, label: string): string | null {
  if (line.method === "أخرى" && !line.customMethod.trim()) return `${label}: يرجى تحديد طريقة الدفع`;
  if (line.method !== CHECK_METHOD) return null;

  const filled = line.checks.filter((check) => (parseFloat(check.amount) || 0) > 0 || check.dueDate || check.number.trim());
  if (filled.length === 0) return null; // nothing entered at all — treated as "no payment", not an error
  for (const [index, check] of filled.entries()) {
    const checkLabel = filled.length > 1 ? `${label} - الشيك ${index + 1}` : label;
    if (!((parseFloat(check.amount) || 0) > 0)) return `${checkLabel}: مبلغ الشيك مطلوب`;
    if (!check.dueDate) return `${checkLabel}: تاريخ استحقاق الشيك مطلوب`;
  }
  return null;
}

/** Shared method/amount/check-detail fields for one split line. */
export function PaymentLineFields({ line, onChange, onRemove, showRemove }: {
  line: PaymentLine;
  onChange: (patch: Partial<PaymentLine>) => void;
  onRemove?: () => void;
  showRemove: boolean;
}) {
  const isCheck = line.method === CHECK_METHOD;

  function updateCheck(index: number, patch: Partial<PaymentCheck>) {
    onChange({ checks: line.checks.map((check, i) => (i === index ? { ...check, ...patch } : check)) });
  }

  function addCheck() {
    onChange({ checks: [...line.checks, emptyCheck()] });
  }

  function removeCheck(index: number) {
    // Never drops to zero rows — an empty list would leave a شيك line with nowhere to type.
    if (line.checks.length <= 1) { onChange({ checks: [emptyCheck()] }); return; }
    onChange({ checks: line.checks.filter((_, i) => i !== index) });
  }

  const checksTotal = lineTotal(line);

  return (
    <div className="border border-gray-200 rounded-md p-3 space-y-2 relative">
      {showRemove && (
        <button type="button" className="absolute top-2 left-2 text-gray-400 hover:text-red-500 text-sm" onClick={onRemove}>✕</button>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">طريقة الدفع</label>
          <select className="input" value={line.method} onChange={(e) => onChange({ method: e.target.value })}>
            {PAYMENT_METHOD_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        {/* A شيك line has no single amount of its own — each check below carries one, and the
            total is shown next to the checks list instead. */}
        {!isCheck && (
          <div>
            <label className="label">المبلغ (₪)</label>
            <input className="input" type="number" min="0" step="0.01" value={line.amount} onChange={(e) => onChange({ amount: e.target.value })} />
          </div>
        )}
      </div>
      {line.method === "أخرى" && (
        <div>
          <label className="label">حدد طريقة الدفع</label>
          <input className="input" value={line.customMethod} onChange={(e) => onChange({ customMethod: e.target.value })} placeholder="مثال: بطاقة" />
        </div>
      )}
      {isCheck && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="label mb-0">الشيكات</label>
            {checksTotal > 0 && <span className="text-xs text-gray-400">مجموع الشيكات: ₪ {checksTotal.toFixed(2)}</span>}
          </div>
          {line.checks.map((check, index) => (
            <div key={index} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end bg-gray-50 rounded-md p-2">
              <div>
                <label className="label">المبلغ (₪)</label>
                <input className="input" type="number" min="0" step="0.01" value={check.amount}
                  onChange={(e) => updateCheck(index, { amount: e.target.value })} />
              </div>
              <div>
                <label className="label">تاريخ الاستحقاق</label>
                <input className="input" type="date" value={check.dueDate}
                  onChange={(e) => updateCheck(index, { dueDate: e.target.value })} />
              </div>
              <div>
                <label className="label">رقم الشيك (اختياري)</label>
                <input className="input" value={check.number}
                  onChange={(e) => updateCheck(index, { number: e.target.value })} />
              </div>
              <button type="button" className="text-gray-400 hover:text-red-500 text-sm pb-2 px-1"
                title="حذف هذا الشيك" onClick={() => removeCheck(index)}>✕</button>
            </div>
          ))}
          <button type="button" className="text-sm text-brand-700 hover:underline" onClick={addCheck}>
            + إضافة شيك آخر
          </button>
        </div>
      )}
    </div>
  );
}
