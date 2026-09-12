/**
 * The checks behind "إدخال الدفتر" (QuickEntryPage), kept out of the component so they can be run
 * on their own — they are the part that has to be right, and a check that has never been run is a
 * comment.
 *
 * There is no total written at the bottom of a notebook page, so nothing here is verified against
 * the paper. Every finding is the rows disagreeing with each other, or with what is already on
 * file. That is a narrower promise than "the page was entered correctly" and it is worth being
 * clear about: this catches the slip, not the omission — a row nobody typed at all is invisible to
 * it.
 */

export interface LedgerRow {
  merchant: { id: number; name: string } | null;
  merchantText: string;
  itemName: string;
  quantity: string;
  weightKg: string;
  pricePerUnit: string;
  driver: { id: number; name: string } | null;
  driverText: string;
  farmer: { id: number; name: string } | null;
  farmerText: string;
  boxQuantity: string;
}

/** "خطأ" blocks saving; "تنبيه" is worth a look but a page can legitimately have them. */
export type Severity = "error" | "warn";

export interface Finding {
  rowIndex: number;
  severity: Severity;
  message: string;
}

export function num(v: string): number {
  return parseFloat(v) || 0;
}

/** A row nobody has touched — skipped everywhere rather than reported as incomplete. */
export function isBlank(r: LedgerRow): boolean {
  return !r.merchantText.trim() && !r.itemName.trim() && !r.quantity.trim()
    && !r.weightKg.trim() && !r.pricePerUnit.trim() && !r.driverText.trim()
    && !r.farmerText.trim() && !r.boxQuantity.trim();
}

/**
 * Rows sharing a buyer, a seller and a driver are one invoice — the same grouping the rest of the
 * app already uses, so a page of mixed rows lands as the invoices it actually represents rather
 * than one invoice per line.
 */
export function groupKey(r: LedgerRow): string {
  return [
    r.merchant?.id ?? `n:${r.merchantText.trim().toLowerCase()}`,
    r.farmer?.id ?? (r.farmerText.trim() ? `n:${r.farmerText.trim().toLowerCase()}` : ""),
    r.driver?.id ?? (r.driverText.trim() ? `n:${r.driverText.trim().toLowerCase()}` : ""),
  ].join("§");
}

export function groupRows(rows: LedgerRow[]): LedgerRow[][] {
  const map = new Map<string, LedgerRow[]>();
  for (const r of rows.filter((x) => !isBlank(x))) {
    const k = groupKey(r);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  return Array.from(map.values());
}

/** Fewer than this many priced rows of one item and the page cannot say what that item went for. */
const MIN_ROWS_FOR_OUTLIER = 3;
/** How far off the page's own median a price has to be before it is worth interrupting someone. */
const OUTLIER_FACTOR = 4;

export function auditRows(rows: LedgerRow[]): Finding[] {
  const findings: Finding[] = [];
  const live = rows.map((r, i) => ({ r, i })).filter(({ r }) => !isBlank(r));

  // The median price per item ACROSS THE PAGE. A page carries many rows of the same item, so the
  // page itself says what that item went for today — no lookup needed. Median rather than mean
  // because one row with an extra zero drags a mean up and then hides behind it.
  const pricesByItem = new Map<string, number[]>();
  for (const { r } of live) {
    const key = r.itemName.trim().toLowerCase();
    const price = num(r.pricePerUnit);
    if (!key || price <= 0) continue;
    if (!pricesByItem.has(key)) pricesByItem.set(key, []);
    pricesByItem.get(key)!.push(price);
  }
  const medianByItem = new Map<string, number>();
  for (const [key, prices] of pricesByItem) {
    if (prices.length < MIN_ROWS_FOR_OUTLIER) continue;
    const sorted = [...prices].sort((a, b) => a - b);
    medianByItem.set(key, sorted[Math.floor(sorted.length / 2)]);
  }

  const seen = new Map<string, number>();

  for (const { r, i } of live) {
    const add = (severity: Severity, message: string) => findings.push({ rowIndex: i, severity, message });

    if (!r.merchantText.trim()) add("error", "بدون مشتري — الفاتورة لازمها مشتري.");
    if (!r.itemName.trim()) add("error", "بدون صنف.");
    if (num(r.quantity) <= 0) add("error", "العدد لازم يكون أكبر من صفر.");

    // Not an error: goods go out before they are priced here, and an invoice supports that.
    if (num(r.pricePerUnit) <= 0) add("warn", "بدون سعر — بينحفظ كـ\"غير مسعّر\".");

    // A typed 0 is someone reaching for the field and leaving it, not a weighing that came out
    // empty — and the difference decides how the line is priced.
    if (r.weightKg.trim() !== "" && num(r.weightKg) <= 0) {
      add("error", "الوزن مكتوب صفر — اتركه فاضي إذا الصنف مش موزون.");
    }
    if (num(r.boxQuantity) < 0) add("error", "عدد الصناديق سالب.");

    // A name typed but not matched to anyone on file. Saving CREATES that person — which is how
    // one seller ends up with two records and two balances, so it is said before it happens.
    if (r.merchantText.trim() && !r.merchant) add("warn", `"${r.merchantText.trim()}" مش من القائمة — رح ينضاف كمشتري جديد.`);
    if (r.farmerText.trim() && !r.farmer) add("warn", `"${r.farmerText.trim()}" مش من القائمة — رح ينضاف كبائع جديد.`);
    if (r.driverText.trim() && !r.driver) add("warn", `"${r.driverText.trim()}" مش من القائمة — رح ينضاف كسائق جديد.`);

    const median = medianByItem.get(r.itemName.trim().toLowerCase());
    const price = num(r.pricePerUnit);
    if (median && price > 0 && (price > median * OUTLIER_FACTOR || price < median / OUTLIER_FACTOR)) {
      add("warn", `السعر ${price} بعيد كتير عن سعر "${r.itemName.trim()}" بباقي الصفحة (${median}) — تأكد من الفاصلة.`);
    }

    // The same line twice is a page read twice, or a row copied and never edited.
    const key = [
      r.merchantText.trim().toLowerCase(), r.itemName.trim().toLowerCase(),
      r.quantity, r.weightKg, r.pricePerUnit, r.farmerText.trim().toLowerCase(),
    ].join("|");
    const first = seen.get(key);
    if (first !== undefined) add("warn", `نفس السطر رقم ${first + 1} بالظبط — مكرر؟`);
    else seen.set(key, i);
  }

  return findings;
}
