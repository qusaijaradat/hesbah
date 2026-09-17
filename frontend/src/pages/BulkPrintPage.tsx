import { Fragment, useEffect, useMemo, useState } from "react";
import { getInvoicesBatch, getMerchantGroupPreviousBalance, listInvoices, printDriverManifestPdf, printFarmerStatementPdf, printInvoicesBulkPdf, printMerchantMergedInvoicesPdf } from "../api/invoices";
import { getFarmerAccount } from "../api/partners";
import { driverItemsBreakdown, farmerItemsBreakdown, merchantItemsBreakdown, printBuyerStatementPdf, printDriverItemsStatementPdf, printFarmerItemsStatementPdf } from "../api/reports";
import type { ReportFilter } from "../api/reports";
import { listSettings } from "../api/settings";
import { PartnerAutocomplete } from "../components/PartnerAutocomplete";
import { usePagination } from "../lib/usePagination";
import { TablePagination } from "../components/TablePagination";
import { buildStatementMessage, buildWhatsAppLink, endOfDay, formatCount, formatCurrency, formatDate, formatWeight, startOfDay, todayLocalDateString } from "../lib/format";
import type { DriverItemBreakdownRow, FarmerItemBreakdownRow, InvoiceFilter, InvoiceListItemDto, MerchantItemBreakdownRow, PartnerType } from "../types";
import { InvoiceLink, PartnerLink } from "../components/RecordLinks";
import { PdfActions } from "../components/PdfActions";
import { CollapsibleRows } from "../components/CollapsibleRows";


type QuickRange = "today" | "week" | "month" | "year" | "custom";

const QUICK_RANGES: { value: QuickRange; label: string }[] = [
  { value: "today", label: "اليوم" },
  { value: "week", label: "آخر 7 أيام" },
  { value: "month", label: "هذا الشهر" },
  { value: "year", label: "هذه السنة" },
  { value: "custom", label: "تاريخ مخصص" },
];

function rangeFor(range: QuickRange): { dateFrom?: string; dateTo?: string } {
  const now = new Date();
  switch (range) {
    case "today":
      return { dateFrom: startOfDay(now).toISOString(), dateTo: endOfDay(now).toISOString() };
    case "week": {
      const from = startOfDay(now);
      from.setDate(from.getDate() - 6);
      return { dateFrom: from.toISOString(), dateTo: endOfDay(now).toISOString() };
    }
    case "month": {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { dateFrom: startOfDay(from).toISOString(), dateTo: endOfDay(now).toISOString() };
    }
    case "year": {
      const from = new Date(now.getFullYear(), 0, 1);
      return { dateFrom: startOfDay(from).toISOString(), dateTo: endOfDay(now).toISOString() };
    }
    default:
      return {};
  }
}

/**
 * "SellerDriver" is not a fourth kind of person — it is the subset of invoices whose بائع and
 * سائق are the same man, given its own section because what the market owes him is both sides
 * added and neither of the other two sheets shows that on its own.
 *
 * His invoices deliberately stay in the بائع and السائق sections as well. The new section is a
 * view, not a reassignment: nothing disappears from where someone is used to finding it.
 */
type Role = "Merchant" | "Farmer" | "Driver" | "SellerDriver";

const ROLE_LABEL: Record<Role, string> = { Merchant: "مشتري", Farmer: "بائع", Driver: "سائق", SellerDriver: "بائع وسائق" };
/** Plural form, for the "استثناء ..." picker's own label/placeholder. */
const ROLE_PLURAL_LABEL: Record<Role, string> = { Merchant: "المشترين", Farmer: "الباعة", Driver: "السواق", SellerDriver: "الباعة السواق" };
const ROLE_PARTNER_TYPES: Record<Role, PartnerType[]> = {
  Merchant: ["Merchant"],
  Farmer: ["Farmer"],
  Driver: ["Driver"],
  // Searched among sellers and drivers both: the person being looked for holds both roles, and
  // which of the two his record happens to be labelled with is not something to make anyone guess.
  SellerDriver: ["Farmer", "Driver"],
};
const ROLE_FILE_SLUG: Record<Role, string> = { Merchant: "buyer", Farmer: "farmer", Driver: "driver", SellerDriver: "seller-driver" };

/**
 * Each of the 3 "طباعة الفواتير" sections (مشتري/بائع/سائق) is fully independent — its own period,
 * invoice-number range and optional person picker, its own result set/selection, and its own print
 * action. When no specific person is picked, the section still only shows invoices that actually
 * have that role attached (hasFarmer/hasDriver on the merchant side isn't needed — every invoice
 * always has a merchant) — see backend InvoiceFilterRequest.HasFarmer/HasDriver.
 */
function useRoleSection(role: Role) {
  const [quickRange, setQuickRange] = useState<QuickRange>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [invoiceNumberFrom, setInvoiceNumberFrom] = useState("");
  const [invoiceNumberTo, setInvoiceNumberTo] = useState("");
  const [partnerPick, setPartnerPick] = useState<{ id: number; name: string } | null>(null);
  // "استثناء أسماء" — people of THIS section's own role whose invoices should be left out of the
  // run ("اطبع الكل هذا الأسبوع إلا هدول الاثنين"). Kept as {id,name} rather than plain names
  // because two people can share a display name — the exclusion has to bite on identity, and the
  // name is only there to label the chip.
  const [excluded, setExcluded] = useState<{ id: number; name: string }[]>([]);
  const [result, setResult] = useState<InvoiceListItemDto[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  function buildFilter(): InvoiceFilter {
    const dates = quickRange === "custom"
      ? {
          dateFrom: customFrom ? startOfDay(new Date(customFrom)).toISOString() : undefined,
          dateTo: customTo ? endOfDay(new Date(customTo)).toISOString() : undefined,
        }
      : rangeFor(quickRange);

    // Each section excludes names of its OWN role only — see InvoiceFilter.excludeMerchantIds.
    const excludedIds = excluded.length > 0 ? excluded.map((p) => p.id) : undefined;
    const excludeFilter: Partial<InvoiceFilter> =
      role === "Merchant"
        ? { excludeMerchantIds: excludedIds }
        : role === "Farmer"
        ? { excludeFarmerIds: excludedIds }
        // The seller-driver section excludes by the same id on both sides, because on these
        // invoices the two sides are the same person and excluding one of them alone would leave
        // his invoices in through the other.
        : role === "SellerDriver"
        ? { excludeFarmerIds: excludedIds, excludeDriverIds: excludedIds }
        : { excludeDriverIds: excludedIds };

    const roleFilter: Partial<InvoiceFilter> =
      role === "Merchant"
        ? { merchantId: partnerPick?.id }
        : role === "Farmer"
        ? (partnerPick ? { farmerId: partnerPick.id } : { hasFarmer: true })
        : role === "SellerDriver"
        // sellerIsDriver stays on even when one person is picked: picking him narrows the section,
        // it does not turn it into the سائق section for him.
        ? (partnerPick ? { sellerIsDriver: true, driverId: partnerPick.id } : { sellerIsDriver: true })
        : (partnerPick ? { driverId: partnerPick.id } : { hasDriver: true });

    return {
      ...dates,
      invoiceNumberFrom: invoiceNumberFrom.trim() || undefined,
      invoiceNumberTo: invoiceNumberTo.trim() || undefined,
      status: "Active",
      // Never print an unpriced invoice. A line still at price 0 means the goods went out before
      // the market priced them, so the invoice total is not yet what the person owes — printing it
      // hands them a bill that is short by however much has not been priced yet.
      hasUnpricedItems: false,
      page: 1,
      pageSize: 500,
      ...roleFilter,
      ...excludeFilter,
    };
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const data = await listInvoices(buildFilter());
      setResult(data.items);
      setSelected(new Set(data.items.map((i) => i.id)));
    } catch {
      setError("فشل تحميل الفواتير");
    } finally {
      setLoading(false);
    }
  }

  // Adding/removing an excluded name re-runs the search the same way picking a person does (the
  // invoice-number range still waits for "تطبيق الفلاتر", as it always has). Joined into a string
  // because the array itself is a new identity on every render.
  const excludedKey = excluded.map((p) => p.id).join(",");

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickRange, partnerPick?.id, excludedKey]);

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === result.length ? new Set() : new Set(result.map((i) => i.id))));
  }

  // Returns the blob rather than downloading it: PdfActions decides whether it becomes a download
  // or an attachment in the share sheet, and owns the busy/error state that used to live here.
  async function buildPdf() {
      // Merchant tab (explicit request): several invoices for the same merchant on the same
      // calendar day print as ONE combined invoice, regardless of which farmer/driver supplied
      // each one — so this tab uses the merged-invoice endpoint instead of the quadrant-grid bulk
      // print the Farmer/Driver tabs still use. Both produce THIS section's own document type: a
      // "فاتورة بائع" from the بائع tab and a "فاتورة سائق" from the سائق tab, never the buyer's
      // copy (which is what every tab used to hand out).
    return role === "Merchant"
      ? printMerchantMergedInvoicesPdf(Array.from(selected))
      // SellerDriver prints the DRIVER document: the card already recognises an invoice whose
      // seller and driver are one person and itemises both sides on it (see InvoiceCard). A
      // fourth print role on the API would be a second name for a document that already exists.
      : printInvoicesBulkPdf(Array.from(selected), role === "SellerDriver" ? "Driver" : role);
  }

  const selectedRows = result.filter((i) => selected.has(i.id));
  // Every figure here is this SECTION'S own side (see SectionPrintBar) — a بائع section summing
  // the merchant's grand total, the way this used to, is a number that means nothing to a seller.
  const totals = {
    value: selectedRows.reduce((sum, i) => sum + i.totalValue, 0),
    wood: selectedRows.reduce((sum, i) => sum + i.woodTotal, 0),
    grand: selectedRows.reduce((sum, i) => sum + i.grandTotal, 0),
    commission: selectedRows.reduce((sum, i) => sum + i.commission, 0),
    netDueToFarmer: selectedRows.reduce((sum, i) => sum + i.netDueToFarmer, 0),
    transport: selectedRows.reduce((sum, i) => sum + i.transportFee, 0),
    driverBoxFee: selectedRows.reduce((sum, i) => sum + i.driverBoxFeeTotal, 0),
    driverDue: selectedRows.reduce((sum, i) => sum + i.driverDue, 0),
  };

  return {
    role,
    quickRange, setQuickRange, customFrom, setCustomFrom, customTo, setCustomTo,
    invoiceNumberFrom, setInvoiceNumberFrom, invoiceNumberTo, setInvoiceNumberTo,
    partnerPick, setPartnerPick,
    excluded, setExcluded,
    result, selected, setSelected, loading, error, setError,
    buildFilter, refresh, toggleOne, toggleAll, buildPdf, totals,
  };
}

