import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { downloadInvoicePdf, downloadInvoicesExcel, getInvoice, listInvoices, triggerBlobDownload } from "../api/invoices";
import { listSettings } from "../api/settings";
import type { InvoiceFilter, InvoiceListItemDto } from "../types";
import { buildStatementMessage, buildWhatsAppLink, formatCurrency, formatDate, formatQuantity, formatWeight } from "../lib/format";
import { shareFile } from "../lib/share";
import { useAuth } from "../auth/AuthContext";

const STATUS_LABELS: Record<string, string> = { Active: "فعّالة", Cancelled: "ملغاة" };

export function InvoicesPage() {
  const { hasPermission } = useAuth();
  const [filter, setFilter] = useState<InvoiceFilter>({ page: 1, pageSize: 25 });
  const [result, setResult] = useState<{ items: InvoiceListItemDto[]; totalCount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  // Header info for the shared Arabic WhatsApp template (lib/format.ts buildStatementMessage) —
  // same one used on the invoice detail page and the bulk-print page, so a message sent straight
  // from this list reads exactly the same.
  const [companyName, setCompanyName] = useState("Green Market");
  const [companyPhone, setCompanyPhone] = useState<string | null>(null);
  // Tracks which row's button is mid-send ("<invoiceId>-merchant" / "<invoiceId>-farmer") so only
  // that one button shows a busy state while its invoice detail is being fetched.
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  // Informational (not an error) — e.g. "your browser can't share files, downloaded it instead".
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    listSettings().then((settings) => {
      const name = settings.find((s) => s.key === "market.name")?.value;
      const phone = settings.find((s) => s.key === "whatsapp.business_number")?.value;
      if (name) setCompanyName(name);
      setCompanyPhone(phone || null);
    });
  }, []);

  async function refresh() {
    setLoading(true);
    setResult(await listInvoices(filter));
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function handleExport() {
    const blob = await downloadInvoicesExcel(filter);
    triggerBlobDownload(blob, "invoices.xlsx");
  }

  // One click, straight from the list — no need to open the invoice's detail page first.
  // Fetches the full item-level invoice (the list rows don't carry items) then sends the same
  // template used everywhere else.
  async function handleSendWhatsApp(inv: InvoiceListItemDto, role: "merchant" | "farmer") {
    const phone = role === "merchant" ? inv.merchantWhatsApp : inv.farmerWhatsApp;
    const name = role === "merchant" ? inv.merchantName : inv.farmerName;
    if (!phone || !name) return;
    setSendingKey(`${inv.id}-${role}`);
    try {
      const invoice = await getInvoice(inv.id);
      const message = buildStatementMessage(companyName, companyPhone, name, [invoice]);
      window.open(buildWhatsAppLink(phone, message), "_blank");
    } finally {
      setSendingKey(null);
    }
  }

  // Shares the actual PDF as a FILE through the OS/browser's native share sheet — see
  // lib/share.ts for why there's no way to also pre-pick the recipient automatically. Falls back
  // to a plain download when the browser/OS can't share files at all. Doesn't need a known
  // WhatsApp number (unlike the text-send buttons below) since the person picks who to send it to
  // themselves in the share sheet.
  async function handleShareFile(inv: InvoiceListItemDto) {
    setSendingKey(`${inv.id}-share`);
    setNotice(null);
    try {
      const blob = await downloadInvoicePdf(inv.id, false);
      const fileName = `${inv.invoiceNumber}.pdf`;
      const result = await shareFile(blob, fileName, "application/pdf", `فاتورة ${inv.invoiceNumber}`);
      if (result === "unsupported") {
        triggerBlobDownload(blob, fileName);
        setNotice("متصفحك ما بيدعم المشاركة المباشرة — تم تنزيل ملف الفاتورة، ترفقه يدويًا بمحادثة واتساب.");
      }
    } finally {
      setSendingKey(null);
    }
  }

  return (
    <div>
      {notice && <div className="text-sm text-blue-700 bg-blue-50 rounded-md p-3 mb-4">{notice}</div>}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">الفواتير</h1>
        <div className="flex gap-2">
          {hasPermission("reports.export") && (
            <button className="btn-secondary" onClick={handleExport}>تصدير Excel</button>
          )}
          {hasPermission("invoices.view") && (
            <Link to="/invoices/print" className="btn-secondary">🖨️ طباعة فواتير</Link>
          )}
          {hasPermission("invoices.create") && (
            <Link to="/invoices/new" className="btn-primary">+ فاتورة جديدة</Link>
          )}
        </div>
      </div>

      <div className="card p-4 mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className="label">من تاريخ</label>
          <input type="date" className="input" onChange={(e) => setFilter((f) => ({ ...f, dateFrom: e.target.value ? new Date(e.target.value).toISOString() : undefined, page: 1 }))} />
        </div>
        <div>
          <label className="label">إلى تاريخ</label>
          <input type="date" className="input" onChange={(e) => setFilter((f) => ({ ...f, dateTo: e.target.value ? new Date(e.target.value).toISOString() : undefined, page: 1 }))} />
        </div>
        <div>
          <label className="label">رقم الفاتورة</label>
          <input className="input" onChange={(e) => setFilter((f) => ({ ...f, invoiceNumber: e.target.value || undefined, page: 1 }))} />
        </div>
        <div>
          <label className="label">اسم الصنف</label>
          <input className="input" onChange={(e) => setFilter((f) => ({ ...f, itemName: e.target.value || undefined, page: 1 }))} />
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>رقم الفاتورة</th>
              <th>التاريخ</th>
              <th>التاجر</th>
              <th>البائع/السائق</th>
              <th>الكمية</th>
              <th>القيمة</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center text-gray-400 py-6">جاري التحميل...</td></tr>
            ) : !result || result.items.length === 0 ? (
              <tr><td colSpan={8} className="text-center text-gray-400 py-6">لا توجد فواتير</td></tr>
            ) : (
              result.items.map((inv) => (
                <tr key={inv.id}>
                  <td className="font-mono text-sm">{inv.invoiceNumber}</td>
                  <td>{formatDate(inv.date)}</td>
                  <td>{inv.merchantName}</td>
                  <td>{inv.farmerName ?? "—"}</td>
                  <td>
                    {/* Not everything is sold by weight — a box-only invoice has totalWeightKg
                        === 0, which on its own looks like an empty/broken row, so show whichever
                        of the two actually apply instead of always printing "0.000 كغم". */}
                    {inv.totalWeightKg > 0 && <div>{formatWeight(inv.totalWeightKg)}</div>}
                    {inv.totalBoxes > 0 && <div>{formatQuantity(inv.totalBoxes, "Box")}</div>}
                    {inv.totalWeightKg === 0 && inv.totalBoxes === 0 && "—"}
                  </td>
                  <td className="font-semibold">{formatCurrency(inv.totalValue)}</td>
                  <td>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${inv.status === "Active" ? "bg-brand-100 text-brand-800" : "bg-red-100 text-red-700"}`}>
                      {STATUS_LABELS[inv.status]}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link to={`/invoices/${inv.id}`} className="text-brand-700 text-sm hover:underline">تفاصيل</Link>
                      {inv.status === "Active" && hasPermission("invoices.edit") && (
                        <Link to={`/invoices/${inv.id}/edit`} className="text-brand-700 text-sm hover:underline">✏️ تعديل</Link>
                      )}
                      {inv.merchantWhatsApp && (
                        <button
                          className="text-xs text-green-700 hover:underline disabled:opacity-50"
                          title={`إرسال للتاجر ${inv.merchantName} عبر واتساب`}
                          disabled={sendingKey === `${inv.id}-merchant`}
                          onClick={() => handleSendWhatsApp(inv, "merchant")}
                        >
                          📤 تاجر
                        </button>
                      )}
                      {inv.farmerWhatsApp && (
                        <button
                          className="text-xs text-green-700 hover:underline disabled:opacity-50"
                          title={`إرسال للبائع/السائق ${inv.farmerName} عبر واتساب`}
                          disabled={sendingKey === `${inv.id}-farmer`}
                          onClick={() => handleSendWhatsApp(inv, "farmer")}
                        >
                          📤 بائع/سائق
                        </button>
                      )}
                      <button
                        className="text-xs text-brand-700 hover:underline disabled:opacity-50"
                        title="مشاركة ملف الفاتورة (يفتح قائمة مشاركة النظام، فيها واتساب لو مثبت)"
                        disabled={sendingKey === `${inv.id}-share`}
                        onClick={() => handleShareFile(inv)}
                      >
                        📎 ملف
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {result && result.totalCount > (filter.pageSize ?? 25) && (
        <div className="flex justify-center gap-2 mt-4">
          <button className="btn-secondary" disabled={(filter.page ?? 1) <= 1}
            onClick={() => setFilter((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}>السابق</button>
          <span className="text-sm text-gray-500 self-center">صفحة {filter.page ?? 1}</span>
          <button className="btn-secondary" disabled={(filter.page ?? 1) * (filter.pageSize ?? 25) >= result.totalCount}
            onClick={() => setFilter((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}>التالي</button>
        </div>
      )}
    </div>
  );
}
