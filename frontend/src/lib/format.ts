export function formatCurrency(value: number): string {
  return `₪ ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatWeight(value: number): string {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 3 })} كغم`;
}

export const UNIT_LABELS: Record<"Kg" | "Box", string> = { Kg: "كغم", Box: "صندوق" };

export function formatQuantity(value: number, unit: "Kg" | "Box"): string {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${UNIT_LABELS[unit]}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA"); // yyyy-MM-dd, unambiguous regardless of locale
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-CA");
}

/**
 * Today's calendar date in the user's LOCAL timezone, as "YYYY-MM-DD".
 *
 * DO NOT use `new Date().toISOString().slice(0, 10)` for this — `.toISOString()` always
 * converts to UTC first, so for any timezone ahead of UTC (e.g. Jordan/Palestine, UTC+3),
 * during local hours between midnight and the UTC offset catching up (roughly 00:00–03:00
 * local time), the UTC calendar date is still "yesterday". That silently pre-fills date
 * pickers with the wrong day right when someone is creating something "just after midnight".
 *
 * This reads the year/month/day straight off the local `Date` accessors instead, so it always
 * matches the calendar date the user's own clock shows.
 */
export function todayLocalDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Same local-timezone-safe conversion as todayLocalDateString(), but for an arbitrary ISO
 * instant instead of "now" — used to pre-fill a `<input type="date">` from an existing record
 * (e.g. editing an invoice) without the date silently shifting a day off in timezones ahead of
 * UTC. `new Date(iso)` parses to the same underlying instant either way; reading it back through
 * the local getFullYear/getMonth/getDate accessors (not toISOString()) is what keeps it correct.
 */
export function localDateInputValue(iso: string): string {
  const d = new Date(iso);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Requirement doc §9: "sendable via WhatsApp." A fully automatic send needs an official
 * WhatsApp Business API account from Meta (business verification, a dedicated approved
 * number) — infrastructure only the market owner can provision, not something this app
 * can set up on its own. This is the practical middle ground: one click opens WhatsApp
 * already addressed to the right person with the invoice details pre-typed, so the
 * employee only has to attach the PDF they just downloaded and hit send.
 */
export function buildWhatsAppLink(phone: string, message: string): string {
  const digitsOnly = phone.replace(/\D/g, "");
  return `https://wa.me/${digitsOnly}?text=${encodeURIComponent(message)}`;
}

interface StatementInvoiceLike {
  invoiceNumber: string;
  date: string;
  items: { itemName: string; quantity: number; unit: "Kg" | "Box"; pricePerUnit: number; lineTotal: number; woodPrice: number }[];
  totalValue: number;
  transportFee: number;
  woodTotal: number;
  grandTotal: number;
}

/**
 * The ONE shared Arabic template for a partner statement — company name, company phone,
 * partner name, then every item across however many invoices, each traceable back to its
 * invoice number, with a grand total at the end. Used as-is both for a single invoice's
 * WhatsApp text (InvoiceDetailPage, called with a one-invoice array) and for a trader's
 * consolidated bulk-print WhatsApp message (BulkPrintPage, called with all of that trader's
 * matching invoices) — same wording, same layout, whether the invoice count is one or many.
 * The printed PDF (ExportService.GenerateInvoicesBulkPdf) mirrors this same content.
 *
 * Sums each invoice's own GrandTotal (product + wood + transport) rather than just totalValue —
 * this used to silently drop سعر الخشب/أجرة النقل from "الإجمالي الكلي", showing an amount smaller
 * than what's actually owed. WoodPrice is also shown per line (and per-invoice, when nonzero) so
 * it stays visible in detail instead of only folded into the total, matching every other item
 * table in this app.
 *
 * previousBalance, when passed (and nonzero), is shown as its own line and added on top of the
 * grand total for "الإجمالي المستحق" — same "add the previous balance on top" convention as the
 * printed invoice PDF. Callers decide what "previous balance" means for who they're messaging
 * (see BulkPrintPage.tsx: the merchant's is computed excluding this whole batch of invoices to
 * avoid double-counting when several of their invoices are bundled into one message; the
 * farmer's/driver's is simply their own account's current Remaining).
 */
export function buildStatementMessage(
  companyName: string,
  companyPhone: string | undefined | null,
  partnerName: string,
  invoices: StatementInvoiceLike[],
  previousBalance?: number,
): string {
  const lines: string[] = [companyName];
  if (companyPhone) lines.push(`هاتف: ${companyPhone}`);
  lines.push("");
  lines.push(`كشف حساب: ${partnerName}`);

  let grandTotal = 0;
  for (const inv of invoices) {
    lines.push("");
    lines.push(`فاتورة ${inv.invoiceNumber} (${formatDate(inv.date)})`);
    for (const it of inv.items) {
      const woodNote = it.woodPrice > 0 ? ` (منها سعر خشب: ${formatCurrency(it.woodPrice)})` : "";
      lines.push(`- ${it.itemName}: ${formatQuantity(it.quantity, it.unit)} × ${formatCurrency(it.pricePerUnit)} = ${formatCurrency(it.lineTotal)}${woodNote}`);
    }
    if (inv.woodTotal > 0) lines.push(`  إجمالي سعر الخشب لهذه الفاتورة: ${formatCurrency(inv.woodTotal)}`);
    if (inv.transportFee > 0) lines.push(`  أجرة النقل: ${formatCurrency(inv.transportFee)}`);
    grandTotal += inv.grandTotal;
  }

  lines.push("");
  lines.push(`الإجمالي الكلي: ${formatCurrency(grandTotal)}`);
  if (previousBalance !== undefined && previousBalance !== 0) {
    lines.push(`الرصيد السابق: ${formatCurrency(previousBalance)}`);
    lines.push(`الإجمالي المستحق: ${formatCurrency(grandTotal + previousBalance)}`);
  }
  return lines.join("\n");
}