type RoleSection = ReturnType<typeof useRoleSection>;

/**
 * Derives a "كشف ... حسب الفترة" report filter straight from a section's OWN period/person filter
 * (quickRange/customFrom/customTo/partnerPick) — deliberately no separate/duplicate date picker for
 * these breakdown cards, per the explicit design decision to reuse each tab's existing filter bar.
 */
function periodFilterFor(section: RoleSection): ReportFilter {
  const f = section.buildFilter();
  return { dateFrom: f.dateFrom, dateTo: f.dateTo, partnerId: section.partnerPick?.id };
}

/**
 * Backs each tab's "كشف ... حسب الفترة" card — refetches whenever the section's own period/person
 * filter changes (see periodFilterFor), independent of the section's invoice list/selection above it.
 */
function useItemsBreakdown<T>(section: RoleSection, fetchRows: (filter: ReportFilter) => Promise<T[]>) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchRows(periodFilterFor(section))
      .then((data) => setRows(data))
      .catch(() => setError("فشل تحميل الكشف"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section.quickRange, section.customFrom, section.customTo, section.partnerPick?.id]);

  return { rows, loading, printing, setPrinting, error, setError };
}

/**
 * "استثناء أسماء" — pick any number of people of this section's OWN role to leave out of the run
 * (explicit request: print everything for the period EXCEPT these names, on all three sections,
 * each against its own role's list). Picking a name adds a chip; the chip's ✕ puts them back in.
 *
 * The list is built from the same PartnerAutocomplete the "تصفية حسب" picker above uses, with the
 * same role-restricted suggestions — so the بائع section can only ever exclude باعة, and there's
 * no second way to type a name that has to be kept in sync.
 */
function ExcludedPartnersPicker({ section }: { section: RoleSection }) {
  const plural = ROLE_PLURAL_LABEL[section.role];
  // Bumped on every pick — including one that changes nothing (an already-excluded name) — so the
  // key below always changes and the field always clears. Counting the chips instead would leave
  // a re-picked name sitting in the box.
  const [pickCount, setPickCount] = useState(0);

  function add(partner: { id: number; name: string } | null) {
    if (!partner) return;
    setPickCount((n) => n + 1);
    section.setExcluded((prev) => (prev.some((p) => p.id === partner.id) ? prev : [...prev, partner]));
  }

  return (
    <div>
      <div className="w-full max-w-xs">
        <PartnerAutocomplete
          // Remounting is what empties the box for the next name: the component keeps its own
          // typed text, and `value` stays null here by design (a pick is consumed into the chip
          // list below, never held in the field).
          key={pickCount}
          label={`استثناء ${plural} من الطباعة (اختياري)`}
          value={null}
          onChange={add}
          placeholder="اختر اسمًا لاستثنائه، ويمكن اختيار أكثر من واحد..."
          types={ROLE_PARTNER_TYPES[section.role]}
        />
      </div>
      {section.excluded.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {section.excluded.map((partner) => (
            <span key={partner.id} className="inline-flex items-center gap-1 text-sm bg-red-50 text-red-700 border border-red-200 rounded-full ps-3 pe-2 py-1">
              {partner.name}
              <button
                type="button" className="text-red-400 hover:text-red-700" title={`إلغاء استثناء ${partner.name}`}
                onClick={() => section.setExcluded((prev) => prev.filter((p) => p.id !== partner.id))}
              >
                ✕
              </button>
            </span>
          ))}
          <button
            type="button" className="btn-link text-xs text-gray-500 hover:underline self-center"
            onClick={() => section.setExcluded([])}
          >
            مسح كل الاستثناءات
          </button>
        </div>
      )}
    </div>
  );
}

