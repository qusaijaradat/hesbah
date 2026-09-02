import { useEffect, useState } from "react";
import { agingReport, driverReport, exportReport, farmerReport, marketReport, merchantReport, type ReportFilter } from "../api/reports";
import type { AgingReportRow, DriverReportRow, FarmerReportRow, MarketReportRow, MerchantReportRow } from "../types";
import { formatCurrency, formatDate, formatWeight } from "../lib/format";
import { triggerBlobDownload } from "../api/invoices";
import { useAuth } from "../auth/AuthContext";

type Tab = "farmers" | "merchants" | "drivers" | "market" | "aging";

export function ReportsPage() {
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState<Tab>("farmers");
  const [filter, setFilter] = useState<ReportFilter>({});
  const [farmers, setFarmers] = useState<FarmerReportRow[]>([]);
  const [merchants, setMerchants] = useState<MerchantReportRow[]>([]);
  const [drivers, setDrivers] = useState<DriverReportRow[]>([]);
  const [market, setMarket] = useState<MarketReportRow[]>([]);
  const [aging, setAging] = useState<AgingReportRow[]>([]);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    if (tab === "farmers") setFarmers(await farmerReport(filter));
    if (tab === "merchants") setMerchants(await merchantReport(filter));
    if (tab === "drivers") setDrivers(await driverReport(filter));
    if (tab === "market") setMarket(await marketReport({ ...filter, grouping: filter.grouping ?? "daily" }));
    if (tab === "aging") setAging(await agingReport(filter));
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, filter]);

  async function handleExport(format: "excel" | "pdf") {
    const blob = await exportReport(tab, format, tab === "market" ? { ...filter, grouping: filter.grouping ?? "daily" } : filter);
    triggerBlobDownload(blob, `${tab}-report.${format === "excel" ? "xlsx" : "pdf"}`);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">التقارير</h1>

      <div className="flex gap-2 mb-4">
        <button className={tab === "farmers" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("farmers")}>تقرير البائعين</button>
        <button className={tab === "merchants" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("merchants")}>تقرير المشترين</button>
        <button className={tab === "drivers" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("drivers")}>تقرير السائقين</button>
        <button className={tab === "market" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("market")}>تقرير الحسبة</button>
        <button className={tab === "aging" ? "btn-primary" : "btn-secondary"} onClick={() => setTab("aging")}>أعمار الديون</button>
      </div>

      <div className="card p-4 mb-4 flex flex-wrap items-end gap-3">
        {tab === "aging" ? (
          <div className="text-sm text-gray-500">تعرض هذه الشاشة الأرصدة المتأخرة الحالية للمشترين فقط (لحظة العرض، وليست محصورة بفترة).</div>
        ) : (
          <>
            <div>
              <label className="label">من تاريخ</label>
              <input type="date" className="input" onChange={(e) => setFilter((f) => ({ ...f, dateFrom: e.target.value ? new Date(e.target.value).toISOString() : undefined }))} />
            </div>
            <div>
              <label className="label">إلى تاريخ</label>
              <input type="date" className="input" onChange={(e) => setFilter((f) => ({ ...f, dateTo: e.target.value ? new Date(e.target.value).toISOString() : undefined }))} />
            </div>
          </>
        )}
        {tab === "market" && (
          <div>
            <label className="label">التجميع</label>
            <select className="input" value={filter.grouping ?? "daily"} onChange={(e) => setFilter((f) => ({ ...f, grouping: e.target.value as "daily" | "monthly" }))}>
              <option value="daily">يومي</option>
              <option value="monthly">شهري</option>
            </select>
          </div>
        )}
        {hasPermission("reports.export") && (
          <div className="flex gap-2 ms-auto">
            <button className="btn-secondary" onClick={() => handleExport("excel")}>تصدير Excel</button>
            <button className="btn-secondary" onClick={() => handleExport("pdf")}>تصدير PDF</button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-gray-500">جاري التحميل...</div>
      ) : tab === "farmers" ? (
        <FarmersTable rows={farmers} />
      ) : tab === "merchants" ? (
        <MerchantsTable rows={merchants} />
      ) : tab === "drivers" ? (
        <DriversTable rows={drivers} />
      ) : tab === "market" ? (
        <MarketTable rows={market} />
      ) : (
        <AgingTable rows={aging} />
      )}
    </div>
  );
}

