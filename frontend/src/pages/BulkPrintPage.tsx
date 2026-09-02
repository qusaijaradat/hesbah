import { useEffect, useMemo, useState } from "react";
import { getInvoicesBatch, listInvoices, printDriverManifestPdf, printFarmerStatementPdf, printInvoicesBulkPdf, triggerBlobDownload } from "../api/invoices";
import { apiErrorMessage } from "../api/client";
import { listSettings } from "../api/settings";
import { PartnerAutocomplete } from "../components/PartnerAutocomplete";
import { buildStatementMessage, buildWhatsAppLink, formatCurrency, formatDate, formatQuantity, formatWeight, todayLocalDateString } from "../lib/format";
import type { InvoiceFilter, InvoiceListItemDto, PartnerType } from "../types";

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
      const blob = await printInvoicesBulkPdf(Array.from(selected));
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
        {section.printing ? "جاري التجهيز..." : `🖨️ طباعة فواتير ${ROLE_LABEL[section.role]} (4 بالصفحة)`}
      </button>
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

  // Header info for the shared Arabic WhatsApp template (lib/format.ts buildStatementMessage) —
  // same company name/phone used on the printed PDF, so a trader's WhatsApp statement reads as
  // the same template as the print-out.
  const [companyName, setCompanyName] = useState("Green Market");
  const [companyPhone, setCompanyPhone] = useState<string | null>(null);
  const [sendingTraderId, setSendingTraderId] = useState<number | null>(null);
  const [printingDriverKey, setPrintingDriverKey] = useState<string | number | null>(null);

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

  // Merchant tab: grouped by trader to drive the per-trader WhatsApp statement button — the printed
  // PDF itself prints each selected invoice separately, four per page (ExportService.GenerateInvoicesBulkPdf).
  const traderGroups = useMemo(() => {
    const selectedRows = merchantSection.result.filter((i) => merchantSection.selected.has(i.id));
    const byTrader = new Map<number, { merchantId: number; merchantName: string; merchantWhatsApp?: string | null; invoiceIds: number[]; total: number }>();
    for (const inv of selectedRows) {
      const existing = byTrader.get(inv.merchantId);
      if (existing) {
        existing.invoiceIds.push(inv.id);
        existing.total += inv.totalValue;
      } else {
        byTrader.set(inv.merchantId, {
          merchantId: inv.merchantId,
          merchantName: inv.merchantName,
          merchantWhatsApp: inv.merchantWhatsApp,
          invoiceIds: [inv.id],
          total: inv.totalValue,
        });
      }
    }
    return Array.from(byTrader.values()).sort((a, b) => a.merchantName.localeCompare(b.merchantName, "ar"));
  }, [merchantSection.result, merchantSection.selected]);

  async function handleSendTraderWhatsApp(traderId: number, phone: string, name: string, invoiceIds: number[]) {
    setSendingTraderId(traderId);
    merchantSection.setError(null);
    try {
      const invoices = await getInvoicesBatch(invoiceIds);
      const message = buildStatementMessage(companyName, companyPhone, name, invoices);
      window.open(buildWhatsAppLink(phone, message), "_blank");
    } catch {
      merchantSection.setError("فشل تجهيز رسالة واتساب");
    } finally {
      setSendingTraderId(null);
    }
  }

  // Driver tab: groups the selected invoices by driver so "تجميع حسب السائق" can hand each driver
  // ONE consolidated transport-fee sheet instead of one printout per invoice. Grouped by driverId
  // (falling back to name only for invoices that predate that field).
  const driverGroups = useMemo(() => {
    const selectedRows = driverSection.result.filter((i) => driverSection.selected.has(i.id) && i.driverName);
    const byDriver = new Map<string | number, { key: string | number; driverName: string; invoiceIds: number[]; totalTransportFee: number }>();
    for (const inv of selectedRows) {
      const key = inv.driverId ?? inv.driverName!;
      const existing = byDriver.get(key);
      if (existing) {
        existing.invoiceIds.push(inv.id);
        existing.totalTransportFee += inv.transportFee;
      } else {
        byDriver.set(key, { key, driverName: inv.driverName!, invoiceIds: [inv.id], totalTransportFee: inv.transportFee });
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
          <div className="px-4 pt-4 pb-1 text-sm font-semibold text-gray-700">تجميع حسب المشتري — نفس التجميع المستخدم في الطباعة</div>
          <table className="table-base">
            <thead>
              <tr>
                <th>المشتري</th>
                <th>عدد الفواتير</th>
                <th>الإجمالي</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {traderGroups.map((g) => (
                <tr key={g.merchantId}>
                  <td>{g.merchantName}</td>
                  <td>{g.invoiceIds.length}</td>
                  <td className="font-semibold">{formatCurrency(g.total)}</td>
                  <td>
                    {g.merchantWhatsApp ? (
                      <button
                        className="btn-secondary"
                        disabled={sendingTraderId === g.merchantId}
                        onClick={() => handleSendTraderWhatsApp(g.merchantId, g.merchantWhatsApp!, g.merchantName, g.invoiceIds)}
                      >
                        {sendingTraderId === g.merchantId ? "جاري التجهيز..." : "📤 إرسال واتساب"}
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
                    <button
                      className="btn-secondary"
                      disabled={printingDriverKey === g.key}
                      onClick={() => handlePrintDriverManifest(g.key, g.driverName, g.invoiceIds)}
                    >
                      {printingDriverKey === g.key ? "جاري التجهيز..." : "🖨️ طباعة كشف السائق"}
                    </button>
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