/** Shared filter bar (period + invoice-number range + optional person picker) used by all 3 sections. */
function SectionFilters({ section }: { section: RoleSection }) {
  return (
    <div className="card p-4 mb-4 space-y-4">
      <div>
        <label className="label">الفترة</label>
        <div className="flex flex-wrap gap-2">
          {QUICK_RANGES.map((r) => (
            <button
              key={r.value}
              className={section.quickRange === r.value ? "btn-primary" : "btn-secondary"}
              onClick={() => section.setQuickRange(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {section.quickRange === "custom" && (
        <div className="grid grid-cols-2 gap-3 max-w-md">
          <div>
            <label className="label">من تاريخ</label>
            <input type="date" className="input" value={section.customFrom} onChange={(e) => section.setCustomFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">إلى تاريخ</label>
            <input type="date" className="input" value={section.customTo} onChange={(e) => section.setCustomTo(e.target.value)} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 max-w-md">
        <div>
          <label className="label">من رقم فاتورة</label>
          <input className="input" placeholder="مثال: INV-2026-000010" value={section.invoiceNumberFrom}
            onChange={(e) => section.setInvoiceNumberFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">إلى رقم فاتورة</label>
          <input className="input" placeholder="مثال: INV-2026-000020" value={section.invoiceNumberTo}
            onChange={(e) => section.setInvoiceNumberTo(e.target.value)} />
        </div>
      </div>

      <div className="w-full max-w-xs">
        <PartnerAutocomplete
          label={`تصفية حسب ${ROLE_LABEL[section.role]} (اختياري)`}
          value={section.partnerPick}
          onChange={section.setPartnerPick}
          placeholder={`اترك الحقل فارغًا لعرض كل فواتير ${ROLE_LABEL[section.role]}...`}
          types={ROLE_PARTNER_TYPES[section.role]}
        />
      </div>

      <ExcludedPartnersPicker section={section} />

      <div>
        <button className="btn-secondary" onClick={section.refresh} disabled={section.loading}>
          {section.loading ? "جاري البحث..." : "🔍 تطبيق الفلاتر"}
        </button>
      </div>
    </div>
  );
}

/**
 * Results table for one section, showing ONLY that section's own side (explicit request: "بقسم
 * البائع بظهر اشي إلو علاقة بالمشتري وكمان نفس الإشي عند سائق ... بكل قسم بدي اطبع الفواتير
 * الخاصة فيه"). Every row used to carry all three names (المشتري/البائع/السائق) plus the
 * merchant's القيمة/الإجمالي on every tab, so a بائع run was read against the buyer's numbers.
 *
 * Now each tab names only its own counterparty and shows only its own money — the same figures
 * that role's printed copy carries (see backend ExportService.InvoiceCard):
 *   مشتري — القيمة، سعر الخشب، رسوم الصناديق، الإجمالي
 *   بائع  — قيمة المبيعات، سعر الخشب (للمصلحة)، العمولة، الصافي المستحق
 *   سائق  — أجرة النقل، أجرة الصناديق، سعر الخشب (للمصلحة)، المستحق للسائق
 * سعر الخشب stays its own column on all three (never folded silently into a total), as does the
 * role-relevant "متبقي ..." balance — both per the earlier explicit requirement. On the بائع and
 * سائق tabs it is labelled "(للمصلحة)": it is cargo detail sitting beside their money, not part of
 * it, and an unlabelled سعر الخشب column next to "الصافي المستحق" reads like it is theirs.
 */
function SectionTable({ section }: { section: RoleSection }) {
  const { role } = section;
  // A day of invoices is fetched whole (pageSize 500) for the print run — the TABLE still shows
  // one page at a time. Selection and printing keep working across pages: they read section.result,
  // never just what is on screen.
  const pager = usePagination(section.result);

  /**
   * This row's counterparty on THIS section's side — the only person shown, linked to that
   * side's own كشف حساب. A driver goes to the same account page a seller does: they share one
   * ledger, while a buyer's account is the separate one.
   */
  function partyOf(inv: InvoiceListItemDto) {
    if (role === "Merchant") return <PartnerLink partnerId={inv.merchantId} name={inv.merchantName} side="merchant" />;
    if (role === "Farmer") return <PartnerLink partnerId={inv.farmerId} name={inv.farmerName} side="seller" />;
    // SellerDriver falls through here on purpose: on these invoices the two ids are the same
    // person, so the driver side names him just as well as the seller side would.
    return <PartnerLink partnerId={inv.driverId} name={inv.driverName} side="seller" />;
  }

  function remainingOf(inv: InvoiceListItemDto): number | null | undefined {
    if (role === "Merchant") return inv.merchantRemaining;
    if (role === "Farmer") return inv.farmerRemaining;
    // One account, one balance: a person who is both holds a single seller-side account that his
    // Sale rows and his TransportFee rows both post to (see FarmerTransaction), so there is no
    // second balance to add here — driverRemaining IS that account.
    return inv.driverRemaining;
  }

  // The money columns between "الكمية" and "متبقي ...", per role — the same figures that role's
  // own printed copy carries, and nothing from the other two sides.
  const moneyColumns: { label: string; value: (inv: InvoiceListItemDto) => number; bold?: boolean; red?: boolean }[] =
    role === "Merchant"
      ? [
          { label: "القيمة", value: (i) => i.totalValue, bold: true },
          { label: "سعر الخشب", value: (i) => i.woodTotal },
          { label: "رسوم الصناديق", value: (i) => i.boxFeeTotal },
          { label: "الإجمالي", value: (i) => i.grandTotal, bold: true },
        ]
      : role === "Farmer"
      ? [
          { label: "قيمة المبيعات", value: (i) => i.totalValue, bold: true },
          // Cargo detail, not his money — same as on the سائق tab below.
          { label: "سعر الخشب (للمصلحة)", value: (i) => i.woodTotal },
          { label: "العمولة", value: (i) => i.commission, red: true },
          { label: "الصافي المستحق", value: (i) => i.netDueToFarmer, bold: true },
        ]
      : role === "SellerDriver"
      ? [
          // Both sides, ending in the one figure his printed card ends in. أجرة النقل is not a
          // column of its own: it is already inside الصافي كبائع as a deduction and inside
          // المستحق كسائق as income, and a third column showing it would read as a third amount.
          { label: "قيمة المبيعات", value: (i) => i.totalValue },
          { label: "العمولة", value: (i) => i.commission, red: true },
          { label: "الصافي كبائع", value: (i) => i.netDueToFarmer },
          { label: "المستحق كسائق", value: (i) => i.driverDue },
          { label: "الإجمالي المستحق", value: (i) => i.netDueToFarmer + i.driverDue, bold: true },
        ]
      : [
          { label: "أجرة النقل", value: (i) => i.transportFee, bold: true },
          { label: "أجرة الصناديق", value: (i) => i.driverBoxFeeTotal },
          // Cargo detail, not his money — the buyer pays سعر الخشب and the market keeps it, so it
          // is deliberately outside "المستحق للسائق" beside it.
          { label: "سعر الخشب (للمصلحة)", value: (i) => i.woodTotal },
          { label: "المستحق للسائق", value: (i) => i.driverDue, bold: true },
        ];

  // checkbox + رقم الفاتورة + التاريخ + الطرف + الأصناف + الكمية + money + متبقي
  const columnCount = 6 + moneyColumns.length + 1;

  return (
    <div className="card mb-4">
      {/* Said out loud rather than left as a mystery: an invoice someone expects to see here and
          cannot find has a reason, and "it is still unpriced" is a reason they can act on. */}
      <div className="text-xs text-gray-500 px-3 pt-3">
        الفواتير غير المسعّرة ما بتظهر هون ولا بتنطبع — سعّرها أول وبتبيّن.
      </div>
      <div>
      <div className="sm:hidden">
        <CollapsibleRows
          rows={section.loading ? [] : pager.pageRows}
          rowKey={(inv) => inv.id}
          title={(inv) => (
            <span>
              <InvoiceLink invoiceId={inv.id} invoiceNumber={inv.invoiceNumber} />
              <span className="block text-xs text-gray-500">{formatDate(inv.date)} — {partyOf(inv)}</span>
            </span>
          )}
          value={(inv) => {
            const remaining = remainingOf(inv);
            return (
              <span className={remaining != null && remaining < 0 ? "text-red-600" : ""}>
                {remaining != null ? formatCurrency(remaining) : "—"}
              </span>
            );
          }}
          leading={(inv) => (
            <input type="checkbox" checked={section.selected.has(inv.id)} onChange={() => section.toggleOne(inv.id)} />
          )}
          details={(inv) => [
            { label: "الأصناف", value: inv.itemsSummary || "—" },
            { label: "الكمية", value: [
              inv.totalWeightKg > 0 ? formatWeight(inv.totalWeightKg) : null,
              inv.totalBoxes > 0 ? formatCount(inv.totalBoxes) : null,
            ].filter(Boolean).join(" / ") || "—" },
            ...moneyColumns.map((column) => ({
              label: column.label,
              value: column.value(inv) > 0 ? formatCurrency(column.value(inv)) : "—",
            })),
          ]}
          empty={section.loading ? "جاري التحميل..." : "لا توجد فواتير مطابقة (الفواتير غير المسعّرة مستثناة)"}
        />
      </div>
      <div className="hidden sm:block overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th><input type="checkbox" checked={section.result.length > 0 && section.selected.size === section.result.length} onChange={section.toggleAll} /></th>
            <th>رقم الفاتورة</th>
            <th>التاريخ</th>
            <th>{ROLE_LABEL[role]}</th>
            <th>الأصناف</th>
            <th>الكمية</th>
            {moneyColumns.map((column) => <th key={column.label}>{column.label}</th>)}
            <th>{`متبقي ${ROLE_LABEL[role]}`}</th>
          </tr>
        </thead>
        <tbody>
          {section.loading ? (
            <tr><td colSpan={columnCount} className="text-center text-gray-400 py-6">جاري التحميل...</td></tr>
          ) : section.result.length === 0 ? (
            <tr><td colSpan={columnCount} className="text-center text-gray-400 py-6">لا توجد فواتير مطابقة (الفواتير غير المسعّرة مستثناة)</td></tr>
          ) : (
            pager.pageRows.map((inv) => {
              const remaining = remainingOf(inv);
              return (
                <tr key={inv.id}>
                  <td><input type="checkbox" checked={section.selected.has(inv.id)} onChange={() => section.toggleOne(inv.id)} /></td>
                  <td className="font-mono text-sm">
                    <InvoiceLink invoiceId={inv.id} invoiceNumber={inv.invoiceNumber} />
                  </td>
                  <td>{formatDate(inv.date)}</td>
                  <td>{partyOf(inv)}</td>
                  <td className="text-xs">{inv.itemsSummary || "—"}</td>
                  <td>
                    {inv.totalWeightKg > 0 && <div>{formatWeight(inv.totalWeightKg)}</div>}
                    {inv.totalBoxes > 0 && <div>{formatCount(inv.totalBoxes)}</div>}
                    {inv.totalWeightKg === 0 && inv.totalBoxes === 0 && "—"}
                  </td>
                  {moneyColumns.map((column) => {
                    const value = column.value(inv);
                    return (
                      <td key={column.label} className={`${column.bold ? "font-semibold" : ""} ${column.red ? "text-red-600" : ""}`}>
                        {value > 0 ? formatCurrency(value) : "—"}
                      </td>
                    );
                  })}
                  <td className={remaining != null && remaining < 0 ? "text-red-600 font-semibold" : "font-semibold"}>
                    {remaining != null ? formatCurrency(remaining) : "—"}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      </div>
      </div>
      <TablePagination
        page={pager.page} pageSize={pager.pageSize} totalCount={pager.totalCount}
        itemLabel="فاتورة" onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize}
      />
    </div>
  );
}

function SectionPrintBar({ section }: { section: RoleSection }) {
  return (
    <div className="card p-4 flex items-center justify-between flex-wrap gap-3 mb-4">
      {/* Totals for THIS section's side only — matching its table columns and its printed copy.
          A بائع section used to sum the merchant's grand total (product + خشب + رسوم الصناديق +
          أجرة النقل), which is money the seller neither receives nor owes. */}
      <div className="text-sm text-gray-600 space-x-3 space-x-reverse">
        <span>محدد: <span className="font-semibold">{section.selected.size}</span> فاتورة</span>
        {section.role === "Merchant" ? (
          <>
            <span> — إجمالي القيمة: <span className="font-semibold">{formatCurrency(section.totals.value)}</span></span>
            <span> — إجمالي سعر الخشب: <span className="font-semibold">{formatCurrency(section.totals.wood)}</span></span>
            <span> — الإجمالي الكلي: <span className="font-semibold">{formatCurrency(section.totals.grand)}</span></span>
          </>
        ) : section.role === "Farmer" ? (
          <>
            <span> — إجمالي المبيعات: <span className="font-semibold">{formatCurrency(section.totals.value)}</span></span>
            <span> — إجمالي سعر الخشب: <span className="font-semibold">{formatCurrency(section.totals.wood)}</span></span>
            <span> — إجمالي العمولة: <span className="font-semibold text-red-600">{formatCurrency(section.totals.commission)}</span></span>
            <span> — الصافي المستحق للباعة: <span className="font-semibold">{formatCurrency(section.totals.netDueToFarmer)}</span></span>
          </>
        ) : section.role === "SellerDriver" ? (
          <>
            <span> — إجمالي المبيعات: <span className="font-semibold">{formatCurrency(section.totals.value)}</span></span>
            <span> — إجمالي العمولة: <span className="font-semibold text-red-600">{formatCurrency(section.totals.commission)}</span></span>
            <span> — الصافي كبائع: <span className="font-semibold">{formatCurrency(section.totals.netDueToFarmer)}</span></span>
            <span> — المستحق كسائق: <span className="font-semibold">{formatCurrency(section.totals.driverDue)}</span></span>
            {/* The one figure that matters on this tab, and the one his card ends in. */}
            <span> — الإجمالي المستحق: <span className="font-semibold">{formatCurrency(section.totals.netDueToFarmer + section.totals.driverDue)}</span></span>
          </>
        ) : (
          <>
            <span> — إجمالي أجرة النقل: <span className="font-semibold">{formatCurrency(section.totals.transport)}</span></span>
            <span> — إجمالي أجرة الصناديق: <span className="font-semibold">{formatCurrency(section.totals.driverBoxFee)}</span></span>
            <span> — إجمالي سعر الخشب: <span className="font-semibold">{formatCurrency(section.totals.wood)}</span></span>
            <span> — المستحق للسواق: <span className="font-semibold">{formatCurrency(section.totals.driverDue)}</span></span>
          </>
        )}
      </div>
      <PdfActions
        fetchPdf={section.buildPdf}
        fileName={`invoices-${ROLE_FILE_SLUG[section.role]}-${todayLocalDateString()}.pdf`}
        shareTitle={`فواتير ${ROLE_LABEL[section.role]}`}
        disabled={section.selected.size === 0}
        printLabel={section.role === "Merchant"
          ? "🖨️ طباعة فواتير مشتري (فاتورة مجمّعة لكل مشتري/يوم — 4 بالصفحة)"
          : `🖨️ طباعة فواتير ${ROLE_LABEL[section.role]} (فاتورة ${ROLE_LABEL[section.role]} — 4 بالصفحة)`}
      />
    </div>
  );
}

interface BreakdownItem {
  itemName: string;
  totalQuantity: number;
  totalWeightKg: number;
}

/**
 * "كشف مشتري/بائع حسب الفترة" card — one row per (person, item) grouped under a shaded bold
 * subtotal, same layout as DashboardPage's "كشف المشترين حسب الفترة" widget, reused here for both
 * the Merchant and Farmer tabs since both carry a genuine per-item price (see
 * Merchant/FarmerItemBreakdownRow's doc comments).
 */
function ItemValueBreakdownCard({
  title, nameLabel, groups, grandTotal, loading, error, fetchPdf, fileName,
}: {
  title: string;
  nameLabel: string;
  groups: { id: number; name: string; items: (BreakdownItem & { totalValue: number })[]; subtotal: number }[];
  grandTotal: number;
  loading: boolean;
  error: string | null;
  fetchPdf: () => Promise<Blob>;
  fileName: string;
}) {
  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <h2 className="font-semibold">{title}</h2>
        {!loading && groups.length > 0 && (
          <PdfActions fetchPdf={fetchPdf} fileName={fileName} shareTitle="كشف سائق حسب الفترة" />
        )}
      </div>
      <div>
        <div className="sm:hidden">
          <CollapsibleRows
            rows={loading ? [] : groups}
            rowKey={(group) => group.id}
            title={(group) => group.name}
            value={(group) => formatCurrency(group.subtotal)}
            details={(group) => group.items.map((item) => ({
              label: item.itemName,
              value: `${formatCount(item.totalQuantity)} / ${formatWeight(item.totalWeightKg)} — ${formatCurrency(item.totalValue)}`,
            }))}
            empty={loading ? "جاري التحميل..." : "لا توجد بيانات لهذه الفترة"}
          />
          {!loading && groups.length > 0 && (
            <div className="px-3 py-3 border-t flex justify-between font-semibold">
              <span>الإجمالي الكلي</span>
              <span>{formatCurrency(grandTotal)}</span>
            </div>
          )}
        </div>
        <div className="hidden sm:block overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th>{nameLabel}</th><th>الصنف</th><th>العدد</th><th>الوزن</th><th>السعر</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center text-gray-400 py-6">جاري التحميل...</td></tr>
            ) : groups.length === 0 ? (
              <tr><td colSpan={5} className="text-center text-gray-400 py-6">لا توجد بيانات لهذه الفترة</td></tr>
            ) : (
              groups.map((group) => (
                <Fragment key={group.id}>
                  {group.items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="font-medium">{group.name}</td>
                      <td>{item.itemName}</td>
                      <td>{formatCount(item.totalQuantity)}</td>
                      <td>{formatWeight(item.totalWeightKg)}</td>
                      <td>{formatCurrency(item.totalValue)}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50">
                    <td colSpan={4} className="font-semibold text-gray-600">إجمالي {group.name}</td>
                    <td className="font-semibold">{formatCurrency(group.subtotal)}</td>
                  </tr>
                </Fragment>
              ))
            )}
          </tbody>
          {!loading && groups.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={4} className="font-semibold">الإجمالي الكلي</td>
                <td className="font-bold">{formatCurrency(grandTotal)}</td>
              </tr>
            </tfoot>
          )}
        </table>
        </div>
      </div>
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2 mt-3">{error}</div>}
    </div>
  );
}

/**
 * "كشف سائق حسب الفترة" card — a driver has NO per-item price (flat أجرة نقل per invoice), so the
 * item rows carry only العدد/الوزن and the "أجرة النقل" column stays blank except on each driver's
 * own subtotal row, which shows that driver's WHOLE-period fee exactly once (never summed per item —
 * see DriverItemBreakdownRow's doc comment).
 */
function DriverItemBreakdownCard({
  groups, grandTotal, loading, error, fetchPdf, fileName,
}: {
  groups: { id: number; name: string; items: BreakdownItem[]; transportFee: number }[];
  grandTotal: number;
  loading: boolean;
  error: string | null;
  fetchPdf: () => Promise<Blob>;
  fileName: string;
}) {
  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <h2 className="font-semibold">كشف سائق حسب الفترة</h2>
        {!loading && groups.length > 0 && (
          <PdfActions fetchPdf={fetchPdf} fileName={fileName} shareTitle="كشف سائق حسب الفترة" />
        )}
      </div>
      <div>
        <div className="sm:hidden">
          <CollapsibleRows
            rows={loading ? [] : groups}
            rowKey={(group) => group.id}
            title={(group) => group.name}
            value={(group) => formatCurrency(group.transportFee)}
            details={(group) => group.items.map((item) => ({
              label: item.itemName,
              value: `${formatCount(item.totalQuantity)} / ${formatWeight(item.totalWeightKg)}`,
            }))}
            empty={loading ? "جاري التحميل..." : "لا توجد بيانات لهذه الفترة"}
          />
          {!loading && groups.length > 0 && (
            <div className="px-3 py-3 border-t flex justify-between font-semibold">
              <span>الإجمالي الكلي</span>
              <span>{formatCurrency(grandTotal)}</span>
            </div>
          )}
        </div>
        <div className="hidden sm:block overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr><th>السائق</th><th>الصنف</th><th>العدد</th><th>الوزن</th><th>أجرة النقل</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center text-gray-400 py-6">جاري التحميل...</td></tr>
            ) : groups.length === 0 ? (
              <tr><td colSpan={5} className="text-center text-gray-400 py-6">لا توجد بيانات لهذه الفترة</td></tr>
            ) : (
              groups.map((group) => (
                <Fragment key={group.id}>
                  {group.items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="font-medium">{group.name}</td>
                      <td>{item.itemName}</td>
                      <td>{formatCount(item.totalQuantity)}</td>
                      <td>{formatWeight(item.totalWeightKg)}</td>
                      <td>—</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50">
                    <td colSpan={4} className="font-semibold text-gray-600">إجمالي أجرة نقل {group.name}</td>
                    <td className="font-semibold">{formatCurrency(group.transportFee)}</td>
                  </tr>
                </Fragment>
              ))
            )}
          </tbody>
          {!loading && groups.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={4} className="font-semibold">إجمالي أجرة النقل</td>
                <td className="font-bold">{formatCurrency(grandTotal)}</td>
              </tr>
            </tfoot>
          )}
        </table>
        </div>
      </div>
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2 mt-3">{error}</div>}
    </div>
  );
}

export function BulkPrintPage() {
  const [activeTab, setActiveTab] = useState<Role>("Merchant");

  const merchantSection = useRoleSection("Merchant");
  const farmerSection = useRoleSection("Farmer");
  const driverSection = useRoleSection("Driver");
  const sellerDriverSection = useRoleSection("SellerDriver");
  const sections: Record<Role, RoleSection> = {
    Merchant: merchantSection, Farmer: farmerSection, Driver: driverSection, SellerDriver: sellerDriverSection,
  };
  const active = sections[activeTab];

  // "كشف [مشتري/بائع/سائق] حسب الفترة" — one per tab, scoped to that tab's OWN period/person filter
  // (see periodFilterFor), fully independent of the invoice table/selection above it.
  const merchantBreakdown = useItemsBreakdown(merchantSection, merchantItemsBreakdown);
  const farmerBreakdown = useItemsBreakdown(farmerSection, farmerItemsBreakdown);
  const driverBreakdown = useItemsBreakdown(driverSection, driverItemsBreakdown);

  const merchantBreakdownGroups = useMemo(() => {
    const byId = new Map<number, { id: number; name: string; items: MerchantItemBreakdownRow[]; subtotal: number }>();
    for (const row of merchantBreakdown.rows) {
      let g = byId.get(row.merchantId);
      if (!g) { g = { id: row.merchantId, name: row.merchantName, items: [], subtotal: 0 }; byId.set(row.merchantId, g); }
      g.items.push(row);
      g.subtotal += row.totalValue;
    }
    return Array.from(byId.values());
  }, [merchantBreakdown.rows]);

  const farmerBreakdownGroups = useMemo(() => {
    const byId = new Map<number, { id: number; name: string; items: FarmerItemBreakdownRow[]; subtotal: number }>();
    for (const row of farmerBreakdown.rows) {
      let g = byId.get(row.farmerId);
      if (!g) { g = { id: row.farmerId, name: row.farmerName, items: [], subtotal: 0 }; byId.set(row.farmerId, g); }
      g.items.push(row);
      g.subtotal += row.totalValue;
    }
    return Array.from(byId.values());
  }, [farmerBreakdown.rows]);

  // transportFee is taken ONCE from the first row of each driver's group, never summed across item
  // rows — see DriverItemBreakdownRow's doc comment.
  const driverBreakdownGroups = useMemo(() => {
    const byId = new Map<number, { id: number; name: string; items: DriverItemBreakdownRow[]; transportFee: number }>();
    for (const row of driverBreakdown.rows) {
      let g = byId.get(row.driverId);
      if (!g) { g = { id: row.driverId, name: row.driverName, items: [], transportFee: row.totalTransportFee }; byId.set(row.driverId, g); }
      g.items.push(row);
    }
    return Array.from(byId.values());
  }, [driverBreakdown.rows]);

  const merchantBreakdownTotal = useMemo(() => merchantBreakdown.rows.reduce((sum, r) => sum + r.totalValue, 0), [merchantBreakdown.rows]);
  const farmerBreakdownTotal = useMemo(() => farmerBreakdown.rows.reduce((sum, r) => sum + r.totalValue, 0), [farmerBreakdown.rows]);
  const driverBreakdownTotal = useMemo(() => driverBreakdownGroups.reduce((sum, g) => sum + g.transportFee, 0), [driverBreakdownGroups]);

  // Header info for the shared Arabic WhatsApp template (lib/format.ts buildStatementMessage) —
  // same company name/phone used on the printed PDF, so a trader's WhatsApp statement reads as
  // the same template as the print-out.
  const [companyName, setCompanyName] = useState("Green Market");
  const [companyPhone, setCompanyPhone] = useState<string | null>(null);
  // Keyed by "merchantId::day" — a merchant can now have more than one WhatsApp group (one per
  // calendar day, see traderGroups below), so a plain merchantId can no longer identify "which
  // button is busy" on its own.
  const [sendingTraderKey, setSendingTraderKey] = useState<string | null>(null);

  const [sendingDriverKey, setSendingDriverKey] = useState<string | number | null>(null);
  const [sendingFarmerId, setSendingFarmerId] = useState<number | null>(null);

  // Driver tab's "طباعة فاتورة سائق" standalone shortcut — picks a driver directly and pulls every
  // one of HIS invoices within that tab's own period filter, independent of the table's selection.


  // Farmer tab's "طباعة كشف بائع" — a chosen farmer's own item lines across every one of his
  // invoices within a REQUIRED date range (own from/to inputs, separate from the tab's period filter).
  const [farmerStatementPick, setFarmerStatementPick] = useState<{ id: number; name: string } | null>(null);
  const [farmerStatementFrom, setFarmerStatementFrom] = useState("");
  const [farmerStatementTo, setFarmerStatementTo] = useState("");
  const [sellerDriverStatementPick, setSellerDriverStatementPick] = useState<{ id: number; name: string } | null>(null);
  const [sellerDriverStatementFrom, setSellerDriverStatementFrom] = useState("");
  const [sellerDriverStatementTo, setSellerDriverStatementTo] = useState("");


  useEffect(() => {
    listSettings().then((settings) => {
      const name = settings.find((s) => s.key === "market.name")?.value;
      // The number written inside the message, so whoever gets a statement about their money can
      // reply to it. market.whatsapp, NOT market.phone: the phone is the landline on the printed
      // header, and the two are usually different numbers — only one of them can receive a reply.
      //
      // Left empty it also turns WhatsApp off entirely on this page. A market that has not said
      // where it wants to be reached should not be sending people statements from nowhere.
      const phone = settings.find((s) => s.key === "market.whatsapp")?.value;
      if (name) setCompanyName(name);
      setCompanyPhone(phone || null);
    });
  }, []);

  /**
   * Whether to offer WhatsApp at all.
   *
   * Every message this page sends is built by buildStatementMessage, which writes the market's
   * own phone into the text so the person receiving a statement can call back about it. With
   * market.phone unset, the button still opened WhatsApp and still sent — a statement about
   * someone's money, from a market that gave no way to reach it. So the whole section goes,
   * rather than the buttons being disabled one by one: the tables underneath them exist to drive
   * those buttons, and a grouping nobody can act on is just more rows to read.
   */
  const whatsAppReady = Boolean(companyPhone);

  // Merchant tab: grouped by (trader + calendar day) to drive the per-trader WhatsApp statement
  // button — one message per day, never merging invoices from different days into the same
  // message (explicit requirement). The printed PDF itself is unaffected — it still prints each
  // selected invoice separately, four per page (ExportService.GenerateInvoicesBulkPdf).
  const traderGroups = useMemo(() => {
    // Only people who can actually be sent to. These three tables exist for one button; a row
    // whose button can never be pressed is a name taking up space and a reader wondering what
    // they are meant to do about it. Whoever has no number is reached some other way, and this
    // screen is not where that gets decided.
    const selectedRows = merchantSection.result.filter((i) => merchantSection.selected.has(i.id) && i.merchantWhatsApp);
    const byTrader = new Map<string, { key: string; merchantId: number; merchantName: string; merchantWhatsApp?: string | null; day: string; invoiceIds: number[]; total: number }>();
    for (const inv of selectedRows) {
      const day = formatDate(inv.date);
      const key = `${inv.merchantId}::${day}`;
      const existing = byTrader.get(key);
      if (existing) {
        existing.invoiceIds.push(inv.id);
        existing.total += inv.totalValue;
      } else {
        byTrader.set(key, {
          key,
          merchantId: inv.merchantId,
          merchantName: inv.merchantName,
          merchantWhatsApp: inv.merchantWhatsApp,
          day,
          invoiceIds: [inv.id],
          total: inv.totalValue,
        });
      }
    }
    return Array.from(byTrader.values()).sort((a, b) => a.merchantName.localeCompare(b.merchantName, "ar") || a.day.localeCompare(b.day));
  }, [merchantSection.result, merchantSection.selected]);

  // "الرصيد السابق" for this WhatsApp message has to exclude the WHOLE group of invoices being
  // bundled into it, not just one — see backend GetMerchantGroupPreviousBalanceAsync's doc comment.
  async function handleSendTraderWhatsApp(key: string, merchantId: number, phone: string, name: string, invoiceIds: number[]) {
    setSendingTraderKey(key);
    merchantSection.setError(null);
    try {
      const [invoices, previousBalance] = await Promise.all([
        getInvoicesBatch(invoiceIds),
        getMerchantGroupPreviousBalance(merchantId, invoiceIds),
      ]);
      const message = buildStatementMessage(companyName, companyPhone, name, invoices, previousBalance, "merchant");
      window.open(buildWhatsAppLink(phone, message), "_blank");
    } catch {
      merchantSection.setError("فشل تجهيز رسالة واتساب");
    } finally {
      setSendingTraderKey(null);
    }
  }

  // Farmer tab: grouped by farmer only (no day-split — that concern is specific to the merchant's
  // previous-balance double-counting risk when several of THEIR invoices are bundled together;
  // a farmer/driver's previous balance is just their own live account balance, so it doesn't
  // change no matter how the invoices are grouped).
  const farmerGroups = useMemo(() => {
    // Same as the merchant grouping above: no number, no row.
    const selectedRows = farmerSection.result.filter((i) => farmerSection.selected.has(i.id) && i.farmerId && i.farmerWhatsApp);
    const byFarmer = new Map<number, { farmerId: number; farmerName: string; farmerWhatsApp?: string | null; invoiceIds: number[]; total: number }>();
    for (const inv of selectedRows) {
      const existing = byFarmer.get(inv.farmerId!);
      if (existing) {
        existing.invoiceIds.push(inv.id);
        existing.total += inv.totalValue;
      } else {
        byFarmer.set(inv.farmerId!, {
          farmerId: inv.farmerId!,
          farmerName: inv.farmerName!,
          farmerWhatsApp: inv.farmerWhatsApp,
          invoiceIds: [inv.id],
          total: inv.totalValue,
        });
      }
    }
    return Array.from(byFarmer.values()).sort((a, b) => a.farmerName.localeCompare(b.farmerName, "ar"));
  }, [farmerSection.result, farmerSection.selected]);

  // "الرصيد السابق" here per the answered decision: the farmer's own current account balance
  // (same كشف حساب Remaining their account page shows), not a batch-excluded figure.
  async function handleSendFarmerWhatsApp(farmerId: number, phone: string, name: string, invoiceIds: number[]) {
    setSendingFarmerId(farmerId);
    farmerSection.setError(null);
    try {
      const [invoices, account] = await Promise.all([getInvoicesBatch(invoiceIds), getFarmerAccount(farmerId)]);
      // "farmer" makes the message total up HIS due (produce − commission − transport), not the
      // buyer's bill; it also turns on the commission line, which §5 shows only to him.
      const message = buildStatementMessage(companyName, companyPhone, name, invoices, account.remaining, "farmer");
      window.open(buildWhatsAppLink(phone, message), "_blank");
    } catch {
      farmerSection.setError("فشل تجهيز رسالة واتساب");
    } finally {
      setSendingFarmerId(null);
    }
  }

  // Driver tab: groups the selected invoices by driver so "تجميع حسب السائق" can hand each driver
  // ONE consolidated transport-fee sheet instead of one printout per invoice. Grouped by driverId
  // (falling back to name only for invoices that predate that field). driverWhatsApp/driverId are
  // carried through too so the same group can also drive a WhatsApp send button.
  const driverGroups = useMemo(() => {
    // Same again — and driverId too, since sending needs the account, not just the name.
    const selectedRows = driverSection.result.filter((i) => driverSection.selected.has(i.id) && i.driverName && i.driverId && i.driverWhatsApp);
    const byDriver = new Map<string | number, { key: string | number; driverId?: number | null; driverName: string; driverWhatsApp?: string | null; invoiceIds: number[]; totalDriverDue: number }>();
    for (const inv of selectedRows) {
      const key = inv.driverId ?? inv.driverName!;
      const existing = byDriver.get(key);
      if (existing) {
        existing.invoiceIds.push(inv.id);
        existing.totalDriverDue += inv.driverDue;
      } else {
        byDriver.set(key, { key, driverId: inv.driverId, driverName: inv.driverName!, driverWhatsApp: inv.driverWhatsApp, invoiceIds: [inv.id], totalDriverDue: inv.driverDue });
      }
    }
    return Array.from(byDriver.values()).sort((a, b) => a.driverName.localeCompare(b.driverName, "ar"));
  }, [driverSection.result, driverSection.selected]);


  // Same "current account balance right now" convention as the farmer send above.
  async function handleSendDriverWhatsApp(driverKey: string | number, driverId: number, phone: string, name: string, invoiceIds: number[]) {
    setSendingDriverKey(driverKey);
    driverSection.setError(null);
    try {
      const [invoices, account] = await Promise.all([getInvoicesBatch(invoiceIds), getFarmerAccount(driverId)]);
      const message = buildStatementMessage(companyName, companyPhone, name, invoices, account.remaining, "driver");
      window.open(buildWhatsAppLink(phone, message), "_blank");
    } catch {
      driverSection.setError("فشل تجهيز رسالة واتساب");
    } finally {
      setSendingDriverKey(null);
    }
  }

  // The same كشف as the per-driver card below, but it looks the driver's invoices up directly via
  // the section's own picker + period filter — no reliance on the table already showing/selecting
  // them. An empty period is raised as an error so PdfActions shows it where it shows the rest.
  async function buildDriverStandalonePdf() {
    const data = await listInvoices({ ...driverSection.buildFilter(), pageSize: 500 });
    if (data.items.length === 0) throw new Error("لا توجد فواتير لهذا السائق ضمن الفترة المحددة أعلاه.");
    return printDriverManifestPdf(data.items.map((i) => i.id));
  }

  // Downloads ExportService.GenerateFarmerStatementPdf for the picked farmer + required date range —
  // one continuous itemized statement (التاريخ/الصنف/العدد/الوزن/السعر/س.الخشب/مجموع كلي)، ثم المجموع الكلي.
  // Just the fetch — PdfActions owns the busy state, the errors and the share half.
  function buildFarmerStatementPdf() {
    const from = startOfDay(new Date(farmerStatementFrom)).toISOString();
    const to = endOfDay(new Date(farmerStatementTo)).toISOString();
    return printFarmerStatementPdf(farmerStatementPick!.id, from, to);
  }

  /**
   * The same endpoint as the seller statement above, and deliberately so: the statement itself
   * now carries a driver side and prints it whenever the person drove any of the loads in the
   * period (see backend FarmerStatementDriverSide). One document, one set of rules — a separate
   * "seller-driver statement" would be a second place for the same arithmetic to be got wrong.
   */
  function buildSellerDriverStatementPdf() {
    const from = startOfDay(new Date(sellerDriverStatementFrom)).toISOString();
    const to = endOfDay(new Date(sellerDriverStatementTo)).toISOString();
    return printFarmerStatementPdf(sellerDriverStatementPick!.id, from, to);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">طباعة الفواتير</h1>

      {/* Four tabs now, and on a phone they do not fit. Scrolling sideways keeps them all
          reachable; wrapping would put a lone tab on its own line under the others and make the
          row read as two groups of something. */}
      <div className="flex gap-2 mb-4 border-b border-gray-200 overflow-x-auto">
        {(["Merchant", "Farmer", "Driver", "SellerDriver"] as Role[]).map((role) => (
          <button
            key={role}
            className={`px-4 py-2 font-semibold rounded-t-md whitespace-nowrap shrink-0 ${activeTab === role ? "bg-brand-50 text-brand-700 border-b-2 border-brand-600" : "text-gray-500 hover:text-gray-700"}`}
            onClick={() => setActiveTab(role)}
          >
            قسم {ROLE_LABEL[role]}
          </button>
        ))}
      </div>

      <SectionFilters section={active} />

      {activeTab === "Merchant" && (
        <ItemValueBreakdownCard
          title="كشف مشتري حسب الفترة"
          nameLabel="المشتري"
          groups={merchantBreakdownGroups}
          grandTotal={merchantBreakdownTotal}
          loading={merchantBreakdown.loading}
          error={merchantBreakdown.error}
          fetchPdf={() => printBuyerStatementPdf(periodFilterFor(merchantSection))}
          fileName={`merchant-statement-by-period-${todayLocalDateString()}.pdf`}
        />
      )}

      {activeTab === "Farmer" && (
        <ItemValueBreakdownCard
          title="كشف بائع حسب الفترة"
          nameLabel="البائع"
          groups={farmerBreakdownGroups}
          grandTotal={farmerBreakdownTotal}
          loading={farmerBreakdown.loading}
          error={farmerBreakdown.error}
          fetchPdf={() => printFarmerItemsStatementPdf(periodFilterFor(farmerSection))}
          fileName={`farmer-statement-by-period-${todayLocalDateString()}.pdf`}
        />
      )}

      {activeTab === "Driver" && (
        <DriverItemBreakdownCard
          groups={driverBreakdownGroups}
          grandTotal={driverBreakdownTotal}
          loading={driverBreakdown.loading}
          error={driverBreakdown.error}
          fetchPdf={() => printDriverItemsStatementPdf(periodFilterFor(driverSection))}
          fileName={`driver-statement-by-period-${todayLocalDateString()}.pdf`}
        />
      )}

      {activeTab === "Driver" && (
        <div className="card p-4 mb-4">
          {/* Renamed from "طباعة فاتورة سائق": this button has always produced the driver's
              consolidated كشف أجرة نقل (GenerateDriverManifestPdf), not an invoice — and now that
              the section's own print button really does produce a per-invoice "فاتورة سائق", the
              old label was pointing at the wrong document. */}
          <h2 className="font-semibold mb-1">طباعة كشف السائق (مجمّع للفترة)</h2>
          <p className="text-xs text-gray-500 mb-3">استخدم حقل "تصفية حسب سائق" أعلاه لاختيار السائق — بيلمّ له تلقائيًا كل فواتيره ضمن الفترة المحددة أعلاه بكشف واحد: كل بائع وقديش إله على حدا، وبالآخر أجرة النقل والصناديق والإجمالي المقبوض. لطباعة فواتير السائق نفسها (فاتورة لكل فاتورة) استخدم زر الطباعة أسفل الجدول.</p>
          <PdfActions
            fetchPdf={buildDriverStandalonePdf}
            fileName={`driver-manifest-${driverSection.partnerPick?.name ?? ""}.pdf`}
            shareTitle="كشف السائق"
            disabled={!driverSection.partnerPick}
            printLabel="🖨️ طباعة كشف السائق"
          />
        </div>
      )}

      {activeTab === "Farmer" && (
        <div className="card p-4 mb-4">
          <h2 className="font-semibold mb-1">طباعة كشف بائع</h2>
          <p className="text-xs text-gray-500 mb-3">اختر البائع وحدد الفترة — بيطلعلك كشف بكل الأصناف اللي باعها ضمن هالفترة (التاريخ/الصنف/العدد/الوزن/السعر/س.الخشب/مجموع كلي) بصفحة واحدة، مع المجموع بالنهاية.</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full max-w-xs">
              <PartnerAutocomplete
                label="البائع" value={farmerStatementPick} onChange={setFarmerStatementPick}
                placeholder="اكتب اسم البائع واختره من القائمة..."
                types={["Farmer"]}
              />
            </div>
            <div>
              <label className="label">من تاريخ</label>
              <input type="date" className="input" value={farmerStatementFrom} onChange={(e) => setFarmerStatementFrom(e.target.value)} />
            </div>
            <div>
              <label className="label">إلى تاريخ</label>
              <input type="date" className="input" value={farmerStatementTo} onChange={(e) => setFarmerStatementTo(e.target.value)} />
            </div>
            <PdfActions
              fetchPdf={buildFarmerStatementPdf}
              fileName={`farmer-statement-${farmerStatementPick?.name ?? ""}.pdf`}
              shareTitle="كشف البائع"
              printLabel="🖨️ طباعة كشف البائع"
              disabled={!farmerStatementPick || !farmerStatementFrom || !farmerStatementTo}
            />
          </div>
        </div>
      )}

      {activeTab === "SellerDriver" && (
        <div className="card p-4 mb-4">
          <h2 className="font-semibold mb-1">كشف نهائي (بائع وسائق)</h2>
          <p className="text-xs text-gray-500 mb-3">
            اختر الشخص وحدد الفترة — بيطلعلك كشف واحد بكل التفاصيل: كل صنف باعه بسعره، ملخص الأصناف،
            والعمولة وأجرة النقل المخصومة منه كبائع، وأجرة النقل وأجرة الصناديق المستحقة إله كسائق،
            والإجمالي النهائي بالآخر.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full max-w-xs">
              <PartnerAutocomplete
                label="الشخص (بائع وسائق)" value={sellerDriverStatementPick} onChange={setSellerDriverStatementPick}
                placeholder="اكتب الاسم واختره من القائمة..."
                types={["Farmer", "Driver"]}
              />
            </div>
            <div>
              <label className="label">من تاريخ</label>
              <input type="date" className="input" value={sellerDriverStatementFrom} onChange={(e) => setSellerDriverStatementFrom(e.target.value)} />
            </div>
            <div>
              <label className="label">إلى تاريخ</label>
              <input type="date" className="input" value={sellerDriverStatementTo} onChange={(e) => setSellerDriverStatementTo(e.target.value)} />
            </div>
            <PdfActions
              fetchPdf={buildSellerDriverStatementPdf}
              fileName={`seller-driver-statement-${sellerDriverStatementPick?.name ?? ""}.pdf`}
              shareTitle="الكشف النهائي"
              printLabel="🖨️ طباعة الكشف النهائي"
              disabled={!sellerDriverStatementPick || !sellerDriverStatementFrom || !sellerDriverStatementTo}
            />
          </div>
        </div>
      )}

      <SectionTable section={active} />

      {active.error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-3 mb-4">{active.error}</div>}


      {activeTab === "Merchant" && traderGroups.length > 0 && whatsAppReady && (
        <div className="card mb-4">
          <div className="px-4 pt-4 pb-1 text-sm font-semibold text-gray-700">تجميع حسب المشتري واليوم — كل يوم برسالة واتساب منفصلة</div>
          <div className="sm:hidden">
            <CollapsibleRows
              rows={traderGroups}
              rowKey={(g) => g.key}
              title={(g) => (
                <span>
                  <PartnerLink partnerId={g.merchantId} name={g.merchantName} side="merchant" />
                  <span className="block text-xs text-gray-500">{g.day}</span>
                </span>
              )}
              value={(g) => formatCurrency(g.total)}
              details={(g) => [
                { label: "عدد الفواتير", value: g.invoiceIds.length },
                { label: "", value: (
                  <button
                    className="btn-secondary"
                    disabled={sendingTraderKey === g.key}
                    onClick={() => handleSendTraderWhatsApp(g.key, g.merchantId, g.merchantWhatsApp!, g.merchantName, g.invoiceIds)}
                  >
                    {sendingTraderKey === g.key ? "جاري التجهيز..." : "📤 إرسال واتساب"}
                  </button>
                ) },
              ]}
            />
          </div>
          <div className="hidden sm:block overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>المشتري</th>
                <th>اليوم</th>
                <th>عدد الفواتير</th>
                <th>الإجمالي</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {traderGroups.map((g) => (
                <tr key={g.key}>
                  <td><PartnerLink partnerId={g.merchantId} name={g.merchantName} side="merchant" /></td>
                  <td className="text-sm text-gray-500">{g.day}</td>
                  <td>{g.invoiceIds.length}</td>
                  <td className="font-semibold">{formatCurrency(g.total)}</td>
                  <td>
                    <button
                      className="btn-secondary"
                      disabled={sendingTraderKey === g.key}
                      onClick={() => handleSendTraderWhatsApp(g.key, g.merchantId, g.merchantWhatsApp!, g.merchantName, g.invoiceIds)}
                    >
                      {sendingTraderKey === g.key ? "جاري التجهيز..." : "📤 إرسال واتساب"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {activeTab === "Farmer" && farmerGroups.length > 0 && whatsAppReady && (
        <div className="card mb-4">
          <div className="px-4 pt-4 pb-1 text-sm font-semibold text-gray-700">تجميع حسب البائع — إرسال كشف واتساب مفصّل (يشمل الرصيد السابق وسعر الخشب)</div>
          <div className="sm:hidden">
            <CollapsibleRows
              rows={farmerGroups}
              rowKey={(g) => g.farmerId}
              title={(g) => <PartnerLink partnerId={g.farmerId} name={g.farmerName} side="seller" />}
              value={(g) => formatCurrency(g.total)}
              details={(g) => [
                { label: "عدد الفواتير", value: g.invoiceIds.length },
                { label: "", value: (
                  <button
                    className="btn-secondary"
                    disabled={sendingFarmerId === g.farmerId}
                    onClick={() => handleSendFarmerWhatsApp(g.farmerId, g.farmerWhatsApp!, g.farmerName, g.invoiceIds)}
                  >
                    {sendingFarmerId === g.farmerId ? "جاري التجهيز..." : "📤 إرسال واتساب"}
                  </button>
                ) },
              ]}
            />
          </div>
          <div className="hidden sm:block overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>البائع</th>
                <th>عدد الفواتير</th>
                <th>الإجمالي</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {farmerGroups.map((g) => (
                <tr key={g.farmerId}>
                  <td><PartnerLink partnerId={g.farmerId} name={g.farmerName} side="seller" /></td>
                  <td>{g.invoiceIds.length}</td>
                  <td className="font-semibold">{formatCurrency(g.total)}</td>
                  <td>
                    <button
                      className="btn-secondary"
                      disabled={sendingFarmerId === g.farmerId}
                      onClick={() => handleSendFarmerWhatsApp(g.farmerId, g.farmerWhatsApp!, g.farmerName, g.invoiceIds)}
                    >
                      {sendingFarmerId === g.farmerId ? "جاري التجهيز..." : "📤 إرسال واتساب"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      <SectionPrintBar section={active} />

      {activeTab === "Driver" && driverGroups.length > 0 && whatsAppReady && (
        <div className="card">
          <div className="px-4 pt-4 pb-1 text-sm font-semibold text-gray-700">تجميع حسب السائق — كشف مجمّع لكل سائق (تفصيل الباعة + أجرة النقل والصناديق)</div>
          <div className="sm:hidden">
            <CollapsibleRows
              rows={driverGroups}
              rowKey={(g) => g.key}
              title={(g) => <PartnerLink partnerId={g.driverId} name={g.driverName} side="seller" />}
              value={(g) => formatCurrency(g.totalDriverDue)}
              details={(g) => [
                { label: "عدد الفواتير", value: g.invoiceIds.length },
                { label: "", value: (
                  <div className="flex flex-wrap gap-2">
                    <PdfActions
                      fetchPdf={() => printDriverManifestPdf(g.invoiceIds)}
                      fileName={`driver-manifest-${g.driverName}.pdf`}
                      shareTitle={`كشف السائق ${g.driverName}`}
                      printLabel="🖨️ طباعة كشف السائق"
                    />
                    <button
                      className="btn-secondary"
                      disabled={sendingDriverKey === g.key}
                      onClick={() => handleSendDriverWhatsApp(g.key, g.driverId!, g.driverWhatsApp!, g.driverName, g.invoiceIds)}
                    >
                      {sendingDriverKey === g.key ? "جاري التجهيز..." : "📤 إرسال واتساب"}
                    </button>
                  </div>
                ) },
              ]}
            />
          </div>
          <div className="hidden sm:block overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>السائق</th>
                <th>عدد الفواتير</th>
                <th>المستحق للسائق</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {driverGroups.map((g) => (
                <tr key={g.key}>
                  <td className="font-medium"><PartnerLink partnerId={g.driverId} name={g.driverName} side="seller" /></td>
                  <td>{g.invoiceIds.length}</td>
                  <td className="font-semibold">{formatCurrency(g.totalDriverDue)}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <PdfActions
                        fetchPdf={() => printDriverManifestPdf(g.invoiceIds)}
                        fileName={`driver-manifest-${g.driverName}.pdf`}
                        shareTitle={`كشف السائق ${g.driverName}`}
                        printLabel="🖨️ طباعة كشف السائق"
                      />
                      <button
                        className="btn-secondary"
                        disabled={sendingDriverKey === g.key}
                        onClick={() => handleSendDriverWhatsApp(g.key, g.driverId!, g.driverWhatsApp!, g.driverName, g.invoiceIds)}
                      >
                        {sendingDriverKey === g.key ? "جاري التجهيز..." : "📤 إرسال واتساب"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
