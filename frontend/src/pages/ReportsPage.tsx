import { useEffect, useState } from "react";
import { usePagination } from "../lib/usePagination";
import { TablePagination } from "../components/TablePagination";
import { agingReport, driverReport, exportReport, farmerReport, marketReport, merchantReport, type ReportFilter } from "../api/reports";
import type { AgingReportRow, DriverReportRow, FarmerReportRow, MarketReportRow, MerchantReportRow } from "../types";
import { formatCurrency, formatDate, formatWeight } from "../lib/format";
import { triggerBlobDownload } from "../api/invoices";
import { useAuth } from "../auth/AuthContext";
import { PartnerLink } from "../components/RecordLinks";
import { PdfActions } from "../components/PdfActions";
import { CollapsibleRows } from "../components/CollapsibleRows";

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

  function reportFilter() {
    return tab === "market" ? { ...filter, grouping: filter.grouping ?? "daily" } : filter;
  }

  async function handleExportExcel() {
    triggerBlobDownload(await exportReport(tab, "excel", reportFilter()), `${tab}-report.xlsx`);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">التقارير</h1>

      <div className="flex flex-wrap gap-2 mb-4">
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
            <select className="input" value={filter.grouping ?? "daily"} onChange={(e) => setFilter((f) => ({ ...f, grouping: e.target.value as "daily" | "monthly" | "total" }))}>
              <option value="daily">يومي</option>
              <option value="monthly">شهري</option>
              {/* One row for the whole range — "من أول السنة لهلأ، قديش ربحت". The backend has
                  always collapsed unrecognised groupings this way; it just had no option here. */}
              <option value="total">الفترة كاملة</option>
            </select>
          </div>
        )}
        {hasPermission("reports.export") && (
          <div className="flex gap-2 flex-wrap ms-auto">
            <button className="btn-secondary" onClick={handleExportExcel}>تصدير Excel</button>
            <PdfActions
              fetchPdf={() => exportReport(tab, "pdf", reportFilter())}
              fileName={`${tab}-report.pdf`}
              shareTitle="تقرير"
              printLabel="تصدير PDF"
            />
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
  const pager = usePagination(rows);
  return (
    <div className="card">
      <div className="sm:hidden">
        <CollapsibleRows
          rows={pager.pageRows}
          rowKey={(r) => r.farmerId}
          title={(r) => r.farmerName}
          value={(r) => formatCurrency(r.remaining)}
          details={(r) => [
            { label: "المبيعات", value: formatCurrency(r.totalSalesValue) },
            { label: "العمولة", value: formatCurrency(r.totalCommission) },
            { label: "صافي المستحق", value: formatCurrency(r.netDue) },
            { label: "المدفوع", value: formatCurrency(r.totalPaid) },
          ]}
          empty="لا توجد بيانات"
        />
      </div>
      <div className="hidden sm:block overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th>البائع</th><th>الوزن</th><th>الصناديق</th><th>الكرتون</th><th>المبيعات</th>
            <th>العمولة</th><th>صافي المستحق</th><th>المدفوع</th>
            <th>المتبقي</th><th>آخر فاتورة</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={11} className="text-center text-gray-400 py-6">لا توجد بيانات</td></tr>
          ) : pager.pageRows.map((r) => (
            <tr key={r.farmerId}>
              <td className="font-medium"><PartnerLink partnerId={r.farmerId} name={r.farmerName} side="seller" /></td>
              <td>{formatWeight(r.totalWeightKg)}</td>
              <td>{r.totalBoxes.toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
              <td>{r.totalCartons.toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
              <td>{formatCurrency(r.totalSalesValue)}</td>
              <td>{formatCurrency(r.totalCommission)}</td>
              <td>{formatCurrency(r.netDue)}</td>
              <td>{formatCurrency(r.totalPaid)}</td>
              <td className="font-semibold">{formatCurrency(r.remaining)}</td>
              <td>{r.lastInvoiceDate ? formatDate(r.lastInvoiceDate) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <TablePagination
        page={pager.page} pageSize={pager.pageSize} totalCount={pager.totalCount}
        itemLabel="بائع" onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize}
      />
    </div>
  );
}

function MerchantsTable({ rows }: { rows: MerchantReportRow[] }) {
  const pager = usePagination(rows);
  return (
    <div className="card">
      <div className="sm:hidden">
        <CollapsibleRows
          rows={pager.pageRows}
          rowKey={(r) => r.merchantId}
          title={(r) => r.merchantName}
          value={(r) => formatCurrency(r.remaining)}
          details={(r) => [
            { label: "المشتريات", value: formatCurrency(r.totalPurchases) },
            { label: "سعر الخشب", value: formatCurrency(r.totalWoodTotal) },
            { label: "رسوم الصناديق", value: formatCurrency(r.totalBoxFee) },
            { label: "الإجمالي الكلي", value: formatCurrency(r.grandTotal) },
            { label: "المدفوع", value: formatCurrency(r.totalPaid) },
          ]}
          empty="لا توجد بيانات"
        />
      </div>
      <div className="hidden sm:block overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th>المشتري</th><th>الوزن</th><th>الصناديق</th><th>الكرتون</th><th>المشتريات</th>
            <th>سعر الخشب</th><th>رسوم الصناديق</th><th>الإجمالي الكلي</th><th>المدفوع</th>
            <th>المتبقي</th><th>آخر فاتورة</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={12} className="text-center text-gray-400 py-6">لا توجد بيانات</td></tr>
          ) : pager.pageRows.map((r) => (
            <tr key={r.merchantId}>
              <td className="font-medium"><PartnerLink partnerId={r.merchantId} name={r.merchantName} side="merchant" /></td>
              <td>{formatWeight(r.totalWeightKg)}</td>
              <td>{r.totalBoxes.toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
              <td>{r.totalCartons.toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
              <td>{formatCurrency(r.totalPurchases)}</td>
              <td>{formatCurrency(r.totalWoodTotal)}</td>
              <td>{formatCurrency(r.totalBoxFee)}</td>
              <td>{formatCurrency(r.grandTotal)}</td>
              <td>{formatCurrency(r.totalPaid)}</td>
              <td className="font-semibold">{formatCurrency(r.remaining)}</td>
              <td>{r.lastInvoiceDate ? formatDate(r.lastInvoiceDate) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <TablePagination
        page={pager.page} pageSize={pager.pageSize} totalCount={pager.totalCount}
        itemLabel="مشتري" onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize}
      />
    </div>
  );
}

function DriversTable({ rows }: { rows: DriverReportRow[] }) {
  const pager = usePagination(rows);
  return (
    <div className="card">
      <div className="sm:hidden">
        <CollapsibleRows
          rows={pager.pageRows}
          rowKey={(r) => r.driverId}
          title={(r) => r.driverName}
          value={(r) => formatCurrency(r.totalTransportFee)}
          details={(r) => [
            { label: "الصناديق", value: r.totalBoxes },
            { label: "الكرتون", value: r.totalCartons },
            { label: "المدفوع", value: formatCurrency(r.totalPaid) },
            { label: "المتبقي", value: formatCurrency(r.remaining) },
          ]}
          empty="لا توجد بيانات"
        />
      </div>
      <div className="hidden sm:block overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th>السائق</th><th>الصناديق</th><th>الكرتون</th><th>أجرة النقل</th><th>المدفوع</th>
            <th>المتبقي</th><th>آخر فاتورة</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={8} className="text-center text-gray-400 py-6">لا توجد بيانات</td></tr>
          ) : pager.pageRows.map((r) => (
            <tr key={r.driverId}>
              <td className="font-medium"><PartnerLink partnerId={r.driverId} name={r.driverName} side="seller" /></td>
              <td>{r.totalBoxes.toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
              <td>{r.totalCartons.toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
              <td>{formatCurrency(r.totalTransportFee)}</td>
              <td>{formatCurrency(r.totalPaid)}</td>
              <td className="font-semibold">{formatCurrency(r.remaining)}</td>
              <td>{r.lastInvoiceDate ? formatDate(r.lastInvoiceDate) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <TablePagination
        page={pager.page} pageSize={pager.pageSize} totalCount={pager.totalCount}
        itemLabel="سائق" onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize}
      />
    </div>
  );
}

function AgingTable({ rows }: { rows: AgingReportRow[] }) {
  const pager = usePagination(rows);
  return (
    <div className="card">
      <div className="sm:hidden">
        <CollapsibleRows
          rows={pager.pageRows}
          rowKey={(r) => r.merchantId}
          title={(r) => r.merchantName}
          value={(r) => formatCurrency(r.total)}
          details={(r) => [
            { label: "حالي (أقل من 30 يوم)", value: formatCurrency(r.current) },
            { label: "30-59 يوم", value: formatCurrency(r.days30To59) },
            { label: "60-89 يوم", value: formatCurrency(r.days60To89) },
            { label: "90 يوم فأكثر", value: formatCurrency(r.days90Plus) },
          ]}
          empty="لا توجد بيانات"
        />
      </div>
      <div className="hidden sm:block overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr><th>المشتري</th><th>حالي (أقل من 30 يوم)</th><th>30-59 يوم</th><th>60-89 يوم</th><th>90 يوم فأكثر</th><th>الإجمالي</th></tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={6} className="text-center text-gray-400 py-6">لا توجد أرصدة متأخرة</td></tr>
          ) : pager.pageRows.map((r) => (
            <tr key={r.merchantId}>
              <td className="font-medium"><PartnerLink partnerId={r.merchantId} name={r.merchantName} side="merchant" /></td>
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
      <TablePagination
        page={pager.page} pageSize={pager.pageSize} totalCount={pager.totalCount}
        itemLabel="فاتورة" onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize}
      />
    </div>
  );
}

function MarketTable({ rows }: { rows: MarketReportRow[] }) {
  const pager = usePagination(rows);
  return (
    <div className="card">
      <div className="sm:hidden">
        <CollapsibleRows
          rows={pager.pageRows}
          rowKey={(r) => r.period}
          title={(r) => r.period}
          value={(r) => formatCurrency(r.netProfit)}
          details={(r) => [
            { label: "المبيعات", value: formatCurrency(r.totalSalesValue) },
            { label: "العمولة", value: formatCurrency(r.totalCommission) },
            { label: "رسوم الصناديق", value: formatCurrency(r.boxFeeIncome) },
            { label: "سعر الخشب", value: formatCurrency(r.woodIncome) },
            { label: "المصاريف", value: formatCurrency(r.totalExpenses) },
          ]}
          empty="لا توجد بيانات"
        />
      </div>
      <div className="hidden sm:block overflow-x-auto">
      <table className="table-base">
        {/* Every term of the profit, not just commission and expenses — the crate fees are real
            margin and used to be missing from it (see the backend MarketEarnings). */}
        <thead><tr><th>الفترة</th><th>المبيعات</th><th>العمولة</th><th>الصناديق</th><th>الكرتون</th><th>رسوم الصناديق</th><th>سعر الخشب</th><th>أجرة صناديق السائق</th><th>نقل بدون سائق</th><th>عمولة مرتجعة</th><th>المصاريف</th><th>الربح الصافي</th></tr></thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={12} className="text-center text-gray-400 py-6">لا توجد بيانات</td></tr>
          ) : pager.pageRows.map((r) => (
            <tr key={r.period}>
              <td className="font-medium">{r.period}</td>
              <td>{formatCurrency(r.totalSalesValue)}</td>
              <td>{formatCurrency(r.totalCommission)}</td>
              <td>{r.totalBoxes.toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
              <td>{r.totalCartons.toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>
              <td>{formatCurrency(r.boxFeeIncome)}</td>
              <td>{formatCurrency(r.woodIncome)}</td>
              <td>{formatCurrency(r.driverBoxFeeCost)}</td>
              <td>{r.keptPassThrough !== 0 ? formatCurrency(r.keptPassThrough) : "—"}</td>
              <td>{formatCurrency(r.returnsCommissionCredit)}</td>
              <td>{formatCurrency(r.totalExpenses)}</td>
              <td className={`font-semibold ${r.netProfit >= 0 ? "text-brand-700" : "text-red-600"}`}>{formatCurrency(r.netProfit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <TablePagination
        page={pager.page} pageSize={pager.pageSize} totalCount={pager.totalCount}
        itemLabel="يوم" onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize}
      />
    </div>
  );
}
