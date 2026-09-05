import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  createBoxReturn, deleteBoxReturn, getFarmerAccount, getMerchantAccount,
  printFarmerAccountPdf, printMerchantAccountPdf,
} from "../api/partners";
import { triggerBlobDownload } from "../api/invoices";
import { apiErrorMessage } from "../api/client";
import type { FarmerAccountDto, MerchantAccountDto, StatementLineDto } from "../types";
import { formatCurrency, formatDate, formatQuantity, todayLocalDateString } from "../lib/format";
import { StatCard } from "../components/StatCard";
import { CREDIT_LIMIT_UI_ENABLED } from "../lib/featureFlags";
import { useAuth } from "../auth/AuthContext";

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

      <BoxBalanceSection partnerId={Number(id)} account={account} onChanged={refresh} />

      <StatementTable statement={account.statement} />
    </div>
  );
}

/// <summary>
/// "صناديق مطلوبة من المشتري" (explicit request) — a crate COUNT, entirely separate from the money
/// StatCards above: boxesGiven/boxesReturned/boxesRemaining come straight off the same
/// getMerchantAccount() call the rest of this page already uses (see backend
/// PartnerService.GetMerchantAccountAsync), so no second round trip. The record-a-return form below
/// is this page's own inline mini-form (unlike Payments, which only has a "تسجيل دفعة" form on its
/// own separate /payments page) — a crate return is small/frequent enough that navigating away just
/// to log "5 صناديق رجعت" would be annoying friction.
/// </summary>
function BoxBalanceSection({ partnerId, account, onChanged }: { partnerId: number; account: MerchantAccountDto; onChanged: () => void }) {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("boxes.create");
  const canDelete = hasPermission("boxes.delete");

  const [showForm, setShowForm] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [date, setDate] = useState(todayLocalDateString());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const parsed = Number(quantity);
    if (!parsed || parsed <= 0) {
      setError("أدخل عدد صناديق أكبر من صفر");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await createBoxReturn(partnerId, { date, quantity: parsed, notes: notes || undefined });
      setQuantity("");
      setNotes("");
      setShowForm(false);
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, "فشل تسجيل الإرجاع"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(returnId: number) {
    setDeletingId(returnId);
    setError(null);
    try {
      await deleteBoxReturn(returnId);
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, "فشل حذف السجل"));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="card p-4 mb-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <h2 className="font-semibold">صناديق مطلوبة من المشتري</h2>
        {canCreate && !showForm && (
          <button className="btn-secondary" onClick={() => setShowForm(true)}>+ تسجيل إرجاع صناديق</button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="text-center">
          <div className="text-xs text-gray-500">صناديق مُسلَّمة له</div>
          <div className="text-lg font-bold">{formatQuantity(account.boxesGiven, "Box")}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-gray-500">صناديق أُرجعت</div>
          <div className="text-lg font-bold text-brand-700">{formatQuantity(account.boxesReturned, "Box")}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-gray-500">المتبقي عليه</div>
          <div className="text-lg font-bold text-red-700">{formatQuantity(account.boxesRemaining, "Box")}</div>
        </div>
      </div>

      {showForm && (
        <div className="border-t pt-3 mt-1 flex flex-wrap items-end gap-2">
          <div>
            <label className="label text-xs">التاريخ</label>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="label text-xs">عدد الصناديق المُرجعة</label>
            <input type="number" min="1" className="input w-32" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="flex-1 min-w-[10rem]">
            <label className="label text-xs">ملاحظات (اختياري)</label>
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <button className="btn-primary" disabled={saving} onClick={handleSave}>{saving ? "..." : "حفظ"}</button>
          <button className="btn-secondary" disabled={saving} onClick={() => { setShowForm(false); setError(null); }}>إلغاء</button>
        </div>
      )}
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2 mt-3">{error}</div>}

      {account.boxReturns.length > 0 && (
        <div className="overflow-x-auto mt-4">
          <table className="table-base">
            <thead>
              <tr><th>التاريخ</th><th>العدد</th><th>ملاحظات</th>{canDelete && <th></th>}</tr>
            </thead>
            <tbody>
              {account.boxReturns.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{formatDate(r.date)}</td>
                  <td>{formatQuantity(r.quantity, "Box")}</td>
                  <td className="text-xs text-gray-500">{r.notes || "—"}</td>
                  {canDelete && (
                    <td>
                      <button className="text-xs text-red-600 hover:underline" disabled={deletingId === r.id} onClick={() => handleDelete(r.id)}>
                        {deletingId === r.id ? "..." : "حذف"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
