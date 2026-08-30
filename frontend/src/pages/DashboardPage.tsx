import { useEffect, useState } from "react";
import { StatCard } from "../components/StatCard";
import { listInvoices } from "../api/invoices";
import { marketReport, merchantReport } from "../api/reports";
import { formatCurrency } from "../lib/format";
import { useAuth } from "../auth/AuthContext";

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
  const [merchantsRemaining, setMerchantsRemaining] = useState(0);

  useEffect(() => {
    if (!hasPermission("invoices.view")) {
      setLoading(false);
      return;
    }
    (async () => {
      const dateFrom = startOfToday();
      // Note: no "مستحقات الباعة والسواق" (farmers'/drivers' remaining) card here on
      // purpose — most invoices in this market never have a seller/driver attached
      // (goods just show up and get priced/sold), so that total was near-meaningless
      // and confusing on the dashboard. Removed per explicit request.
      const [invoicesToday, market, merchants] = await Promise.all([
        listInvoices({ dateFrom, pageSize: 1 }),
        marketReport({ dateFrom, grouping: "daily" }),
        merchantReport({}),
      ]);
      setTodayCount(invoicesToday.totalCount);
      setTodayCommission(market.reduce((sum, r) => sum + r.totalCommission, 0));
      setTodayValue(market.reduce((sum, r) => sum + r.totalSalesValue, 0));
      setMerchantsRemaining(merchants.reduce((sum, r) => sum + r.remaining, 0));
      setLoading(false);
    })();
  }, [hasPermission]);

  if (loading) return <div className="text-gray-500">جاري التحميل...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">لوحة التحكم</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="فواتير اليوم" value={String(todayCount)} />
        <StatCard label="مبيعات اليوم" value={formatCurrency(todayValue)} />
        <StatCard label="عمولة الحسبة اليوم" value={formatCurrency(todayCommission)} tone="positive" />
        <StatCard label="مستحقات التجار (إجمالي)" value={formatCurrency(merchantsRemaining)} hint="ما يدين به التجار للحسبة" />
      </div>
    </div>
  );
}
