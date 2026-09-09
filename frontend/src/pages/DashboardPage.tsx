import { Fragment, useEffect, useMemo, useState } from "react";
import { StatCard } from "../components/StatCard";
import { Link } from "react-router-dom";
import { getDashboardSummary, merchantItemsBreakdown, printBuyerStatementPdf } from "../api/reports";
import { formatCurrency, formatQuantity } from "../lib/format";
import { useAuth } from "../auth/AuthContext";
import type { DashboardSummaryDto, MerchantItemBreakdownRow, PartnerDebtRow } from "../types";
import { PartnerLink } from "../components/RecordLinks";
import { PdfActions } from "../components/PdfActions";

export function DashboardPage() {
  const { hasPermission } = useAuth();
  const [loading, setLoading] = useState(true);
  // The whole screen in one payload — see backend DashboardSummaryDto. Assembled server-side
  // rather than by calling five endpoints, so these numbers agree with the pages they link to.
  const [summary, setSummary] = useState<DashboardSummaryDto | null>(null);

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

  // Nothing loads/shows until the user actually picks at least one side of the period —
  // no more defaulting to "show everything" the moment this section is visible.
  const buyerPeriodChosen = Boolean(buyerDateFrom || buyerDateTo);

  useEffect(() => {
    // The summary is a report endpoint; a role without reports.view simply gets the page
    // without it rather than an error banner.
    if (!hasPermission("reports.view")) {
      setLoading(false);
      return;
    }
    getDashboardSummary()
      .then(setSummary)
      // A dashboard that fails must not block the rest of the app — the cards simply don't render.
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
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

  // اسم المشتري + المبلغ only (no عدد الفواتير) — see ExportService.GenerateBuyerStatementPdf.
  function buildBuyerStatementPdf() {
    return printBuyerStatementPdf({
      dateFrom: buyerDateFrom ? new Date(buyerDateFrom).toISOString() : undefined,
      dateTo: buyerDateTo ? new Date(buyerDateTo).toISOString() : undefined,
    });
  }

  if (loading) return <div className="text-gray-500">جاري التحميل...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">لوحة التحكم</h1>
      {summary && (
        <>
          <h2 className="font-semibold text-gray-700 mb-2">اليوم</h2>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
            <StatCard label="فواتير اليوم" value={String(summary.todayInvoiceCount)} />
            <StatCard label="مبيعات اليوم" value={formatCurrency(summary.todaySalesValue)} />
            <StatCard label="عمولة الحسبة اليوم" value={formatCurrency(summary.todayCommission)} tone="positive" />
            {/* Cash actually in and out today — an uncleared check is neither (see PaymentRules),
                which is what makes these safe to read as a drawer count. */}
            <StatCard label="مقبوض اليوم" value={formatCurrency(summary.todayCashIn)} tone="positive" hint="نقد فعلي — الشيك ما بينحسب إلا لما ينصرف" />
            <StatCard label="مدفوع اليوم" value={formatCurrency(summary.todayCashOut)} tone="negative" hint="للباعة والسواق" />
          </div>

          <h2 className="font-semibold text-gray-700 mb-2">الوضع الحالي</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {/* All-time, not today — a debt from last month is still a debt this morning. */}
            <Link to="/debts" className="block">
              <StatCard label="ديون على المشترين" value={formatCurrency(summary.merchantsOwe)} tone="negative" hint="اضغط لتفاصيل قيمة الديون" />
            </Link>
            <Link to="/debts" className="block">
              <StatCard label="مستحقات للباعة والسواق" value={formatCurrency(summary.owedToSellers)} hint="اضغط لتفاصيل قيمة الديون" />
            </Link>
            {/* Deep-links into the invoices list with the matching filter already applied, so the
                number and the list behind it can never tell different stories. */}
            <Link to="/invoices?paymentStatus=Unpaid" className="block">
              <StatCard label="فواتير غير مسدّدة" value={String(summary.unpaidInvoiceCount)} tone="negative" hint={`باقي: ${formatCurrency(summary.unpaidInvoiceAmount)}`} />
            </Link>
            <Link to="/invoices?hasUnpricedItems=true" className="block">
              <StatCard label="فواتير غير مسعّرة" value={String(summary.unpricedInvoiceCount)} hint="فيها أصناف بدون سعر" />
            </Link>
          </div>

          <h2 className="font-semibold text-gray-700 mb-2">الشيكات قيد التحصيل</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <Link to="/checks" className="block">
              <StatCard label="فات موعدها" value={String(summary.checksOverdueCount)} tone="negative" hint={formatCurrency(summary.checksOverdueAmount)} />
            </Link>
            <Link to="/checks" className="block">
              <StatCard label="مستحقة اليوم" value={String(summary.checksDueTodayCount)} hint={formatCurrency(summary.checksDueTodayAmount)} />
            </Link>
            <Link to="/checks" className="block">
              <StatCard label="خلال 7 أيام" value={String(summary.checksDueSoonCount)} hint={formatCurrency(summary.checksDueSoonAmount)} />
            </Link>
          </div>

          {(summary.topMerchantDebts.length > 0 || summary.topSellerDues.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
              <TopDebtList title="أكبر الديون على المشترين" rows={summary.topMerchantDebts} accountPath="merchant-account" />
              <TopDebtList title="أكبر المستحقات للباعة والسواق" rows={summary.topSellerDues} accountPath="farmer-account" />
            </div>
          )}
        </>
      )}

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
              <PdfActions
                fetchPdf={buildBuyerStatementPdf}
                fileName={`buyer-statement-${buyerDateFrom}-${buyerDateTo}.pdf`}
                shareTitle="كشف المشتريين"
                printMode="tab"
              />
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                {/* العدد/الوزن فيلدين منفصلين (مش "الكمية" واحدة مدموجة) — نفس الأسلوب المتّبع
                    بكل جدول أصناف تاني بالتطبيق: الصف دايمًا إما عدد (صندوق) أو وزن (كغم)، مش الاثنين
                    معًا، فبيطلع "—" بالعمود الي ما ينطبق. نفس التقسيم موجود بالنسخة المطبوعة (PDF). */}
                <tr><th>المشتري</th><th>الصنف</th><th>العدد</th><th>الوزن</th><th>السعر</th></tr>
              </thead>
              <tbody>
                {!buyerPeriodChosen ? (
                  <tr><td colSpan={5} className="text-center text-gray-400 py-6">اختر تاريخًا (من و/أو إلى) لعرض كشف المشترين</td></tr>
                ) : buyerLoading ? (
                  <tr><td colSpan={5} className="text-center text-gray-400 py-6">جاري التحميل...</td></tr>
                ) : buyerMerchantGroups.length === 0 ? (
                  <tr><td colSpan={5} className="text-center text-gray-400 py-6">لا توجد بيانات لهذه الفترة</td></tr>
                ) : (
                  buyerMerchantGroups.map((group) => (
                    <Fragment key={group.merchantId}>
                      {group.items.map((item, idx) => (
                        <tr key={idx}>
                          <td className="font-medium"><PartnerLink partnerId={group.merchantId} name={group.merchantName} side="merchant" /></td>
                          <td>{item.itemName}</td>
                          <td>{item.unit === "Box" ? formatQuantity(item.totalQuantity, "Box") : "—"}</td>
                          <td>{item.unit === "Kg" ? formatQuantity(item.totalQuantity, "Kg") : "—"}</td>
                          <td>{formatCurrency(item.totalValue)}</td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50">
                        <td colSpan={4} className="font-semibold text-gray-600">إجمالي {group.merchantName}</td>
                        <td className="font-semibold">{formatCurrency(group.subtotal)}</td>
                      </tr>
                    </Fragment>
                  ))
                )}
              </tbody>
              {buyerPeriodChosen && !buyerLoading && buyerMerchantGroups.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={4} className="font-semibold">الإجمالي الكلي</td>
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

/** "مين ندين له / مين بدنا منه" — the few biggest balances, each linking straight into that
 * person's own كشف حساب. Capped server-side: a dashboard is a starting point, not the
 * قيمة الديون page it links to. */
function TopDebtList({ title, rows, accountPath }: {
  title: string;
  rows: PartnerDebtRow[];
  accountPath: "merchant-account" | "farmer-account";
}) {
  if (rows.length === 0) return null;
  return (
    <div className="card p-4">
      <h2 className="font-semibold mb-3">{title}</h2>
      <table className="table-base">
        <tbody>
          {rows.map((row) => (
            <tr key={row.partnerId}>
              <td>
                <Link to={`/partners/${row.partnerId}/${accountPath}`} className="text-brand-700 hover:underline">
                  {row.name}
                </Link>
              </td>
              <td className="font-semibold text-end">{formatCurrency(row.remaining)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
