import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { cancelInvoice, downloadInvoicePdf, getInvoice } from "../api/invoices";
import { listSettings } from "../api/settings";
import type { InvoiceDto } from "../types";
import { buildStatementMessage, buildWhatsAppLink, formatCurrency, formatDate, formatQuantity, formatWeight } from "../lib/format";
import { useAuth } from "../auth/AuthContext";
import { apiErrorMessage } from "../api/client";

export function InvoiceDetailPage() {
  const { id } = useParams();
  const { hasPermission } = useAuth();
  const [invoice, setInvoice] = useState<InvoiceDto | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Header info for the shared Arabic WhatsApp template (see lib/format.ts buildStatementMessage) —
  // same company name/phone the bulk-print page uses, so a single-invoice message and a bulk
  // trader statement read as the same template no matter which one gets sent.
  const [companyName, setCompanyName] = useState("Green Market");
  const [companyPhone, setCompanyPhone] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (id) getInvoice(Number(id)).then(setInvoice);
    listSettings().then((settings) => {
      const name = settings.find((s) => s.key === "market.name")?.value;
      const phone = settings.find((s) => s.key === "whatsapp.business_number")?.value;
      if (name) setCompanyName(name);
      setCompanyPhone(phone || null);
    });
  }, [id]);

  // Sends the invoice details as a WhatsApp text message only — no PDF file, no download,
  // no manual attach step. Just the numbers, straight to WhatsApp in one click.
  function handleSendWhatsApp(phone: string, partnerName: string) {
    if (!invoice) return;
    const message = buildStatementMessage(companyName, companyPhone, partnerName, [invoice]);
    window.open(buildWhatsAppLink(phone, message), "_blank");
  }

  // Opens the invoice's PDF (Arabic header, no invoice number, per lib/format.ts template) in a
  // new tab rather than forcing a download — the browser's own PDF viewer has a print icon right
  // there, so one click gets you from "viewing the invoice" to "printing it".
  async function handlePrint(thermal: boolean) {
    if (!invoice) return;
    setPrinting(true);
    try {
      const blob = await downloadInvoicePdf(invoice.id, thermal);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } finally {
      setPrinting(false);
    }
  }

  async function handleCancel() {
    if (!invoice) return;
    const reason = window.prompt("سبب الإلغاء:");
    if (reason === null) return;
    setError(null);
    try {
      const updated = await cancelInvoice(invoice.id, reason);
      setInvoice(updated);
    } catch (err) {
      setError(apiErrorMessage(err, "فشل إلغاء الفاتورة"));
    }
  }

  if (!invoice) return <div className="text-gray-500">جاري التحميل...</div>;

  // Not everything on the invoice is sold by weight — a box-unit line has its own total
  // instead of being folded into (or silently dropped from) the weight figure.
  const totalBoxes = invoice.items.filter((it) => it.unit === "Box").reduce((sum, it) => sum + it.quantity, 0);

  return (
    <div className="max-w-2xl">
      <Link to="/invoices" className="text-sm text-brand-700 hover:underline">← رجوع إلى قائمة الفواتير</Link>

      <div className="card p-6 mt-3">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h1 className="text-xl font-bold">فاتورة {invoice.invoiceNumber}</h1>
            <div className="text-sm text-gray-500">{formatDate(invoice.date)}</div>
          </div>
          <span className={`text-xs px-2 py-1 rounded-full ${invoice.status === "Active" ? "bg-brand-100 text-brand-800" : "bg-red-100 text-red-700"}`}>
            {invoice.status === "Active" ? "فعّالة" : "ملغاة"}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
          <div><span className="text-gray-500">التاجر:</span> <span className="font-medium">{invoice.merchantName}</span></div>
          {invoice.farmerName && (
            <div><span className="text-gray-500">المزارع:</span> <span className="font-medium">{invoice.farmerName}</span></div>
          )}
        </div>

        <table className="table-base mb-4">
          <thead>
            <tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr>
          </thead>
          <tbody>
            {invoice.items.map((item) => (
              <tr key={item.id}>
                <td>{item.itemName}</td>
                <td>{formatQuantity(item.quantity, item.unit)}</td>
                <td>{formatCurrency(item.pricePerUnit)}</td>
                <td className="font-medium">{formatCurrency(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex flex-wrap justify-between gap-2 border-t pt-3 text-sm">
          <div className="flex flex-wrap gap-4">
            {invoice.totalWeightKg > 0 && (
              <div className="text-gray-500">إجمالي الوزن: <span className="font-semibold text-gray-900">{formatWeight(invoice.totalWeightKg)}</span></div>
            )}
            {totalBoxes > 0 && (
              <div className="text-gray-500">إجمالي الصناديق: <span className="font-semibold text-gray-900">{formatQuantity(totalBoxes, "Box")}</span></div>
            )}
          </div>
          <div className="text-lg font-bold text-brand-700">{formatCurrency(invoice.totalValue)}</div>
        </div>

        {/* Note: no commission line here — requirement doc §5, the market's commission never
            appears on the merchant-facing invoice. */}

        {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-3 mt-4">{error}</div>}

        <div className="flex justify-end gap-2 mt-6 flex-wrap">
          <button className="btn-secondary" disabled={printing} onClick={() => handlePrint(false)}>
            {printing ? "جاري التجهيز..." : "🖨️ طباعة (A4)"}
          </button>
          <button className="btn-secondary" disabled={printing} onClick={() => handlePrint(true)}>
            {printing ? "جاري التجهيز..." : "🖨️ طباعة (طابعة حرارية 80mm)"}
          </button>
          {invoice.merchantWhatsApp && (
            <button className="btn-primary" onClick={() => handleSendWhatsApp(invoice.merchantWhatsApp!, invoice.merchantName)}>
              📤 إرسال للتاجر عبر واتساب
            </button>
          )}
          {invoice.farmerWhatsApp && invoice.farmerName && (
            <button className="btn-primary" onClick={() => handleSendWhatsApp(invoice.farmerWhatsApp!, invoice.farmerName!)}>
              📤 إرسال للمزارع عبر واتساب
            </button>
          )}
          {invoice.status === "Active" && hasPermission("invoices.edit") && (
            <Link to={`/invoices/${invoice.id}/edit`} className="btn-secondary">
              ✏️ تعديل الفاتورة
            </Link>
          )}
          {invoice.status === "Active" && hasPermission("invoices.cancel") && (
            <button className="btn-danger" onClick={() => { setCancelling(true); handleCancel().finally(() => setCancelling(false)); }} disabled={cancelling}>
              إلغاء الفاتورة
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
