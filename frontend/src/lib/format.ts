export function formatCurrency(value: number): string {
  return `₪ ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * A zero weight reads as "—", not "0 كغم" (explicit request, app-wide): on an invoice or a
 * statement, 0 كغم isn't a measurement — it's a line that simply isn't sold by weight (a
 * box-priced item), or a total with no weighed goods behind it at all. Printing a literal zero
 * there invites reading it as "weighed, came out empty".
 *
 * Handled here in the formatter rather than at each call site so every screen, table and WhatsApp
 * message gets it without a `> 0` check of its own — several call sites already had one, and the
 * ones that didn't were exactly where "0 كغم" was showing up.
 */
export function formatWeight(value: number): string {
  if (value === 0) return "—";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 3 })} كغم`;
}

/** Container kinds, for the containers ledger. The old Kg/Box "unit" on an invoice line is gone —
 *  a line carries العدد and الوزن now, and its crates and cartons as counts of their own. */
export const CONTAINER_LABELS: Record<"Box" | "Carton" | "Sack", string> = { Box: "صندوق", Carton: "كرتونة", Sack: "مخلاة" };

/** Payment direction labels — ToFarmer/ToDriver are separate directions (see the backend
 * PaymentDirection enum's doc comment), each shown under its own label everywhere a payment's
 * direction is displayed (list/print tables, the Checks page). */
export const PAYMENT_DIRECTION_LABELS: Record<"FromMerchant" | "ToFarmer" | "ToDriver", string> = {
  FromMerchant: "من المشتري",
  ToFarmer: "للبائع",
  ToDriver: "للسائق",
};

/**
 * A plain count — العدد, or a number of crates/cartons. Zero stays a real 0: a count of physical
 * things has zero as a genuine answer, unlike a weight, where "0 كغم" means "not weighed" and
 * formatWeight turns it into "—".
 */
export function formatCount(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 3 });
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
/** Mirrors backend PartnerRoles.Label — a person can hold more than one role, and the label has to
 *  show all of them: "بائع/سائق", not whichever one happened to be checked for first. */
export function partnerTypeLabel(type: string | null | undefined): string {
  if (!type) return "—";
  const parts: string[] = [];
  if (type === "Farmer" || type === "Both" || type === "FarmerDriver" || type === "All") parts.push("بائع");
  if (type === "Merchant" || type === "Both" || type === "MerchantDriver" || type === "All") parts.push("مشتري");
  if (type === "Driver" || type === "FarmerDriver" || type === "MerchantDriver" || type === "All") parts.push("سائق");
  return parts.length > 0 ? parts.join("/") : "—";
}

/** Does this person hold `role`? The picker and the account pages ask this, never `type === "..."`. */
export function partnerHasRole(type: string | null | undefined, role: "Farmer" | "Merchant" | "Driver"): boolean {
  if (!type) return false;
  if (role === "Farmer") return type === "Farmer" || type === "Both" || type === "FarmerDriver" || type === "All";
  if (role === "Merchant") return type === "Merchant" || type === "Both" || type === "MerchantDriver" || type === "All";
  return type === "Driver" || type === "FarmerDriver" || type === "MerchantDriver" || type === "All";
}

export function buildWhatsAppLink(phone: string, message: string): string {
  const digitsOnly = phone.replace(/\D/g, "");
  return `https://wa.me/${digitsOnly}?text=${encodeURIComponent(message)}`;
}

interface StatementInvoiceLike {
  invoiceNumber: string;
  date: string;
  items: { itemName: string; quantity: number; weightKg?: number | null; pricePerUnit: number; lineTotal: number; woodPrice: number }[];
  totalValue: number;
  transportFee: number;
  woodTotal: number;
  /** What the BUYER is charged. Never any other party's figure — see StatementSide. */
  grandTotal: number;
  commission: number;
  /** The seller's own due, straight off the invoice (backend InvoiceCharge.ForSeller). */
  netDueToFarmer: number;
  driverBoxFeeTotal: number;
  /** The driver's own due, straight off the invoice (backend InvoiceCharge.ForDriver). */
  driverDue: number;
}

