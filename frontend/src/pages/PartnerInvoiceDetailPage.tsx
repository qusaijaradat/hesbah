import { Fragment, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getFarmerInvoiceDetail, getMerchantInvoiceDetail,
  printFarmerInvoiceDetailPdf, printMerchantInvoiceDetailPdf,
} from "../api/partners";
import { triggerBlobDownload } from "../api/invoices";
import { apiErrorMessage } from "../api/client";
import { formatCurrency, formatDate, formatQuantity } from "../lib/format";
import type { PartnerInvoiceDetailDto, PartnerInvoiceItemLineDto } from "../types";

/// <summary>
/// "قيمة الديون" drill-down — a standalone page (opened in a new tab from the debts overview, per
/// explicit request) listing EVERY item line off EVERY one of this partner's own invoices, all-time
/// (no date filter, same convention as the debt amount itself being an all-time running total), so
/// the bare number on "قيمة الديون" is traceable back to exactly which invoices/items/quantities/
/// prices make it up. Shared by both the بائع/سائق and المشتري sides — only the fetch function and
/// title differ (see FarmerInvoiceDetailPage/MerchantInvoiceDetailPage below), same split as
/// PartnerAccountPage's own FarmerAccountPage/MerchantAccountPage.
/// </summary>
function InvoiceDetailView({ title, fetcher, printer }: {
  title: string;
  fetcher: (id: number) => Promise<PartnerInvoiceDetailDto>;
  printer: (id: number) => Promise<Blob>;
}) {
  const { id } = useParams();
  const [detail, setDetail] = useState<PartnerInvoiceDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    fetcher(Number(id))
      .then(setDetail)
      .catch(() => setError("فشل تحميل تفاصيل الفواتير"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handlePrint() {
    if (!id) return;
    setPrinting(true);
    setPrintError(null);
    try {
      const blob = await printer(Number(id));
      triggerBlobDownload(blob, `invoice-detail-${id}.pdf`);
    } catch (err) {
      setPrintError(apiErrorMessage(err, "فشل إنشاء ملف الطباعة"));
    } finally {
      setPrinting(false);
    }
  }

  // Grouped by invoice — an invoice can have more than one item line, and TransportFee/GrandTotal
  // are invoice-level (never per item), so they're only ever read once per group here (see
  // PartnerInvoiceItemLineDto's doc comment).
  const groups: { invoiceId: number; invoiceNumber: string; date: string; items: PartnerInvoiceItemLineDto[]; transportFee: number; grandTotal: number }[] = [];
  const byInvoice = new Map<number, (typeof groups)[number]>();
  for (const line of detail?.lines ?? []) {
    let g = byInvoice.get(line.invoiceId);
    if (!g) {
      g = { invoiceId: line.invoiceId, invoiceNumber: line.invoiceNumber, date: line.date, items: [], transportFee: line.transportFee, grandTotal: line.grandTotal };
      byInvoice.set(line.invoiceId, g);
      groups.push(g);
    }
    g.items.push(line);
  }
  const grandTotalSum = groups.reduce((sum, g) => sum + g.grandTotal, 0);

  return (
    <div>
      <Link to="/debts" className="text-sm text-brand-700 hover:underline">← رجوع إلى قيمة الديون</Link>
      <div className="flex items-start justify-between flex-wrap gap-3 mt-2 mb-1">
        <h1 className="text-2xl font-bold">{title}{detail ? `: ${detail.partnerName}` : ""}</h1>
        <div className="flex items-center gap-2">
          <button className="btn-secondary" onClick={handlePrint} disabled={printing || !detail}>
            {printing ? "جاري التجهيز..." : "🖨️ طباعة"}
          </button>
          {printError && <span className="text-sm text-red-600">{printError}</span>}
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-6">كل الفواتير المسجّلة لهذا الشخص، مفصّلة بكل صنف وكمية وسعر — لمعرفة مصدر المبلغ بالضبط.</p>

      {loading ? (
        <div className="text-gray-500">جاري التحميل...</div>
      ) : error ? (
        <div className="text-sm text-red-600 bg-red-50 rounded-md p-3">{error}</div>
      ) : groups.length === 0 ? (
        <div className="text-gray-400">لا توجد فواتير مسجّلة لهذا الشخص بعد</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>التاريخ</th><th>رقم الفاتورة</th><th>الصنف</th><th>العدد</th><th>الوزن</th><th>السعر</th><th>سعر الخشب</th><th>الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.invoiceId}>
                  {g.items.map((line, idx) => (
                    <tr key={idx}>
                      <td className="whitespace-nowrap">{formatDate(g.date)}</td>
                      <td>
                        <Link to={`/invoices/${g.invoiceId}`} className="text-brand-700 hover:underline font-mono text-sm">{g.invoiceNumber}</Link>
                      </td>
                      <td>{line.itemName}</td>
                      <td>{line.unit === "Box" ? formatQuantity(line.quantity, "Box") : "—"}</td>
                      <td>{line.unit === "Kg" ? formatQuantity(line.quantity, "Kg") : "—"}</td>
                      <td>{formatCurrency(line.pricePerUnit)}</td>
                      <td>{line.woodPrice > 0 ? formatCurrency(line.woodPrice) : "—"}</td>
                      <td>—</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50">
                    <td colSpan={7} className="font-semibold text-gray-600">
                      إجمالي الفاتورة {g.invoiceNumber}
                      {g.transportFee > 0 && <span className="text-xs text-gray-400 font-normal"> (شامل أجرة نقل {formatCurrency(g.transportFee)})</span>}
                    </td>
                    <td className="font-semibold">{formatCurrency(g.grandTotal)}</td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={7} className="font-semibold">الإجمالي الكلي</td>
                <td className="font-bold">{formatCurrency(grandTotalSum)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

export function FarmerInvoiceDetailPage() {
  return <InvoiceDetailView title="تفاصيل ديون بائع/سائق" fetcher={getFarmerInvoiceDetail} printer={printFarmerInvoiceDetailPdf} />;
}

export function MerchantInvoiceDetailPage() {
  return <InvoiceDetailView title="تفاصيل ديون مشتري" fetcher={getMerchantInvoiceDetail} printer={printMerchantInvoiceDetailPdf} />;
}
