import { useEffect, useState } from "react";
import { StatCard } from "../components/StatCard";
import { listInvoices } from "../api/invoices";
import { marketReport, merchantReport } from "../api/reports";
import { formatCurrency } from "../lib/format";
import { useAuth } from "../auth/AuthContext";
import type { MerchantReportRow } from "../types";

function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function DashboardPage() {
  const { hasPermission } = useAuth();
  const [loading, setLoading] = useState(true);
  const [todayCount, setTodayCount] = useState(0);
  const [todayValue, setTodayValue] = useState(0);
  const [todayCommission, setTodayCommission] = useState(0);

  // Buyer statement for an arbitrary chosen period — separate from the "today" stats above.
  // Deliberately period-scoped ONLY (no المدفوع/المتبقي columns): those two figures in
  // MerchantReportRow are always all-time regardless of the date filter (see ReportService.
  // MerchantReportAsync), so showing them next to a period total here would misleadingly look
  // scoped to the chosen period when they're not — same reasoning as the note below about the
  // removed all-time balance cards.
  const [buyerDateFrom, setBuyerDateFrom] = useState("");
  const [buyerDateTo, setBuyerDateTo] = useState("");
  const [buyerRows, setBuyerRows] = useState<MerchantReportRow[]>([]);
  const [buyerLoading, setBuyerLoading] = useState(false);

  useEffect(() => {
    if (!hasPermission("invoices.view")) {
      setLoading(false);
      return;
    }
    (async () => {
      const dateFrom = startOfToday();
      // Note: no "مستحقات الباعة والسواق" or "مستحقات المشترين" cards here on purpose —
      // both were removed per explicit request. The farmers/drivers one was near-always
      // zero/irrelevant since most invoices never have one attached; the merchants one
      // was an all-time (not daily) outstanding-balance total that read as confusing on
      // a dashboard otherwise full of "today" figures. Per-merchant balances are still
      // available on each merchant's own "كشف حساب" (account) page.
      const [invoicesToday, market] = await Promise.all([
        listInvoices({ dateFrom, pageSize: 1 }),
        marketReport({ dateFrom, grouping: "daily" }),
      ]);
      setTodayCount(invoicesToday.totalCount);
      setTodayCommission(market.reduce((sum, r) => sum + r.totalCommission, 0));
      setTodayValue(market.reduce((sum, r) => sum + r.totalSalesValue, 0));
      setLoading(false);
    })();
  }, [hasPermission]);

  useEffect(() => {
    if (!hasPermission("reports.view")) return;
    setBuyerLoading(true);
    merchantReport({
      dateFrom: buyerDateFrom ? new Date(buyerDateFrom).toISOString() : undefined,
      dateTo: buyerDateTo ? new Date(buyerDateTo).toISOString() : undefined,
    }).then((rows) => {
      setBuyerRows(rows);
      setBuyerLoading(false);
    });
  }, [hasPermission, buyerDateFrom, buyerDateTo]);

  const buyerInvoiceTotal = buyerRows.reduce((sum, r) => sum + r.invoiceCount, 0);
  const buyerValueTotal = buyerRows.reduce((sum, r) => sum + r.totalPurchases, 0);

  if (loading) return <div className="text-gray-500">جاري التحميل...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">لوحة التحكم</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <StatCard label="فواتير اليوم" value={String(todayCount)} />
        <StatCard label="مبيعات اليوم" value={formatCurrency(todayValue)} />
        <StatCard label="عمولة الحسبة اليوم" value={formatCurrency(todayCommission)} tone="positive" />
      </div>

      {hasPermission("reports.view") && (
        <div className="card p-4">
          <h2 className="font-semibold mb-3">كشف المشترين حسب الفترة</h2>
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <label className="label">من تاريخ</label>
              <input type="date" className="input" value={buyerDateFrom} onChange={(e) => setBuyerDateFrom(e.target.value)} />
            </div>
            <div>
              <label className="label">إلى تاريخ</label>
              <input type="date" className="input" value={buyerDateTo} onChange={(e) => setBuyerDateTo(e.target.value)} />
            </div>
            {(buyerDateFrom || buyerDateTo) && (
              <button className="btn-secondary" onClick={() => { setBuyerDateFrom(""); setBuyerDateTo(""); }}>
                إلغاء التصفية (عرض الكل)
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>المشتري</th><th>عدد الفواتير</th><th>القيمة</th></tr>
              </thead>
              <tbody>
                {buyerLoading ? (
                  <tr><td colSpan={3} className="text-center text-gray-400 py-6">جاري التحميل...</td></tr>
                ) : buyerRows.length === 0 ? (
                  <tr><td colSpan={3} className="text-center text-gray-400 py-6">لا توجد بيانات لهذه الفترة</td></tr>
                ) : (
                  buyerRows.map((r) => (
                    <tr key={r.merchantId}>
                      <td className="font-medium">{r.merchantName}</td>
                      <td>{r.invoiceCount}</td>
                      <td className="font-semibold">{formatCurrency(r.totalPurchases)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {!buyerLoading && buyerRows.length > 0 && (
                <tfoot>
                  <tr>
                    <td className="font-semibold">الإجمالي</td>
                    <td className="font-semibold">{buyerInvoiceTotal}</td>
                    <td className="font-bold">{formatCurrency(buyerValueTotal)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
