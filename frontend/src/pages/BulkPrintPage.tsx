import { Fragment, useEffect, useMemo, useState } from "react";
import { getInvoicesBatch, getMerchantGroupPreviousBalance, listInvoices, printDriverManifestPdf, printFarmerStatementPdf, printInvoicesBulkPdf, printMerchantMergedInvoicesPdf, triggerBlobDownload } from "../api/invoices";
import { apiErrorMessage } from "../api/client";
import { getFarmerAccount } from "../api/partners";
import { driverItemsBreakdown, farmerItemsBreakdown, merchantItemsBreakdown, printBuyerStatementPdf, printDriverItemsStatementPdf, printFarmerItemsStatementPdf } from "../api/reports";
import type { ReportFilter } from "../api/reports";
import { listSettings } from "../api/settings";
import { PartnerAutocomplete } from "../components/PartnerAutocomplete";
import { buildStatementMessage, buildWhatsAppLink, formatCurrency, formatDate, formatQuantity, formatWeight, todayLocalDateString } from "../lib/format";
import type { DriverItemBreakdownRow, FarmerItemBreakdownRow, InvoiceFilter, InvoiceListItemDto, MerchantItemBreakdownRow, PartnerType, UnitOfMeasure } from "../types";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

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

type Role = "Merchant" | "Farmer" | "Driver";

const ROLE_LABEL: Record<Role, string> = { Merchant: "مشتري", Farmer: "بائع", Driver: "سائق" };
const ROLE_PARTNER_TYPES: Record<Role, PartnerType[]> = {
  Merchant: ["Merchant", "Both"],
  Farmer: ["Farmer", "Both"],
  Driver: ["Driver"],
};
const ROLE_FILE_SLUG: Record<Role, string> = { Merchant: "buyer", Farmer: "farmer", Driver: "driver" };

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
  const [result, setResult] = useState<InvoiceListItemDto[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildFilter(): InvoiceFilter {
    const dates = quickRange === "custom"
      ? {
          dateFrom: customFrom ? startOfDay(new Date(customFrom)).toISOString() : undefined,
          dateTo: customTo ? endOfDay(new Date(customTo)).toISOString() : undefined,
        }
      : rangeFor(quickRange);

    const roleFilter: Partial<InvoiceFilter> =
      role === "Merchant"
        ? { merchantId: partnerPick?.id }
        : role === "Farmer"
        ? (partnerPick ? { farmerId: partnerPick.id } : { hasFarmer: true })
        : (partnerPick ? { driverId: partnerPick.id } : { hasDriver: true });

    return {
      ...dates,
      invoiceNumberFrom: invoiceNumberFrom.trim() || undefined,
      invoiceNumberTo: invoiceNumberTo.trim() || undefined,
      status: "Active",
      page: 1,
      pageSize: 500,
      ...roleFilter,
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

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickRange, partnerPick?.id]);

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

  async function handlePrint() {
    if (selected.size === 0) return;
    setPrinting(true);
    setError(null);
    try {
      // Merchant tab (explicit request): several invoices for the same merchant on the same
      // calendar day print as ONE combined invoice, regardless of which farmer/driver supplied
      // each one — so this tab uses the merged-invoice endpoint instead of the quadrant-grid bulk
      // print the Farmer/Driver tabs still use.
      const blob = role === "Merchant"
        ? await printMerchantMergedInvoicesPdf(Array.from(selected))
        : await printInvoicesBulkPdf(Array.from(selected));
      triggerBlobDownload(blob, `invoices-${ROLE_FILE_SLUG[role]}-${todayLocalDateString()}.pdf`);
    } catch {
      setError("فشل إنشاء ملف الطباعة");
    } finally {
      setPrinting(false);
    }
  }

  const selectedRows = result.filter((i) => selected.has(i.id));
  const totals = {
    value: selectedRows.reduce((sum, i) => sum + i.totalValue, 0),
    wood: selectedRows.reduce((sum, i) => sum + i.woodTotal, 0),
    grand: selectedRows.reduce((sum, i) => sum + i.grandTotal, 0),
  };

  return {
    role,
    quickRange, setQuickRange, customFrom, setCustomFrom, customTo, setCustomTo,
    invoiceNumberFrom, setInvoiceNumberFrom, invoiceNumberTo, setInvoiceNumberTo,
    partnerPick, setPartnerPick,
    result, selected, setSelected, loading, printing, error, setError,
    buildFilter, refresh, toggleOne, toggleAll, handlePrint, totals,
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

      <div>
        <button className="btn-secondary" onClick={section.refresh} disabled={section.loading}>
          {section.loading ? "جاري البحث..." : "🔍 تطبيق الفلاتر"}
        </button>
      </div>
    </div>
  );
}

