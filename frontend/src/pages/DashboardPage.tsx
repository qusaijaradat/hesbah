import { Fragment, useEffect, useMemo, useState } from "react";
import { StatCard } from "../components/StatCard";
import { listInvoices } from "../api/invoices";
import { marketReport, merchantItemsBreakdown, printBuyerStatementPdf } from "../api/reports";
import { formatCurrency, formatQuantity } from "../lib/format";
import { useAuth } from "../auth/AuthContext";
import type { MerchantItemBreakdownRow } from "../types";

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
  // Deliberately period-scoped ONLY (no المدفوع/المتبقي columns): those two figures would always be
  // all-time regardless of the date filter (see ReportService.MerchantReportAsync), so showing them
  // next to a period total here would misleadingly look scoped to the chosen period when they're
  // not — same reasoning as the note below about the removed all-time balance cards.
  // Per-(merchant, item) rows rather than one row per merchant — shows exactly what each merchant
  // bought (item/quantity/price), not just their total. See ReportService.MerchantItemBreakdownAsync.
  const [buyerDateFrom, setBuyerDateFrom] = useState("");
  const [buyerDateTo, setBuyerDateTo] = useState("");
  const [buyerItemRows, setBuyerItemRows] = useState<MerchantItemBreakdownRow[]>([]);
  const [buyerLoading, setBuyerLoading] = useState(false);
  const [buyerPrinting, setBuyerPrinting] = useState(false);
  // Nothing loads/shows until the user actually picks at least one side of the period —
  // no more defaulting to "show everything" the moment this section is visible.
  const buyerPeriodChosen = Boolean(buyerDateFrom || buyerDateTo);

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
    if (!hasPermission("reports.view") || !buyerPeriodChosen) {
      setBuyerItemRows([]);
      return;
    }
    setBuyerLoading(true);
    merchantItemsBreakdown({
      dateFrom: buyerDateFrom ? new Date(buyerDateFrom).toISOString() : undefined,
      dateTo: buyerDateTo ? new Date(buyerDateTo).toISOString() : undefined,
    }).then((rows) => {
      setBuyerItemRows(rows);
      setBuyerLoading(false);
    });
  }, [hasPermission, buyerPeriodChosen, buyerDateFrom, buyerDateTo]);

  // One group per merchant, each carrying its own item rows plus a subtotal — quantity is
  // deliberately NOT summed at this level (a merchant's items can mix Kg and Box units, which
  // can't be added into one meaningful number), only the price/value column is.
  const buyerMerchantGroups = useMemo(() => {
    const byMerchant = new Map<number, { merchantId: number; merchantName: string; items: MerchantItemBreakdownRow[]; subtotal: number }>();
    for (const row of buyerItemRows) {
      let group = byMerchant.get(row.merchantId);
      if (!group) {
        group = { merchantId: row.merchantId, merchantName: row.merchantName, items: [], subtotal: 0 };
        byMerchant.set(row.merchantId, group);
      }
      group.items.push(row);
      group.subtotal += row.totalValue;
    }
    return Array.from(byMerchant.values());
  }, [buyerItemRows]);

  const buyerValueTotal = buyerItemRows.reduce((sum, r) => sum + r.totalValue, 0);

  // Prints اسم المشتري + المبلغ only (no عدد الفواتير) — see ExportService.GenerateBuyerStatementPdf.
  async function handlePrintBuyerStatement() {
    setBuyerPrinting(true);
    try {
      const blob = await printBuyerStatementPdf({
        dateFrom: buyerDateFrom ? new Date(buyerDateFrom).toISOString() : undefined,
        dateTo: buyerDateTo ? new Date(buyerDateTo).toISOString() : undefined,
      });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    } finally {
      setBuyerPrinting(false);
    }
  }

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
            {buyerPeriodChosen && (
              <button className="btn-secondary" onClick={() => { setBuyerDateFrom(""); setBuyerDateTo(""); }}>
                إلغاء التصفية
              </button>
            )}
            {buyerPeriodChosen && buyerMerchantGroups.length > 0 && (
              <button className="btn-secondary" disabled={buyerPrinting} onClick={handlePrintBuyerStatement}>
                {buyerPrinting ? "جاري التجهيز..." : "🖨️ طباعة"}
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>المشتري</th><th>الصنف</th><th>الكمية</th><th>السعر</th></tr>
              </thead>
              <tbody>
                {!buyerPeriodChosen ? (
                  <tr><td colSpan={4} className="text-center text-gray-400 py-6">اختر تاريخًا (من و/أو إلى) لعرض كشف المشترين</td></tr>
                ) : buyerLoading ? (
                  <tr><td colSpan={4} className="text-center text-gray-400 py-6">جاري التحميل...</td></tr>
                ) : buyerMerchantGroups.length === 0 ? (
                  <tr><td colSpan={4} className="text-center text-gray-400 py-6">لا توجد بيانات لهذه الفترة</td></tr>
                ) : (
                  buyerMerchantGroups.map((group) => (
                    <Fragment key={group.merchantId}>
                      {group.items.map((item, idx) => (
                        <tr key={idx}>
                          <td className="font-medium">{group.merchantName}</td>
                          <td>{item.itemName}</td>
                          <td>{formatQuantity(item.totalQuantity, item.unit)}</td>
                          <td>{formatCurrency(item.totalValue)}</td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50">
                        <td colSpan={3} className="font-semibold text-gray-600">إجمالي {group.merchantName}</td>
                        <td className="font-semibold">{formatCurrency(group.subtotal)}</td>
                      </tr>
                    </Fragment>
                  ))
                )}
              </tbody>
              {buyerPeriodChosen && !buyerLoading && buyerMerchantGroups.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={3} className="font-semibold">الإجمالي الكلي</td>
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
