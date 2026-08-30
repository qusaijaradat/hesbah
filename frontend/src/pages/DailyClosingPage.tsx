import { useEffect, useState } from "react";
import { StatCard } from "../components/StatCard";
import { dailyClosingReport, exportDailyClosingPdf } from "../api/reports";
import { triggerBlobDownload } from "../api/invoices";
import { formatCurrency, todayLocalDateString } from "../lib/format";
import type { DailyClosingDto } from "../types";

export function DailyClosingPage() {
  const [date, setDate] = useState(() => todayLocalDateString());
  const [closing, setClosing] = useState<DailyClosingDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    // Same "treat the date-only string as its own UTC midnight" convention used everywhere
    // else invoice/payment dates are picked (see InvoicesPage's date filters, InvoiceNewPage) —
    // keeping it consistent matters more here than local-timezone precision, since that's how
    // every date this report totals up (invoices, payments, expenses) was itself stored.
    const iso = new Date(date).toISOString();
    dailyClosingReport(iso).then((data) => {
      setClosing(data);
      setLoading(false);
    });
  }, [date]);

  async function handlePrint() {
    const blob = await exportDailyClosingPdf(new Date(date).toISOString());
    triggerBlobDownload(blob, `daily-closing-${date}.pdf`);
  }

  const netCashFlow = closing
    ? closing.paymentsReceivedFromMerchants - closing.paymentsPaidToFarmers - closing.totalExpenses
    : 0;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold">الإغلاق اليومي</h1>
        <div className="flex items-center gap-2">
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="btn-secondary" onClick={handlePrint} disabled={!closing}>🖨️ تصدير PDF</button>
        </div>
      </div>

      {loading || !closing ? (
        <div className="text-gray-500">جاري التحميل...</div>
      ) : (
        <>
          <h2 className="text-sm font-semibold text-gray-500 mb-2">ملخص المبيعات والأرباح</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard label="عدد الفواتير" value={String(closing.invoiceCount)} />
            <StatCard label="إجمالي المبيعات" value={formatCurrency(closing.totalSalesValue)} />
            <StatCard label="عمولة الحسبة" value={formatCurrency(closing.totalCommission)} tone="positive" />
            <StatCard label="المصاريف" value={formatCurrency(closing.totalExpenses)} tone="negative" />
          </div>

          <h2 className="text-sm font-semibold text-gray-500 mb-2">صافي الربح (محاسبي)</h2>
          <div className="mb-6">
            <StatCard
              label="عمولة اليوم − مصاريف اليوم"
              value={formatCurrency(closing.netProfit)}
              tone={closing.netProfit >= 0 ? "positive" : "negative"}
            />
          </div>

          <h2 className="text-sm font-semibold text-gray-500 mb-2">حركة النقد الفعلية (لإغلاق الصندوق)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="دفعات مستلمة من التجار" value={formatCurrency(closing.paymentsReceivedFromMerchants)} tone="positive" />
            <StatCard label="دفعات مدفوعة للباعة والسواق" value={formatCurrency(closing.paymentsPaidToFarmers)} tone="negative" />
            <StatCard
              label="صافي التدفق النقدي اليوم"
              value={formatCurrency(netCashFlow)}
              tone={netCashFlow >= 0 ? "positive" : "negative"}
              hint="دفعات التجار − دفعات الباعة والسواق − المصاريف"
            />
          </div>
        </>
      )}
    </div>
  );
}