/**
 * Full-detail results table for one section — always shows سعر الخشب as its own column (never
 * folded silently into الإجمالي) plus the role-relevant remaining balance ("متبقي ...") for that
 * row's own مشتري/بائع/سائق, per the explicit requirement that both stay visibly broken out.
 */
function SectionTable({ section }: { section: RoleSection }) {
  const remainingLabel = `متبقي ${ROLE_LABEL[section.role]}`;
  function remainingOf(inv: InvoiceListItemDto): number | null | undefined {
    if (section.role === "Merchant") return inv.merchantRemaining;
    if (section.role === "Farmer") return inv.farmerRemaining;
    return inv.driverRemaining;
  }

  return (
    <div className="card overflow-x-auto mb-4">
      <table className="table-base">
        <thead>
          <tr>
            <th><input type="checkbox" checked={section.result.length > 0 && section.selected.size === section.result.length} onChange={section.toggleAll} /></th>
            <th>رقم الفاتورة</th>
            <th>التاريخ</th>
            <th>المشتري</th>
            <th>البائع</th>
            <th>السائق</th>
            <th>الأصناف</th>
            <th>الكمية</th>
            <th>القيمة</th>
            <th>سعر الخشب</th>
            <th>الإجمالي</th>
            <th>{remainingLabel}</th>
          </tr>
        </thead>
        <tbody>
          {section.loading ? (
            <tr><td colSpan={12} className="text-center text-gray-400 py-6">جاري التحميل...</td></tr>
          ) : section.result.length === 0 ? (
            <tr><td colSpan={12} className="text-center text-gray-400 py-6">لا توجد فواتير مطابقة</td></tr>
          ) : (
            section.result.map((inv) => {
              const remaining = remainingOf(inv);
              return (
                <tr key={inv.id}>
                  <td><input type="checkbox" checked={section.selected.has(inv.id)} onChange={() => section.toggleOne(inv.id)} /></td>
                  <td className="font-mono text-sm">{inv.invoiceNumber}</td>
                  <td>{formatDate(inv.date)}</td>
                  <td>{inv.merchantName}</td>
                  <td>{inv.farmerName ?? "—"}</td>
                  <td>{inv.driverName ?? "—"}</td>
                  <td className="text-xs">{inv.itemsSummary || "—"}</td>
                  <td>
                    {inv.totalWeightKg > 0 && <div>{formatWeight(inv.totalWeightKg)}</div>}
                    {inv.totalBoxes > 0 && <div>{formatQuantity(inv.totalBoxes, "Box")}</div>}
                    {inv.totalWeightKg === 0 && inv.totalBoxes === 0 && "—"}
                  </td>
                  <td className="font-semibold">{formatCurrency(inv.totalValue)}</td>
                  <td>{inv.woodTotal > 0 ? formatCurrency(inv.woodTotal) : "—"}</td>
                  <td className="font-semibold">{formatCurrency(inv.grandTotal)}</td>
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
  );
}

function SectionPrintBar({ section }: { section: RoleSection }) {
  return (
    <div className="card p-4 flex items-center justify-between flex-wrap gap-3 mb-4">
      <div className="text-sm text-gray-600 space-x-3 space-x-reverse">
        <span>محدد: <span className="font-semibold">{section.selected.size}</span> فاتورة</span>
        <span> — إجمالي القيمة: <span className="font-semibold">{formatCurrency(section.totals.value)}</span></span>
        <span> — إجمالي سعر الخشب: <span className="font-semibold">{formatCurrency(section.totals.wood)}</span></span>
        <span> — الإجمالي الكلي: <span className="font-semibold">{formatCurrency(section.totals.grand)}</span></span>
      </div>
      <button className="btn-primary" onClick={section.handlePrint} disabled={section.printing || section.selected.size === 0}>
        {section.printing
          ? "جاري التجهيز..."
          : section.role === "Merchant"
          ? `🖨️ طباعة فواتير ${ROLE_LABEL[section.role]} (فاتورة مجمّعة لكل مشتري/يوم)`
          : `🖨️ طباعة فواتير ${ROLE_LABEL[section.role]} (4 بالصفحة)`}
      </button>
    </div>
  );
}

interface BreakdownItem {
  itemName: string;
  unit: UnitOfMeasure;
  totalQuantity: number;
}

/**
 * "كشف مشتري/بائع حسب الفترة" card — one row per (person, item) grouped under a shaded bold
 * subtotal, same layout as DashboardPage's "كشف المشترين حسب الفترة" widget, reused here for both
 * the Merchant and Farmer tabs since both carry a genuine per-item price (see
 * Merchant/FarmerItemBreakdownRow's doc comments).
 */
function ItemValueBreakdownCard({
  title, nameLabel, groups, grandTotal, loading, printing, error, onPrint,
}: {
  title: string;
  nameLabel: string;
  groups: { id: number; name: string; items: (BreakdownItem & { totalValue: number })[]; subtotal: number }[];
  grandTotal: number;
  loading: boolean;
  printing: boolean;
  error: string | null;
  onPrint: () => void;
}) {
  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <h2 className="font-semibold">{title}</h2>
        {!loading && groups.length > 0 && (
          <button className="btn-secondary" disabled={printing} onClick={onPrint}>
            {printing ? "جاري التجهيز..." : "🖨️ طباعة"}
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
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
                      <td>{item.unit === "Box" ? formatQuantity(item.totalQuantity, "Box") : "—"}</td>
                      <td>{item.unit === "Kg" ? formatQuantity(item.totalQuantity, "Kg") : "—"}</td>
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
  groups, grandTotal, loading, printing, error, onPrint,
}: {
  groups: { id: number; name: string; items: BreakdownItem[]; transportFee: number }[];
  grandTotal: number;
  loading: boolean;
  printing: boolean;
  error: string | null;
  onPrint: () => void;
}) {
  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <h2 className="font-semibold">كشف سائق حسب الفترة</h2>
        {!loading && groups.length > 0 && (
          <button className="btn-secondary" disabled={printing} onClick={onPrint}>
            {printing ? "جاري التجهيز..." : "🖨️ طباعة"}
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
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
                      <td>{item.unit === "Box" ? formatQuantity(item.totalQuantity, "Box") : "—"}</td>
                      <td>{item.unit === "Kg" ? formatQuantity(item.totalQuantity, "Kg") : "—"}</td>
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
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2 mt-3">{error}</div>}
    </div>
  );
}

export function BulkPrintPage() {
  const [activeTab, setActiveTab] = useState<Role>("Merchant");

  const merchantSection = useRoleSection("Merchant");
  const farmerSection = useRoleSection("Farmer");
  const driverSection = useRoleSection("Driver");
  const sections: Record<Role, RoleSection> = { Merchant: merchantSection, Farmer: farmerSection, Driver: driverSection };
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

  async function handlePrintMerchantBreakdown() {
    merchantBreakdown.setPrinting(true);
    merchantBreakdown.setError(null);
    try {
      const blob = await printBuyerStatementPdf(periodFilterFor(merchantSection));
      triggerBlobDownload(blob, `merchant-statement-by-period-${todayLocalDateString()}.pdf`);
    } catch {
      merchantBreakdown.setError("فشل إنشاء ملف الطباعة");
    } finally {
      merchantBreakdown.setPrinting(false);
    }
  }

  async function handlePrintFarmerBreakdown() {
    farmerBreakdown.setPrinting(true);
    farmerBreakdown.setError(null);
    try {
      const blob = await printFarmerItemsStatementPdf(periodFilterFor(farmerSection));
      triggerBlobDownload(blob, `farmer-statement-by-period-${todayLocalDateString()}.pdf`);
    } catch {
      farmerBreakdown.setError("فشل إنشاء ملف الطباعة");
    } finally {
      farmerBreakdown.setPrinting(false);
    }
  }

  async function handlePrintDriverBreakdown() {
    driverBreakdown.setPrinting(true);
    driverBreakdown.setError(null);
    try {
      const blob = await printDriverItemsStatementPdf(periodFilterFor(driverSection));
      triggerBlobDownload(blob, `driver-statement-by-period-${todayLocalDateString()}.pdf`);
    } catch {
      driverBreakdown.setError("فشل إنشاء ملف الطباعة");
    } finally {
      driverBreakdown.setPrinting(false);
    }
  }

  // Header info for the shared Arabic WhatsApp template (lib/format.ts buildStatementMessage) —
  // same company name/phone used on the printed PDF, so a trader's WhatsApp statement reads as
  // the same template as the print-out.
  const [companyName, setCompanyName] = useState("Green Market");
  const [companyPhone, setCompanyPhone] = useState<string | null>(null);
  // Keyed by "merchantId::day" — a merchant can now have more than one WhatsApp group (one per
  // calendar day, see traderGroups below), so a plain merchantId can no longer identify "which
  // button is busy" on its own.
  const [sendingTraderKey, setSendingTraderKey] = useState<string | null>(null);
  const [printingDriverKey, setPrintingDriverKey] = useState<string | number | null>(null);
  const [sendingDriverKey, setSendingDriverKey] = useState<string | number | null>(null);
  const [sendingFarmerId, setSendingFarmerId] = useState<number | null>(null);

  // Driver tab's "طباعة فاتورة سائق" standalone shortcut — picks a driver directly and pulls every
  // one of HIS invoices within that tab's own period filter, independent of the table's selection.
  const [driverStandaloneBusy, setDriverStandaloneBusy] = useState(false);
  const [driverStandaloneError, setDriverStandaloneError] = useState<string | null>(null);

  // Farmer tab's "طباعة كشف بائع" — a chosen farmer's own item lines across every one of his
  // invoices within a REQUIRED date range (own from/to inputs, separate from the tab's period filter).
  const [farmerStatementPick, setFarmerStatementPick] = useState<{ id: number; name: string } | null>(null);
  const [farmerStatementFrom, setFarmerStatementFrom] = useState("");
  const [farmerStatementTo, setFarmerStatementTo] = useState("");
  const [farmerStatementBusy, setFarmerStatementBusy] = useState(false);
  const [farmerStatementError, setFarmerStatementError] = useState<string | null>(null);

  useEffect(() => {
    listSettings().then((settings) => {
      const name = settings.find((s) => s.key === "market.name")?.value;
      const phone = settings.find((s) => s.key === "whatsapp.business_number")?.value;
      if (name) setCompanyName(name);
      setCompanyPhone(phone || null);
    });
  }, []);

  // Merchant tab: grouped by (trader + calendar day) to drive the per-trader WhatsApp statement
  // button — one message per day, never merging invoices from different days into the same
  // message (explicit requirement). The printed PDF itself is unaffected — it still prints each
  // selected invoice separately, four per page (ExportService.GenerateInvoicesBulkPdf).
  const traderGroups = useMemo(() => {
    const selectedRows = merchantSection.result.filter((i) => merchantSection.selected.has(i.id));
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
      const message = buildStatementMessage(companyName, companyPhone, name, invoices, previousBalance);
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
    const selectedRows = farmerSection.result.filter((i) => farmerSection.selected.has(i.id) && i.farmerId);
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
      // Sum every invoice's own commission — this is the farmer's own message, so (unlike the
      // merchant/driver sends) the commission is shown and deducted (§5 only ever hides it from
      // the merchant; a driver has none at all).
      const commissionTotal = invoices.reduce((sum, inv) => sum + inv.commission, 0);
      const message = buildStatementMessage(companyName, companyPhone, name, invoices, account.remaining, commissionTotal);
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
    const selectedRows = driverSection.result.filter((i) => driverSection.selected.has(i.id) && i.driverName);
    const byDriver = new Map<string | number, { key: string | number; driverId?: number | null; driverName: string; driverWhatsApp?: string | null; invoiceIds: number[]; totalTransportFee: number }>();
    for (const inv of selectedRows) {
      const key = inv.driverId ?? inv.driverName!;
      const existing = byDriver.get(key);
      if (existing) {
        existing.invoiceIds.push(inv.id);
        existing.totalTransportFee += inv.transportFee;
      } else {
        byDriver.set(key, { key, driverId: inv.driverId, driverName: inv.driverName!, driverWhatsApp: inv.driverWhatsApp, invoiceIds: [inv.id], totalTransportFee: inv.transportFee });
      }
    }
    return Array.from(byDriver.values()).sort((a, b) => a.driverName.localeCompare(b.driverName, "ar"));
  }, [driverSection.result, driverSection.selected]);

  async function handlePrintDriverManifest(driverKey: string | number, driverName: string, invoiceIds: number[]) {
    setPrintingDriverKey(driverKey);
    driverSection.setError(null);
    try {
      const blob = await printDriverManifestPdf(invoiceIds);
      triggerBlobDownload(blob, `driver-manifest-${driverName}.pdf`);
    } catch {
      driverSection.setError("فشل إنشاء كشف السائق");
    } finally {
      setPrintingDriverKey(null);
    }
  }

  // Same "current account balance right now" convention as the farmer send above.
  async function handleSendDriverWhatsApp(driverKey: string | number, driverId: number, phone: string, name: string, invoiceIds: number[]) {
    setSendingDriverKey(driverKey);
    driverSection.setError(null);
    try {
      const [invoices, account] = await Promise.all([getInvoicesBatch(invoiceIds), getFarmerAccount(driverId)]);
      const message = buildStatementMessage(companyName, companyPhone, name, invoices, account.remaining);
      window.open(buildWhatsAppLink(phone, message), "_blank");
    } catch {
      driverSection.setError("فشل تجهيز رسالة واتساب");
    } finally {
      setSendingDriverKey(null);
    }
  }

  // Same PDF as handlePrintDriverManifest, but looks the driver's invoices up directly via the
  // section's own picker + period filter — no reliance on the table already showing/selecting them.
  async function handlePrintDriverStandalone() {
    if (!driverSection.partnerPick) return;
    setDriverStandaloneBusy(true);
    setDriverStandaloneError(null);
    try {
      const data = await listInvoices({ ...driverSection.buildFilter(), pageSize: 500 });
      if (data.items.length === 0) {
        setDriverStandaloneError("لا توجد فواتير لهذا السائق ضمن الفترة المحددة أعلاه.");
        return;
      }
      const blob = await printDriverManifestPdf(data.items.map((i) => i.id));
      triggerBlobDownload(blob, `driver-manifest-${driverSection.partnerPick.name}.pdf`);
    } catch {
      setDriverStandaloneError("فشل إنشاء كشف السائق");
    } finally {
      setDriverStandaloneBusy(false);
    }
  }

  // Downloads ExportService.GenerateFarmerStatementPdf for the picked farmer + required date range —
  // one continuous itemized statement (التاريخ/الصنف/العدد/الوزن/السعر/س.الخشب/مجموع كلي)، ثم المجموع الكلي.
  async function handlePrintFarmerStatement() {
    if (!farmerStatementPick || !farmerStatementFrom || !farmerStatementTo) return;
    setFarmerStatementBusy(true);
    setFarmerStatementError(null);
    try {
      const from = startOfDay(new Date(farmerStatementFrom)).toISOString();
      const to = endOfDay(new Date(farmerStatementTo)).toISOString();
      const blob = await printFarmerStatementPdf(farmerStatementPick.id, from, to);
      triggerBlobDownload(blob, `farmer-statement-${farmerStatementPick.name}.pdf`);
    } catch (err) {
      setFarmerStatementError(apiErrorMessage(err, "فشل إنشاء كشف البائع"));
    } finally {
      setFarmerStatementBusy(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">طباعة الفواتير</h1>

      <div className="flex gap-2 mb-4 border-b border-gray-200">
        {(["Merchant", "Farmer", "Driver"] as Role[]).map((role) => (
          <button
            key={role}
            className={`px-4 py-2 font-semibold rounded-t-md ${activeTab === role ? "bg-brand-50 text-brand-700 border-b-2 border-brand-600" : "text-gray-500 hover:text-gray-700"}`}
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
          printing={merchantBreakdown.printing}
          error={merchantBreakdown.error}
          onPrint={handlePrintMerchantBreakdown}
        />
      )}

      {activeTab === "Farmer" && (
        <ItemValueBreakdownCard
          title="كشف بائع حسب الفترة"
          nameLabel="البائع"
          groups={farmerBreakdownGroups}
          grandTotal={farmerBreakdownTotal}
          loading={farmerBreakdown.loading}
          printing={farmerBreakdown.printing}
          error={farmerBreakdown.error}
          onPrint={handlePrintFarmerBreakdown}
        />
      )}

      {activeTab === "Driver" && (
        <DriverItemBreakdownCard
          groups={driverBreakdownGroups}
          grandTotal={driverBreakdownTotal}
          loading={driverBreakdown.loading}
          printing={driverBreakdown.printing}
          error={driverBreakdown.error}
          onPrint={handlePrintDriverBreakdown}
        />
      )}

      {activeTab === "Driver" && (
        <div className="card p-4 mb-4">
          <h2 className="font-semibold mb-1">طباعة فاتورة سائق</h2>
          <p className="text-xs text-gray-500 mb-3">استخدم حقل "تصفية حسب سائق" أعلاه لاختيار السائق — بيلمّ له تلقائيًا كل فواتيره ضمن الفترة المحددة أعلاه.</p>
          <button className="btn-primary" disabled={!driverSection.partnerPick || driverStandaloneBusy} onClick={handlePrintDriverStandalone}>
            {driverStandaloneBusy ? "جاري التجهيز..." : "🖨️ طباعة فاتورة السائق"}
          </button>
          {driverStandaloneError && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2 mt-3">{driverStandaloneError}</div>}
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
                types={["Farmer", "Both"]}
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
            <button className="btn-primary" disabled={!farmerStatementPick || !farmerStatementFrom || !farmerStatementTo || farmerStatementBusy} onClick={handlePrintFarmerStatement}>
              {farmerStatementBusy ? "جاري التجهيز..." : "🖨️ طباعة كشف البائع"}
            </button>
          </div>
          {farmerStatementError && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2 mt-3">{farmerStatementError}</div>}
        </div>
      )}

      <SectionTable section={active} />

      {active.error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-3 mb-4">{active.error}</div>}

      {activeTab === "Merchant" && traderGroups.length > 0 && (
        <div className="card overflow-x-auto mb-4">
          <div className="px-4 pt-4 pb-1 text-sm font-semibold text-gray-700">تجميع حسب المشتري واليوم — كل يوم برسالة واتساب منفصلة</div>
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
                  <td>{g.merchantName}</td>
                  <td className="text-sm text-gray-500">{g.day}</td>
                  <td>{g.invoiceIds.length}</td>
                  <td className="font-semibold">{formatCurrency(g.total)}</td>
                  <td>
                    {g.merchantWhatsApp ? (
                      <button
                        className="btn-secondary"
                        disabled={sendingTraderKey === g.key}
                        onClick={() => handleSendTraderWhatsApp(g.key, g.merchantId, g.merchantWhatsApp!, g.merchantName, g.invoiceIds)}
                      >
                        {sendingTraderKey === g.key ? "جاري التجهيز..." : "📤 إرسال واتساب"}
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">لا يوجد رقم واتساب</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "Farmer" && farmerGroups.length > 0 && (
        <div className="card overflow-x-auto mb-4">
          <div className="px-4 pt-4 pb-1 text-sm font-semibold text-gray-700">تجميع حسب البائع — إرسال كشف واتساب مفصّل (يشمل الرصيد السابق وسعر الخشب)</div>
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
                  <td>{g.farmerName}</td>
                  <td>{g.invoiceIds.length}</td>
                  <td className="font-semibold">{formatCurrency(g.total)}</td>
                  <td>
                    {g.farmerWhatsApp ? (
                      <button
                        className="btn-secondary"
                        disabled={sendingFarmerId === g.farmerId}
                        onClick={() => handleSendFarmerWhatsApp(g.farmerId, g.farmerWhatsApp!, g.farmerName, g.invoiceIds)}
                      >
                        {sendingFarmerId === g.farmerId ? "جاري التجهيز..." : "📤 إرسال واتساب"}
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">لا يوجد رقم واتساب</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SectionPrintBar section={active} />

      {activeTab === "Driver" && driverGroups.length > 0 && (
        <div className="card overflow-x-auto">
          <div className="px-4 pt-4 pb-1 text-sm font-semibold text-gray-700">تجميع حسب السائق — كشف أجرة نقل مجمّع لكل سائق</div>
          <table className="table-base">
            <thead>
              <tr>
                <th>السائق</th>
                <th>عدد الفواتير</th>
                <th>إجمالي أجرة النقل</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {driverGroups.map((g) => (
                <tr key={g.key}>
                  <td className="font-medium">{g.driverName}</td>
                  <td>{g.invoiceIds.length}</td>
                  <td className="font-semibold">{formatCurrency(g.totalTransportFee)}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="btn-secondary"
                        disabled={printingDriverKey === g.key}
                        onClick={() => handlePrintDriverManifest(g.key, g.driverName, g.invoiceIds)}
                      >
                        {printingDriverKey === g.key ? "جاري التجهيز..." : "🖨️ طباعة كشف السائق"}
                      </button>
                      {g.driverId && g.driverWhatsApp ? (
                        <button
                          className="btn-secondary"
                          disabled={sendingDriverKey === g.key}
                          onClick={() => handleSendDriverWhatsApp(g.key, g.driverId!, g.driverWhatsApp!, g.driverName, g.invoiceIds)}
                        >
                          {sendingDriverKey === g.key ? "جاري التجهيز..." : "📤 إرسال واتساب"}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400 self-center">لا يوجد رقم واتساب</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
