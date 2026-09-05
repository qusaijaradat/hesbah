import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getFarmerAccount, getMerchantAccount, printFarmerAccountPdf, printMerchantAccountPdf } from "../api/partners";
import { triggerBlobDownload } from "../api/invoices";
import { apiErrorMessage } from "../api/client";
import type { FarmerAccountDto, MerchantAccountDto, StatementLineDto } from "../types";
import { formatCurrency, formatDate } from "../lib/format";
import { StatCard } from "../components/StatCard";
import { CREDIT_LIMIT_UI_ENABLED } from "../lib/featureFlags";

/** Shared "🖨️ طباعة" button for both account pages below — each just passes its own fetcher/filename. */
function PrintAccountButton({ fetchPdf, fileNamePrefix }: { fetchPdf: () => Promise<Blob>; fileNamePrefix: string }) {
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePrint() {
    setPrinting(true);
    setError(null);
    try {
      const blob = await fetchPdf();
      triggerBlobDownload(blob, `${fileNamePrefix}.pdf`);
    } catch (err) {
      setError(apiErrorMessage(err, "فشل إنشاء ملف الطباعة"));
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button className="btn-secondary" onClick={handlePrint} disabled={printing}>
        {printing ? "جاري التجهيز..." : "🖨️ طباعة"}
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}

export function FarmerAccountPage() {
  const { id } = useParams();
  const [account, setAccount] = useState<FarmerAccountDto | null>(null);

  useEffect(() => {
    if (id) getFarmerAccount(Number(id)).then(setAccount);
  }, [id]);

  if (!account) return <div className="text-gray-500">جاري التحميل...</div>;

  // Title reflects this person's ACTUAL type — a Driver never has a farmer side and vice versa
  // (a Both partner is farmer+merchant, never a driver, so their farmer-side title always reads "بائع").
  const roleLabel = account.type === "Driver" ? "سائق" : "بائع";

  return (
    <div>
      <Link to="/partners" className="text-sm text-brand-700 hover:underline">← رجوع إلى القائمة</Link>
      <div className="flex items-start justify-between flex-wrap gap-3 mt-2 mb-6">
        <h1 className="text-2xl font-bold">كشف حساب {roleLabel}: {account.name}</h1>
        <PrintAccountButton fetchPdf={() => printFarmerAccountPdf(Number(id))} fileNamePrefix={`account-${id}`} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
        <StatCard label="إجمالي المبيعات" value={formatCurrency(account.totalSalesValue)} />
        <StatCard label="إجمالي العمولة" value={formatCurrency(account.totalCommission)} />
        <StatCard label="صافي المستحق" value={formatCurrency(account.totalNetDue)} />
        <StatCard label="المدفوع" value={formatCurrency(account.totalPaid)} tone="positive" />
        <StatCard label="المتبقي" value={formatCurrency(account.remaining)} tone="negative" />
      </div>
      {/* Already folded into "المتبقي" above — shown on its own only when set, so the number is
          traceable back to what was manually entered vs. what came from actual transactions. */}
      {!!account.openingBalance && (
        <div className="text-sm text-gray-500 mb-4">رصيد افتتاحي مدرج ضمن المتبقي: <span className="font-medium text-gray-800">{formatCurrency(account.openingBalance)}</span></div>
      )}

      <StatementTable statement={account.statement} />
    </div>
  );
}

export function MerchantAccountPage() {
  const { id } = useParams();
  const [account, setAccount] = useState<MerchantAccountDto | null>(null);

  useEffect(() => {
    if (id) getMerchantAccount(Number(id)).then(setAccount);
  }, [id]);

  if (!account) return <div className="text-gray-500">جاري التحميل...</div>;

  return (
    <div>
      <Link to="/partners" className="text-sm text-brand-700 hover:underline">← رجوع إلى القائمة</Link>
      <div className="flex items-start justify-between flex-wrap gap-3 mt-2 mb-6">
        <h1 className="text-2xl font-bold">كشف حساب مشتري: {account.name}</h1>
        <PrintAccountButton fetchPdf={() => printMerchantAccountPdf(Number(id))} fileNamePrefix={`account-${id}`} />
      </div>

      {CREDIT_LIMIT_UI_ENABLED && account.isOverCreditLimit && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3 mb-4">
          ⚠️ هذا المشتري تجاوز الحد الائتماني المسموح ({formatCurrency(account.creditLimit ?? 0)}) — الرصيد المتبقي حاليًا {formatCurrency(account.remaining)}.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="إجمالي المشتريات" value={formatCurrency(account.totalPurchases)} />
        <StatCard label="المدفوع" value={formatCurrency(account.totalPaid)} tone="positive" />
        <StatCard label="المتبقي" value={formatCurrency(account.remaining)} tone="negative" />
        {CREDIT_LIMIT_UI_ENABLED && account.creditLimit != null && <StatCard label="الحد الائتماني" value={formatCurrency(account.creditLimit)} />}
      </div>
      {!!account.openingBalance && (
        <div className="text-sm text-gray-500 mb-4">رصيد افتتاحي مدرج ضمن المتبقي: <span className="font-medium text-gray-800">{formatCurrency(account.openingBalance)}</span></div>
      )}

      <StatementTable statement={account.statement} />
    </div>
  );
}

// "الكشف المفصل" — beyond the bare description, every line shows whatever detail actually applies
// to it: a clickable link to the real invoice (any line with an invoiceId), a farmer Sale line's
// gross value / commission split (so the net Amount is traceable), a payment's method, and any
// free-text notes (the person's own note, or — for an Adjustment line — the cancellation reason).
// Shared by both the farmer/driver and merchant account pages; a merchant statement simply never
// populates saleValue/commission, so that part of "التفاصيل" is silently skipped for those rows.
function StatementTable({ statement }: { statement: StatementLineDto[] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th>التاريخ</th>
            <th>الوصف</th>
            <th>التفاصيل</th>
            <th>المبلغ</th>
            <th>الرصيد التراكمي</th>
          </tr>
        </thead>
        <tbody>
          {statement.length === 0 ? (
            <tr><td colSpan={5} className="text-center text-gray-400 py-6">لا توجد حركات</td></tr>
          ) : (
            statement.map((line, idx) => (
              <tr key={idx}>
                <td className="whitespace-nowrap">{formatDate(line.date)}</td>
                <td>
                  {line.description}
                  {line.invoiceId != null && (
                    <>
                      {" "}
                      <Link to={`/invoices/${line.invoiceId}`} className="text-brand-700 hover:underline text-xs">(عرض الفاتورة)</Link>
                    </>
                  )}
                </td>
                <td className="text-xs text-gray-500">
                  <StatementLineDetails line={line} />
                </td>
                <td className={line.amount < 0 ? "text-brand-700" : ""}>{formatCurrency(line.amount)}</td>
                <td className="font-semibold">{formatCurrency(line.runningBalance)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function StatementLineDetails({ line }: { line: StatementLineDto }) {
  const parts: string[] = [];
  if (line.saleValue != null && line.commission != null) {
    parts.push(`قيمة المبيعات: ${formatCurrency(line.saleValue)}`);
    parts.push(`العمولة: ${formatCurrency(line.commission)}`);
  }
  if (line.method) parts.push(`طريقة الدفع: ${line.method}`);

  if (parts.length === 0 && !line.notes) return <>—</>;

  return (
    <>
      {parts.join(" — ")}
      {line.notes && <div className={parts.length > 0 ? "mt-0.5" : undefined}>ملاحظة: {line.notes}</div>}
    </>
  );
}
