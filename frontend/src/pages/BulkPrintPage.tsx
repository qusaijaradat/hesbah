import { useEffect, useMemo, useState } from "react";
import { getInvoicesBatch, listInvoices, printInvoicesBulkPdf, triggerBlobDownload } from "../api/invoices";
import { listSettings } from "../api/settings";
import { buildStatementMessage, buildWhatsAppLink, formatCurrency, formatDate, formatQuantity, formatWeight, todayLocalDateString } from "../lib/format";
import type { InvoiceFilter, InvoiceListItemDto } from "../types";

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

export function BulkPrintPage() {
  const [quickRange, setQuickRange] = useState<QuickRange>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [invoiceNumberFrom, setInvoiceNumberFrom] = useState("");
  const [invoiceNumberTo, setInvoiceNumberTo] = useState("");
  const [result, setResult] = useState<InvoiceListItemDto[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Header info for the shared Arabic WhatsApp template (lib/format.ts buildStatementMessage) —
  // same company name/phone used on the printed PDF, so a trader's WhatsApp statement reads as
  // the same template as the print-out.
  const [companyName, setCompanyName] = useState("Green Market");
  const [companyPhone, setCompanyPhone] = useState<string | null>(null);
  const [sendingTraderId, setSendingTraderId] = useState<number | null>(null);

  useEffect(() => {
    listSettings().then((settings) => {
      const name = settings.find((s) => s.key === "market.name")?.value;
      const phone = settings.find((s) => s.key === "whatsapp.business_number")?.value;
      if (name) setCompanyName(name);
      setCompanyPhone(phone || null);
    });
  }, []);

  function buildFilter(): InvoiceFilter {
    const dates = quickRange === "custom"
      ? {
          dateFrom: customFrom ? startOfDay(new Date(customFrom)).toISOString() : undefined,
          dateTo: customTo ? endOfDay(new Date(customTo)).toISOString() : undefined,
        }
      : rangeFor(quickRange);

    return {
      ...dates,
      invoiceNumberFrom: invoiceNumberFrom.trim() || undefined,
      invoiceNumberTo: invoiceNumberTo.trim() || undefined,
      status: "Active",
      page: 1,
      pageSize: 500,
    };
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const data = await listInvoices(buildFilter());
      setResult(data.items);
      setSelected(new Set(data.items.map((i) => i.id)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickRange]);

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
      triggerBlobDownload(blob, `invoices-bulk-${todayLocalDateString()}.pdf`);
    } catch {
      setError("فشل إنشاء ملف الطباعة");
    } finally {
      setPrinting(false);
    }
  }

  const totalValue = result.filter((i) => selected.has(i.id)).reduce((sum, i) => sum + i.totalValue, 0);

  // Grouped by trader here only to drive the per-trader WhatsApp statement button below — the
  // printed PDF itself no longer merges invoices by trader; it prints each selected invoice
  // separately, four per page (see ExportService.GenerateInvoicesBulkPdf).
  const traderGroups = useMemo(() => {
    const selectedRows = result.filter((i) => selected.has(i.id));
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
  }, [result, selected]);

  // Fetches full item-level detail for just this trader's selected invoices, then sends the
  // same Arabic template (lib/format.ts buildStatementMessage) used by the printed PDF.
  async function handleSendTraderWhatsApp(traderId: number, phone: string, name: string, invoiceIds: number[]) {
    setSendingTraderId(traderId);
    setError(null);
    try {
      const invoices = await getInvoicesBatch(invoiceIds);
      const message = buildStatementMessage(companyName, companyPhone, name, invoices);
      window.open(buildWhatsAppLink(phone, message), "_blank");
    } catch {
      setError("فشل تجهيز رسالة واتساب");
    } finally {
      setSendingTraderId(null);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">طباعة الفواتير</h1>

      <div className="card p-4 mb-4 space-y-4">
        <div>
          <label className="label">الفترة</label>
          <div className="flex flex-wrap gap-2">
            {QUICK_RANGES.map((r) => (
              <button
                key={r.value}
                className={quickRange === r.value ? "btn-primary" : "btn-secondary"}
                onClick={() => setQuickRange(r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {quickRange === "custom" && (
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <div>
              <label className="label">من تاريخ</label>
              <input type="date" className="input" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </div>
            <div>
              <label className="label">إلى تاريخ</label>
              <input type="date" className="input" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 max-w-md">
          <div>
            <label className="label">من رقم فاتورة</label>
            <input className="input" placeholder="مثال: INV-2026-000010" value={invoiceNumberFrom}
              onChange={(e) => setInvoiceNumberFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">إلى رقم فاتورة</label>
            <input className="input" placeholder="مثال: INV-2026-000020" value={invoiceNumberTo}
              onChange={(e) => setInvoiceNumberTo(e.target.value)} />
          </div>
        </div>

        <div>
          <button className="btn-secondary" onClick={refresh} disabled={loading}>
            {loading ? "جاري البحث..." : "🔍 تطبيق الفلاتر"}
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto mb-4">
        <table className="table-base">
          <thead>
            <tr>
              <th><input type="checkbox" checked={result.length > 0 && selected.size === result.length} onChange={toggleAll} /></th>
              <th>رقم الفاتورة</th>
              <th>التاريخ</th>
              <th>التاجر</th>
              <th>البائع/السائق</th>
              <th>الكمية</th>
              <th>القيمة</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center text-gray-400 py-6">جاري التحميل...</td></tr>
            ) : result.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-gray-400 py-6">لا توجد فواتير مطابقة</td></tr>
            ) : (
              result.map((inv) => (
                <tr key={inv.id}>
                  <td><input type="checkbox" checked={selected.has(inv.id)} onChange={() => toggleOne(inv.id)} /></td>
                  <td className="font-mono text-sm">{inv.invoiceNumber}</td>
                  <td>{formatDate(inv.date)}</td>
                  <td>{inv.merchantName}</td>
                  <td>{inv.farmerName ?? "—"}</td>
                  <td>
                    {inv.totalWeightKg > 0 && <div>{formatWeight(inv.totalWeightKg)}</div>}
                    {inv.totalBoxes > 0 && <div>{formatQuantity(inv.totalBoxes, "Box")}</div>}
                    {inv.totalWeightKg === 0 && inv.totalBoxes === 0 && "—"}
                  </td>
                  <td className="font-semibold">{formatCurrency(inv.totalValue)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-3 mb-4">{error}</div>}

      {traderGroups.length > 0 && (
        <div className="card overflow-x-auto mb-4">
          <div className="px-4 pt-4 pb-1 text-sm font-semibold text-gray-700">تجميع حسب التاجر — نفس التجميع المستخدم في الطباعة</div>
          <table className="table-base">
            <thead>
              <tr>
                <th>التاجر</th>
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

      <div className="card p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-gray-600">
          محدد: <span className="font-semibold">{selected.size}</span> فاتورة — إجمالي القيمة: <span className="font-semibold">{formatCurrency(totalValue)}</span>
        </div>
        <button className="btn-primary" onClick={handlePrint} disabled={printing || selected.size === 0}>
          {printing ? "جاري التجهيز..." : "🖨️ طباعة (4 فواتير بالصفحة)"}
        </button>
      </div>
    </div>
  );
}