function FarmersTable({ rows }: { rows: FarmerReportRow[] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th>البائع</th><th>عدد الفواتير</th><th>الوزن</th><th>الصناديق</th><th>المبيعات</th>
            <th>العمولة</th><th>صافي المستحق</th><th>المدفوع</th><th>الرصيد الافتتاحي</th>
            <th>المتبقي</th><th>آخر فاتورة</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={11} className="text-center text-gray-400 py-6">لا توجد بيانات</td></tr>
          ) : rows.map((r) => (
            <tr key={r.farmerId}>
              <td className="font-medium">{r.farmerName}</td>
              <td>{r.invoiceCount}</td>
              <td>{formatWeight(r.totalWeightKg)}</td>
              <td>{r.totalBoxes.toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
              <td>{formatCurrency(r.totalSalesValue)}</td>
              <td>{formatCurrency(r.totalCommission)}</td>
              <td>{formatCurrency(r.netDue)}</td>
              <td>{formatCurrency(r.totalPaid)}</td>
              <td>{formatCurrency(r.openingBalance)}</td>
              <td className="font-semibold">{formatCurrency(r.remaining)}</td>
              <td>{r.lastInvoiceDate ? formatDate(r.lastInvoiceDate) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MerchantsTable({ rows }: { rows: MerchantReportRow[] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th>المشتري</th><th>عدد الفواتير</th><th>الوزن</th><th>الصناديق</th><th>المشتريات</th>
            <th>سعر الخشب</th><th>أجرة النقل</th><th>الإجمالي الكلي</th><th>المدفوع</th>
            <th>الرصيد الافتتاحي</th><th>المتبقي</th><th>آخر فاتورة</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={12} className="text-center text-gray-400 py-6">لا توجد بيانات</td></tr>
          ) : rows.map((r) => (
            <tr key={r.merchantId}>
              <td className="font-medium">{r.merchantName}</td>
              <td>{r.invoiceCount}</td>
              <td>{formatWeight(r.totalWeightKg)}</td>
              <td>{r.totalBoxes.toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
              <td>{formatCurrency(r.totalPurchases)}</td>
              <td>{formatCurrency(r.totalWoodTotal)}</td>
              <td>{formatCurrency(r.totalTransportFee)}</td>
              <td>{formatCurrency(r.grandTotal)}</td>
              <td>{formatCurrency(r.totalPaid)}</td>
              <td>{formatCurrency(r.openingBalance)}</td>
              <td className="font-semibold">{formatCurrency(r.remaining)}</td>
              <td>{r.lastInvoiceDate ? formatDate(r.lastInvoiceDate) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DriversTable({ rows }: { rows: DriverReportRow[] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th>السائق</th><th>عدد الفواتير</th><th>أجرة النقل</th><th>المدفوع</th>
            <th>الرصيد الافتتاحي</th><th>المتبقي</th><th>آخر فاتورة</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={7} className="text-center text-gray-400 py-6">لا توجد بيانات</td></tr>
          ) : rows.map((r) => (
            <tr key={r.driverId}>
              <td className="font-medium">{r.driverName}</td>
              <td>{r.invoiceCount}</td>
              <td>{formatCurrency(r.totalTransportFee)}</td>
              <td>{formatCurrency(r.totalPaid)}</td>
              <td>{formatCurrency(r.openingBalance)}</td>
              <td className="font-semibold">{formatCurrency(r.remaining)}</td>
              <td>{r.lastInvoiceDate ? formatDate(r.lastInvoiceDate) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AgingTable({ rows }: { rows: AgingReportRow[] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr><th>المشتري</th><th>حالي (أقل من 30 يوم)</th><th>30-59 يوم</th><th>60-89 يوم</th><th>90 يوم فأكثر</th><th>الإجمالي</th></tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={6} className="text-center text-gray-400 py-6">لا توجد أرصدة متأخرة</td></tr>
          ) : rows.map((r) => (
            <tr key={r.merchantId}>
              <td className="font-medium">{r.merchantName}</td>
              <td>{formatCurrency(r.current)}</td>
              <td>{formatCurrency(r.days30To59)}</td>
              <td className={r.days60To89 > 0 ? "text-amber-600" : ""}>{formatCurrency(r.days60To89)}</td>
              <td className={r.days90Plus > 0 ? "text-red-600 font-medium" : ""}>{formatCurrency(r.days90Plus)}</td>
              <td className="font-semibold">{formatCurrency(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarketTable({ rows }: { rows: MarketReportRow[] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table-base">
        <thead><tr><th>الفترة</th><th>المبيعات</th><th>العمولة</th><th>المصاريف</th><th>الربح الصافي</th></tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={5} className="text-center text-gray-400 py-6">لا توجد بيانات</td></tr>
          ) : rows.map((r) => (
            <tr key={r.period}>
              <td className="font-medium">{r.period}</td>
              <td>{formatCurrency(r.totalSalesValue)}</td>
              <td>{formatCurrency(r.totalCommission)}</td>
              <td>{formatCurrency(r.totalExpenses)}</td>
              <td className={`font-semibold ${r.netProfit >= 0 ? "text-brand-700" : "text-red-600"}`}>{formatCurrency(r.netProfit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
