import { useEffect, useState } from "react";
import { getSourceBooks } from "../api/invoices";

/**
 * "الدفتر" — which of the four paper books an invoice was copied in from.
 *
 * Temporary, for the changeover off the books. Goods often go out before they are priced, so an
 * invoice is entered and finished later, and when a figure needs checking the question is always
 * which book to open. It carries no money and never reaches a printed document.
 *
 * The four names come from the server, which refuses one it does not know: a dropdown holding its
 * own copy would be one typo away from an option that cannot be saved. If the list cannot be
 * fetched the field renders disabled rather than empty, so it reads as "not available now" instead
 * of "this invoice belongs to no book".
 */
export function SourceBookSelect({ value, onChange, label = "الدفتر (اختياري)", includeAny = false }: {
  value: string;
  onChange: (book: string) => void;
  label?: string;
  /** Adds a "كل الدفاتر" option — for the filter, where blank means no filter rather than no book. */
  includeAny?: boolean;
}) {
  const [books, setBooks] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSourceBooks()
      .then((b) => { if (!cancelled) setBooks(b); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      <label className="label">{label}</label>
      <select
        className="input"
        value={value}
        disabled={failed}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{failed ? "تعذّر تحميل الدفاتر" : includeAny ? "كل الدفاتر" : "بدون دفتر"}</option>
        {books.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
    </div>
  );
}
