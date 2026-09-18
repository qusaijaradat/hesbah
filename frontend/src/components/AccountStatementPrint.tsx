import { useState } from "react";
import { PdfActions } from "./PdfActions";

/**
 * "كشف حساب" for a chosen period, from the account page itself.
 *
 * The print button here used to hand over the whole account, every movement since the person was
 * added, which is the wrong document for the thing it is actually used for: settling up at the end
 * of a week or a month with the man standing in front of you. So the dates sit beside the button,
 * and leaving them empty still prints the whole account exactly as before.
 *
 * The sheet itself is unabridged — every line, its date, the invoice it belongs to, the sale value
 * and commission on a seller's line, the method and the note on a payment, the amount and the
 * running balance. A statement somebody is handed has to be arguable from.
 *
 * Narrowing it never drops the earlier money: everything before the period collapses into one
 * "رصيد ما قبل الفترة" line, so the column still adds up to a closing balance the reader can check
 * (backend AccountStatementBuilder.Slice).
 */
export function AccountStatementPrint({ roleLabel, fetchPdf, fileName }: {
  roleLabel: string;
  /** Called with whatever period is on screen at the moment of the click. */
  fetchPdf: (dateFrom?: string, dateTo?: string) => Promise<Blob>;
  fileName: string;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Sent as instants, and the end date covers its whole day — picking "31" and getting nothing
  // that happened on the 31st is the classic way a period statement quietly loses a payment.
  const fromIso = from ? new Date(`${from}T00:00:00`).toISOString() : undefined;
  const toIso = to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined;

  const whole = !from && !to;

  return (
    <div className="card p-4 mb-4">
      <div className="font-semibold text-gray-700">كشف حساب {roleLabel}</div>
      <p className="text-xs text-gray-500 mt-1">
        حدّد فترة، أو اتركها فاضية ليطلع الحساب كامل. الكشف بيطلع بكل تفاصيله — كل حركة بتاريخها
        ورقم فاتورتها وطريقة الدفع والملاحظة والرصيد التراكمي. لما تحدّد فترة، بيطلع سطر
        «رصيد ما قبل الفترة» بالأول عشان يضل الحساب مظبوط.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">من تاريخ</label>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">إلى تاريخ</label>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {!whole && (
          <button className="btn-link text-sm text-gray-600 pb-2" onClick={() => { setFrom(""); setTo(""); }}>
            الحساب كامل
          </button>
        )}
        <div className="pb-1">
          <PdfActions
            fetchPdf={() => fetchPdf(fromIso, toIso)}
            fileName={fileName}
            shareTitle={`كشف حساب ${roleLabel}`}
            printLabel={whole ? "🖨️ طباعة الحساب كامل" : "🖨️ طباعة الفترة"}
          />
        </div>
      </div>
    </div>
  );
}