/**
 * Who the message is FOR. It picks which figure on the invoice is "the total", and getting it
 * wrong is not cosmetic: grandTotal is the BUYER's charge — produce + سعر الخشب + رسوم الصناديق.
 * Sending that to a seller (minus his commission) told him he was owed the wood and the crate fees
 * too — neither of which is his — and never took off his أجرة النقل. Sending it to a driver told
 * him the buyer's whole bill instead of his transport and crate handling. Both messages
 * contradicted the printed copy of the very same invoice, which has always read these three sides
 * off the invoice itself.
 */
export type StatementSide = "merchant" | "farmer" | "driver";

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
 *
 * The commission is shown ONLY on a farmer send (requirement doc §5: it never appears on anything
 * the merchant sees, and a driver has none at all) — but which figure the message totals up is
 * decided by <code>side</code>, not by whether a commission was passed in. See StatementSide.
 */
export function buildStatementMessage(
  companyName: string,
  companyPhone: string | undefined | null,
  partnerName: string,
  invoices: StatementInvoiceLike[],
  previousBalance?: number,
  side: StatementSide = "merchant",
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
      // The line says what it was actually priced by: its weight when it has one, otherwise its
      // count. Reading a total back against the wrong figure is how a recipient disputes a bill.
      const priced = it.weightKg && it.weightKg > 0
        ? `${formatWeight(it.weightKg)}`
        : `${formatCount(it.quantity)} عدد`;
      const countNote = it.weightKg && it.weightKg > 0 ? ` (عدد: ${formatCount(it.quantity)})` : "";
      lines.push(`- ${it.itemName}: ${priced}${countNote} × ${formatCurrency(it.pricePerUnit)} = ${formatCurrency(it.lineTotal)}${woodNote}`);
    }
    if (inv.woodTotal > 0) lines.push(`  إجمالي سعر الخشب لهذه الفاتورة: ${formatCurrency(inv.woodTotal)}`);
    // Not part of the total below: أجرة النقل comes off the SELLER and goes to the driver, so the
    // buyer is not charged for it (see the backend InvoiceCharge). Named so whoever is reading
    // this — buyer, seller or driver — can tell whose it is.
    if (inv.transportFee > 0) lines.push(`  أجرة النقل (على البائع، للسائق): ${formatCurrency(inv.transportFee)}`);
    grandTotal += inv.grandTotal;
  }

  lines.push("");
  // Each side's own figure, summed straight off the invoices — never one side's total adjusted
  // into another's, which is what this used to do.
  const sum = (pick: (inv: StatementInvoiceLike) => number) => invoices.reduce((total, inv) => total + pick(inv), 0);
  let netTotal: number;

  if (side === "farmer") {
    // His produce, then what comes off it: the market's commission and the أجرة النقل that
    // brought the goods in. سعر الخشب and رسوم الصناديق are not his and never appear.
    const commissionTotal = sum((inv) => inv.commission);
    const transportTotal = sum((inv) => inv.transportFee);
    netTotal = sum((inv) => inv.netDueToFarmer);
    lines.push(`قيمة البضاعة: ${formatCurrency(sum((inv) => inv.totalValue))}`);
    if (commissionTotal !== 0) lines.push(`العمولة: - ${formatCurrency(commissionTotal)}`);
    if (transportTotal !== 0) lines.push(`أجرة النقل: - ${formatCurrency(transportTotal)}`);
    lines.push(`الصافي المستحق لك: ${formatCurrency(netTotal)}`);
  } else if (side === "driver") {
    // Transport plus crate handling — the two things a driver is paid for, and nothing else.
    const transportTotal = sum((inv) => inv.transportFee);
    const boxHandlingTotal = sum((inv) => inv.driverBoxFeeTotal);
    netTotal = sum((inv) => inv.driverDue);
    if (transportTotal !== 0) lines.push(`أجرة النقل: ${formatCurrency(transportTotal)}`);
    if (boxHandlingTotal !== 0) lines.push(`أجرة الصناديق: ${formatCurrency(boxHandlingTotal)}`);
    lines.push(`الإجمالي المستحق لك: ${formatCurrency(netTotal)}`);
  } else {
    netTotal = grandTotal;
    lines.push(`الإجمالي الكلي: ${formatCurrency(grandTotal)}`);
  }
  if (previousBalance !== undefined && previousBalance !== 0) {
    lines.push(`الرصيد السابق: ${formatCurrency(previousBalance)}`);
    lines.push(`الإجمالي المستحق: ${formatCurrency(netTotal + previousBalance)}`);
  }
  return lines.join("\n");
}
