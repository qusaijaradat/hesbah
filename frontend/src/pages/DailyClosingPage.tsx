import { useEffect, useState } from "react";
import { StatCard } from "../components/StatCard";
import { GoodsGlobalStockCard } from "../components/GoodsGlobalStockCard";
import { dailyClosingReport, exportDailyClosingPdf, getGoodsGlobalStockForReports } from "../api/reports";

import { apiErrorMessage } from "../api/client";
import { formatCurrency, todayLocalDateString } from "../lib/format";
import type { DailyClosingDto, GoodsStockRow } from "../types";
import { PdfActions } from "../components/PdfActions";

export function DailyClosingPage() {
  const [date, setDate] = useState(() => todayLocalDateString());
  const [closing, setClosing] = useState<DailyClosingDto | null>(null);
  const [loading, setLoading] = useState(true);

  // "البضاعة المتوفرة حاليًا — كل الباعة": a live, all-farmers summary — loads once on mount,
  // deliberately NOT re-fetched when the date above changes (see GoodsGlobalStockCard's doc comment).
  const [globalStock, setGlobalStock] = useState<GoodsStockRow[]>([]);
  const [globalStockLoading, setGlobalStockLoading] = useState(true);
  const [globalStockError, setGlobalStockError] = useState<string | null>(null);

  useEffect(() => {
    getGoodsGlobalStockForReports()
      .then((rows) => setGlobalStock(rows))
      .catch((err) => setGlobalStockError(apiErrorMessage(err, "فشل تحميل البضاعة المتوفرة")))
      .finally(() => setGlobalStockLoading(false));
  }, []);

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


  const netCashFlow = closing
    ? closing.paymentsReceivedFromMerchants - closing.paymentsPaidToFarmers - closing.totalExpenses
    : 0;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold">الإغلاق اليومي</h1>
        <div className="flex items-center gap-2">
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          <PdfActions
            fetchPdf={() => exportDailyClosingPdf(new Date(date).toISOString())}
            fileName={`daily-closing-${date}.pdf`}
            shareTitle="الإغلاق اليومي"
            printLabel="🖨️ تصدير PDF"
            disabled={!closing}
          />
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

          {/* The parts, then the total — the day's profit used to be commission minus expenses
              and left the crate margin out entirely (see the backend MarketEarnings). */}
          <h2 className="text-sm font-semibold text-gray-500 mb-2">صافي الربح (محاسبي)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-3">
            {/* The counts first, then the fee they produce — a day's رسوم الصناديق that cannot be
                read back to a number of crates is a figure nobody can check. */}
            <StatCard label="عدد الصناديق" value={closing.totalBoxes.toLocaleString("en-US", { maximumFractionDigits: 3 })} />
            <StatCard label="عدد الكرتون" value={closing.totalCartons.toLocaleString("en-US", { maximumFractionDigits: 3 })} />
            <StatCard label="رسوم الصناديق (من المشترين)" value={formatCurrency(closing.boxFeeIncome)} tone="positive" />
            <StatCard label="سعر الخشب (من المشترين)" value={formatCurrency(closing.woodIncome)} tone="positive" />
            <StatCard label="عمولة مرتجعة" value={formatCurrency(closing.returnsCommissionCredit)} tone="negative" />
            {/* Only worth a card when it is not zero: a non-zero value here is almost always a
                driver missing from an invoice, not a real earning. */}
            {closing.keptPassThrough !== 0 && (
              <StatCard
                label="أجرة نقل بدون سائق"
                value={formatCurrency(closing.keptPassThrough)}
                hint="فواتير ما إلها سائق — تأكد إذا كان السائق ناسي"
              />
            )}
          </div>
          {/* أجرة صناديق السائق is still subtracted from this total; it just no longer has a card
              of its own, so the hint below is the only place left that accounts for it. */}
          <div className="mb-6">
            <StatCard
              label="صافي ربح اليوم"
              value={formatCurrency(closing.netProfit)}
              tone={closing.netProfit >= 0 ? "positive" : "negative"}
              hint="العمولة + رسوم الصناديق + سعر الخشب − أجرة صناديق السائق − العمولة المرتجعة − المصاريف"
            />
          </div>

          <h2 className="text-sm font-semibold text-gray-500 mb-2">حركة النقد الفعلية (لإغلاق الصندوق)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="دفعات مستلمة من المشترين" value={formatCurrency(closing.paymentsReceivedFromMerchants)} tone="positive" />
            <StatCard label="دفعات مدفوعة للباعة السائقين" value={formatCurrency(closing.paymentsPaidToFarmers)} tone="negative" />
            <StatCard
              label="صافي التدفق النقدي اليوم"
              value={formatCurrency(netCashFlow)}
              tone={netCashFlow >= 0 ? "positive" : "negative"}
              hint="دفعات المشترين − دفعات الباعة السائقين − المصاريف"
            />
          </div>
        </>
      )}

      <GoodsGlobalStockCard rows={globalStock} loading={globalStockLoading} error={globalStockError} />
    </div>
  );
}
