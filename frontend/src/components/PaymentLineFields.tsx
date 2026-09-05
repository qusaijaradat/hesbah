// Shared "طريقة/طرق الدفع" building blocks — originally built for PaymentsPage's "تسجيل دفعة"
// modal (splitting one payment across several methods at once, e.g. part نقدي + part شيك), now
// reused wherever else a payment can be recorded with more than one method (explicit request:
// "بدي اطبق طريقة الدفع بأكثر من طريقة ... وعلى أي اشي إلو علاقة بدفعات" — currently also the
// invoice-creation "دفعة عند الإصدار" shortcut, see InvoiceNewPage.tsx). Each PaymentLine becomes
// its own Payment row on save, all sharing whatever partner/direction/invoice/date the caller is
// already working with.

// "أخرى" (other) reveals a free-text field for anything not covered by the other three. "شيك" is
// what reveals the due-date/check-number fields below.
export const PAYMENT_METHOD_OPTIONS = ["نقدي", "حوالة", "شيك", "أخرى"];

export interface PaymentLine {
  method: string;
  customMethod: string;
  amount: string;
  checkDueDate: string;
  checkNumber: string;
}

export function emptyLine(): PaymentLine {
  return { method: "نقدي", customMethod: "", amount: "", checkDueDate: "", checkNumber: "" };
}

export function resolveMethod(line: PaymentLine): string {
  return line.method === "أخرى" ? line.customMethod.trim() : line.method;
}

/** Shared method/amount/check-detail fields for one split line. */
export function PaymentLineFields({ line, onChange, onRemove, showRemove }: {
  line: PaymentLine;
  onChange: (patch: Partial<PaymentLine>) => void;
  onRemove?: () => void;
  showRemove: boolean;
}) {
  const isCheck = line.method === "شيك";
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
        <div>
          <label className="label">المبلغ (₪)</label>
          <input className="input" type="number" min="0" step="0.01" value={line.amount} onChange={(e) => onChange({ amount: e.target.value })} />
        </div>
      </div>
      {line.method === "أخرى" && (
        <div>
          <label className="label">حدد طريقة الدفع</label>
          <input className="input" value={line.customMethod} onChange={(e) => onChange({ customMethod: e.target.value })} placeholder="مثال: بطاقة" />
        </div>
      )}
      {isCheck && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">تاريخ استحقاق الشيك</label>
            <input className="input" type="date" value={line.checkDueDate} onChange={(e) => onChange({ checkDueDate: e.target.value })} />
          </div>
          <div>
            <label className="label">رقم الشيك (اختياري)</label>
            <input className="input" value={line.checkNumber} onChange={(e) => onChange({ checkNumber: e.target.value })} />
          </div>
        </div>
      )}
    </div>
  );
}
