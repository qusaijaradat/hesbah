import { useEffect, useState } from "react";
import { usePagination } from "../lib/usePagination";
import { TablePagination } from "../components/TablePagination";
import { Link, useParams } from "react-router-dom";
import {
  createAdjustment, getFarmerAccount, getMerchantAccount,
  printFarmerAccountPdf, printMerchantAccountPdf,
} from "../api/partners";
import { apiErrorMessage } from "../api/client";
import type { FarmerAccountDto, MerchantAccountDto, StatementLineDto } from "../types";
import { formatCurrency, formatDate, partnerHasRole } from "../lib/format";
import { StatCard } from "../components/StatCard";
import { useAuth } from "../auth/AuthContext";
import { PdfActions } from "../components/PdfActions";
import { CollapsibleRows } from "../components/CollapsibleRows";
import { OtherSideNotice } from "../components/OtherSideNotice";



export function FarmerAccountPage() {
  const { id } = useParams();
  const [account, setAccount] = useState<FarmerAccountDto | null>(null);

  async function refresh() {
    if (id) setAccount(await getFarmerAccount(Number(id)));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!account) return <div className="text-gray-500">جاري التحميل...</div>;

  // Title reflects this person's ACTUAL type — a Driver never has a farmer side and vice versa
  // (a Both partner is farmer+merchant, never a driver, so their farmer-side title always reads "بائع").
  const roleLabel = partnerHasRole(account.type, "Driver") && !partnerHasRole(account.type, "Farmer") ? "سائق" : "بائع";

  return (
    <div>
      <Link to="/partners" className="text-sm text-brand-700 hover:underline">← رجوع إلى القائمة</Link>
      <div className="flex items-start justify-between flex-wrap gap-3 mt-2 mb-6">
        <h1 className="text-2xl font-bold">كشف حساب {roleLabel}: {account.name}</h1>
        <PdfActions fetchPdf={() => printFarmerAccountPdf(Number(id))} fileName={`account-${id}.pdf`} shareTitle="كشف حساب" />
      </div>

      {/* A seller who also buys. Standing here you could pay him everything he is owed and never
          learn he owed the market on the other page — see components/OtherSideNotice. */}
      <OtherSideNotice partnerId={Number(id)} side="seller" />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
        <StatCard label="إجمالي المبيعات" value={formatCurrency(account.totalSalesValue)} />
        <StatCard label="إجمالي العمولة" value={formatCurrency(account.totalCommission)} />
        <StatCard label="صافي المستحق" value={formatCurrency(account.totalNetDue)} />
        <StatCard label="المدفوع" value={formatCurrency(account.totalPaid)} tone="positive" />
        <StatCard label="المتبقي" value={formatCurrency(account.remaining)} tone="negative" />
      </div>
      {/* Already folded into "المتبقي" above — shown on its own only when set, so the number is
          traceable back to what was manually entered vs. what came from actual transactions. */}


      <AdjustmentSection partnerId={Number(id)} roleLabel={roleLabel} onChanged={refresh} />

      {/* Sellers and drivers hold crates and sacks too — the wooden crates that arrive with a
          seller's produce are already counted there. */}
      <Link to={`/containers?partner=${id}`} className="text-sm text-brand-700 hover:underline">
        📦 الصناديق لهذا ال{roleLabel}
      </Link>


      <StatementTable statement={account.statement} />
    </div>
  );
}

/**
 * "تسوية/تعويض" — the one case the market actually has for the word "خصم": an item's price
 * collapses in the market after a seller brought it in, and he is compensated for it. That is
 * money moving TO the seller, which is why it lives here on his account and not as a field on the
 * buyer's invoice (where a "discount" only ever reduced what the BUYER owed and came out of the
 * market's own margin — see the removed Invoice.Discount).
 *
 * Deliberately not tied to an invoice: the reason usually covers a whole load, not one line. It
 * never touches the commission either — that stays on the sale value as originally invoiced.
 *
 * There is no delete. A ledger line that moved a real balance is corrected by posting the
 * opposite line, which leaves both the mistake and the correction visible on the statement —
 * quietly removing it would leave a balance nobody can explain from the history.
 */
