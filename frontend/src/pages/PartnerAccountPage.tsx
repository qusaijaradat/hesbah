import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getFarmerAccount, getMerchantAccount } from "../api/partners";
import type { FarmerAccountDto, MerchantAccountDto } from "../types";
import { formatCurrency, formatDate } from "../lib/format";
import { StatCard } from "../components/StatCard";

export function FarmerAccountPage() {
  const { id } = useParams();
  const [account, setAccount] = useState<FarmerAccountDto | null>(null);

  useEffect(() => {
    if (id) getFarmerAccount(Number(id)).then(setAccount);
  }, [id]);

  if (!account) return <div className="text-gray-500">جاري التحميل...</div>;

  return (
    <div>
      <Link to="/partners" className="text-sm text-brand-700 hover:underline">← رجوع إلى القائمة</Link>
      <h1 className="text-2xl font-bold mt-2 mb-6">كشف حساب بائع/سائق: {account.name}</h1>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
        <StatCard label="إجمالي المبيعات" value={formatCurrency(account.totalSalesValue)} />
        <StatCard label="إجمالي العمولة" value={formatCurrency(account.totalCommission)} />
        <StatCard label="صافي المستحق" value={formatCurrency(account.totalNetDue)} />
        <StatCard label="المدفوع" value={formatCurrency(account.totalPaid)} tone="positive" />
        <StatCard label="المتبقي" value={formatCurrency(account.remaining)} tone="negative" />
      </div>

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
      <h1 className="text-2xl font-bold mt-2 mb-6">كشف حساب مشتري: {account.name}</h1>

      {account.isOverCreditLimit && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3 mb-4">
          ⚠️ هذا المشتري تجاوز الحد الائتماني المسموح ({formatCurrency(account.creditLimit ?? 0)}) — الرصيد المتبقي حاليًا {formatCurrency(account.remaining)}.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="إجمالي المشتريات" value={formatCurrency(account.totalPurchases)} />
        <StatCard label="المدفوع" value={formatCurrency(account.totalPaid)} tone="positive" />
        <StatCard label="المتبقي" value={formatCurrency(account.remaining)} tone="negative" />
        {account.creditLimit != null && <StatCard label="الحد الائتماني" value={formatCurrency(account.creditLimit)} />}
      </div>

      <StatementTable statement={account.statement} />
    </div>
  );
}

function StatementTable({ statement }: { statement: { date: string; description: string; amount: number; runningBalance: number }[] }) {
  return (
    <div className="card overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th>التاريخ</th>
            <th>الوصف</th>
            <th>المبلغ</th>
            <th>الرصيد التراكمي</th>
          </tr>
        </thead>
        <tbody>
          {statement.length === 0 ? (
            <tr><td colSpan={4} className="text-center text-gray-400 py-6">لا توجد حركات</td></tr>
          ) : (
            statement.map((line, idx) => (
              <tr key={idx}>
                <td>{formatDate(line.date)}</td>
                <td>{line.description}</td>
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