function AdjustmentSection({ partnerId, roleLabel, onChanged }: { partnerId: number; roleLabel: string; onChanged: () => void }) {
  const { hasPermission } = useAuth();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  // Which way the money goes is a choice, not a minus sign someone has to remember to type.
  const [direction, setDirection] = useState<"credit" | "debit">("credit");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasPermission("partners.adjust")) return null;

  const value = parseFloat(amount) || 0;
  const signed = direction === "credit" ? value : -value;

  async function handleSave() {
    setError(null);
    if (value <= 0) { setError("أدخل قيمة أكبر من صفر."); return; }
    if (!reason.trim()) { setError("اكتب سبب التسوية."); return; }
    setBusy(true);
    try {
      await createAdjustment(partnerId, { amount: signed, reason: reason.trim() });
      setAmount(""); setReason(""); setDirection("credit"); setOpen(false);
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, "فشل حفظ التسوية"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 mb-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="font-semibold text-gray-700">تسوية / تعويض</div>
          <p className="text-xs text-gray-500 mt-1">
            لتعويض ال{roleLabel} عن بضاعة انخسف سعرها، أو لتصحيح رصيد. بتظهر كسطر مستقل بالكشف، وما بتأثر على العمولة.
          </p>
        </div>
        {!open && <button className="btn-secondary text-sm" onClick={() => setOpen(true)}>➕ تسجيل تسوية</button>}
      </div>

      {open && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="label">النوع</label>
            <select className="input" value={direction} onChange={(e) => setDirection(e.target.value as "credit" | "debit")}>
              <option value="credit">له (بزيد المستحق)</option>
              <option value="debit">عليه (بنقّص المستحق)</option>
            </select>
          </div>
          <div>
            <label className="label">القيمة (₪)</label>
            <input className="input" type="number" min="0" step="0.01" value={amount}
              onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="grow min-w-0 sm:min-w-[14rem]">
            <label className="label">السبب</label>
            <input className="input" value={reason} maxLength={500}
              onChange={(e) => setReason(e.target.value)} placeholder="مثال: تعويض عن انخفاض سعر البندورة" />
          </div>
          <button className="btn-primary" onClick={handleSave} disabled={busy}>{busy ? "جاري الحفظ..." : "حفظ"}</button>
          <button className="btn-secondary" onClick={() => { setOpen(false); setError(null); }} disabled={busy}>إلغاء</button>
          {value > 0 && (
            <div className="w-full text-xs text-gray-500">
              رح ينزل سطر بقيمة <span className="font-semibold text-gray-800">{formatCurrency(signed)}</span> على حساب ال{roleLabel}.
            </div>
          )}
          {error && <div className="w-full text-sm text-red-600">{error}</div>}
        </div>
      )}
    </div>
  );
}

export function MerchantAccountPage() {
  const { id } = useParams();
  const [account, setAccount] = useState<MerchantAccountDto | null>(null);

  async function refresh() {
    if (id) setAccount(await getMerchantAccount(Number(id)));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!account) return <div className="text-gray-500">جاري التحميل...</div>;

  return (
    <div>
      <Link to="/partners" className="text-sm text-brand-700 hover:underline">← رجوع إلى القائمة</Link>
      <div className="flex items-start justify-between flex-wrap gap-3 mt-2 mb-6">
        <h1 className="text-2xl font-bold">كشف حساب مشتري: {account.name}</h1>
        <PdfActions fetchPdf={() => printMerchantAccountPdf(Number(id))} fileName={`account-${id}.pdf`} shareTitle="كشف حساب" />
      </div>

      <OtherSideNotice partnerId={Number(id)} side="merchant" />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="إجمالي المشتريات" value={formatCurrency(account.totalPurchases)} />
        <StatCard label="المدفوع" value={formatCurrency(account.totalPaid)} tone="positive" />
        <StatCard label="المتبقي" value={formatCurrency(account.remaining)} tone="negative" />
      </div>


      {/* Crates and sacks have their own screen now — they are counts, they apply to sellers and
          drivers too, and there is more than one kind. */}
      <Link to={`/containers?partner=${id}`} className="text-sm text-brand-700 hover:underline">
        📦 الصناديق لهذا المشتري
      </Link>

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
  // A running account statement only ever grows — page it like every other table.
  const pager = usePagination(statement);
  return (
    <div className="card">
      {/* A statement is read down the running balance, which is the one figure kept on the closed
          card — the line that changed it opens underneath. */}
      <div className="sm:hidden">
        <CollapsibleRows
          rows={statement}
          rowKey={(l) => `${l.date}-${l.description}-${l.amount}-${l.runningBalance}`}
          title={(l) => l.description}
          value={(l) => formatCurrency(l.runningBalance)}
          details={(l) => [
            { label: "التاريخ", value: formatDate(l.date) },
            { label: "المبلغ", value: formatCurrency(l.amount) },
            { label: "الفاتورة", value: l.invoiceNumber || "—" },
          ]}
          empty="لا توجد حركات"
        />
      </div>
      <div className="hidden sm:block overflow-x-auto">
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
            pager.pageRows.map((line, idx) => (
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
      <TablePagination
        page={pager.page} pageSize={pager.pageSize} totalCount={pager.totalCount}
        itemLabel="حركة" onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize}
      />
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
