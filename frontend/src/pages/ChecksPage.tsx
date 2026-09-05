import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listChecks, printChecksPdf, updatePayment } from "../api/payments";
import { triggerBlobDownload } from "../api/invoices";
import { apiErrorMessage } from "../api/client";
import { formatCurrency, formatDate, todayLocalDateString } from "../lib/format";
import { useAuth } from "../auth/AuthContext";
import type { CheckClearanceStatus, PaymentDto } from "../types";

/** Pending checks due within this many days (but not yet overdue) get the amber "قريبًا" highlight
 * — distinct from the red "فات الاستحقاق" highlight for ones already overdue. Gives an early warning
 * before a check is actually late. */
const DUE_SOON_DAYS = 7;

/** "2026-08" → the month's first/last calendar day, as "YYYY-MM-DD" strings — used to scope the
 * checks-print PDF to whichever month is currently on screen (unless "عرض كل الشهور" is on). */
function monthRange(yyyyMm: string): { from: string; to: string } {
  const [y, m] = yyyyMm.split("-").map(Number);
  const from = `${yyyyMm}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${yyyyMm}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

const STATUS_LABELS: Record<CheckClearanceStatus, string> = {
  Pending: "قيد التحصيل",
  Cleared: "تم الصرف",
  Bounced: "مرتجع",
};

const STATUS_BADGE_CLASS: Record<CheckClearanceStatus, string> = {
  Pending: "bg-amber-50 text-amber-700 border border-amber-200",
  Cleared: "bg-brand-50 text-brand-700 border border-brand-200",
  Bounced: "bg-red-50 text-red-700 border border-red-200",
};

/// <summary>
/// "الشيكات" — every payment recorded as a check (Payment.CheckDueDate set), regardless of
/// direction/partner, soonest-due first (see PaymentService.ListChecksAsync). A pending check
/// whose due date has already passed is highlighted — that's the whole point of a dedicated page:
/// a check is easy to lose track of once it's filed away, unlike cash which is settled the same day.
/// </summary>
/** "2026-08" → shift by `delta` months, still "YYYY-MM". Used by the ‹ › month-nav buttons. */
function shiftMonth(yyyyMm: string, delta: number): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function ChecksPage() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("payments.edit");
  const [checks, setChecks] = useState<PaymentDto[]>([]);
  const [statusFilter, setStatusFilter] = useState<CheckClearanceStatus | "">("");
  // Defaults to the current month — opening the page should answer "لمين ومتى الشيكات هالشهر"
  // without picking anything first. "عرض كل الشهور" below switches this filter off entirely.
  const [monthFilter, setMonthFilter] = useState(() => todayLocalDateString().slice(0, 7));
  const [showAllMonths, setShowAllMonths] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const result = await listChecks({ status: statusFilter || undefined, pageSize: 200 });
      setChecks(result.items);
    } catch (err) {
      setError(apiErrorMessage(err, "فشل تحميل الشيكات"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function setStatus(p: PaymentDto, status: CheckClearanceStatus) {
    setBusyId(p.id);
    setError(null);
    try {
      await updatePayment(p.id, {
        amount: p.amount, date: p.date, method: p.method ?? undefined, notes: p.notes ?? undefined,
        invoiceId: p.invoiceId ?? null,
        checkDueDate: p.checkDueDate ?? null, checkNumber: p.checkNumber ?? undefined,
        checkStatus: status,
        // Marking a check Cleared from here (rather than the full edit modal) still needs an
        // actual clearing date recorded — default to today; already-cleared checks keep their date.
        checkClearedDate: status === "Cleared" ? (p.checkClearedDate ?? todayLocalDateString()) : null,
      });
      await refresh();
    } catch (err) {
      setError(apiErrorMessage(err, "فشل تحديث حالة الشيك"));
    } finally {
      setBusyId(null);
    }
  }

  async function handlePrint() {
    setPrinting(true);
    setPrintError(null);
    try {
      const range = showAllMonths ? null : monthRange(monthFilter);
      const periodLabel = showAllMonths ? "كل الشهور" : `شهر ${monthFilter}`;
      const blob = await printChecksPdf({
        status: statusFilter || undefined,
        dueFrom: range?.from,
        dueTo: range?.to,
        periodLabel,
      });
      triggerBlobDownload(blob, `checks-${showAllMonths ? "all" : monthFilter}.pdf`);
    } catch (err) {
      setPrintError(apiErrorMessage(err, "فشل إنشاء ملف الطباعة"));
    } finally {
      setPrinting(false);
    }
  }

  const today = todayLocalDateString();
  // Client-side month filter — checks are a small, bounded list (see the pageSize:200 fetch
  // above), so there's no need for a backend date-range query just for this.
  const visibleChecks = showAllMonths
    ? checks
    : checks.filter((c) => c.checkDueDate && c.checkDueDate.slice(0, 7) === monthFilter);
  const pendingTotal = visibleChecks
    .filter((c) => c.checkStatus === "Pending")
    .reduce((sum, c) => sum + c.amount, 0);

  return (
    <div>
      <div className="flex items-start justify-between flex-wrap gap-3 mb-1">
        <h1 className="text-2xl font-bold">الشيكات</h1>
        <div className="flex items-center gap-3">
          <button className="btn-secondary" onClick={handlePrint} disabled={printing}>
            {printing ? "جاري التجهيز..." : "🖨️ طباعة"}
          </button>
          <Link to="/payments" className="text-sm text-brand-700 hover:underline">→ الدفعات والمصاريف</Link>
        </div>
      </div>
      {printError && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2 mb-2">{printError}</div>}
      <p className="text-sm text-gray-500 mb-4">
        كل دفعة سُجّلت كشيك (له تاريخ استحقاق) — الأقدم استحقاقًا أولًا. الشيكات "قيد التحصيل" وتاريخها فات، لونها أحمر، والمستحقة قريبًا (خلال {DUE_SOON_DAYS} أيام) لونها كهرماني.
      </p>

      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button className="btn-secondary px-3" disabled={showAllMonths} onClick={() => setMonthFilter((m) => shiftMonth(m, -1))}>‹</button>
          <input
            className="input"
            type="month"
            value={monthFilter}
            disabled={showAllMonths}
            onChange={(e) => setMonthFilter(e.target.value)}
          />
          <button className="btn-secondary px-3" disabled={showAllMonths} onClick={() => setMonthFilter((m) => shiftMonth(m, 1))}>›</button>
        </div>
        <label className="flex items-center gap-1 text-sm text-gray-600">
          <input type="checkbox" checked={showAllMonths} onChange={(e) => setShowAllMonths(e.target.checked)} />
          عرض كل الشهور
        </label>
        <select className="input max-w-xs" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as CheckClearanceStatus | "")}>
          <option value="">كل الحالات</option>
          <option value="Pending">قيد التحصيل</option>
          <option value="Cleared">تم الصرف</option>
          <option value="Bounced">مرتجع</option>
        </select>
      </div>
      <div className="text-sm text-gray-500 mb-4">
        {showAllMonths ? "كل الشهور" : `شهر ${monthFilter}`} — عدد الشيكات: <span className="font-semibold text-gray-800">{visibleChecks.length}</span>
        {" · "}إجمالي "قيد التحصيل": <span className="font-semibold text-gray-800">{formatCurrency(pendingTotal)}</span>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2 mb-4">{error}</div>}

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>تاريخ الاستحقاق</th>
              <th>الشخص</th>
              <th>الاتجاه</th>
              <th>القيمة</th>
              <th>رقم الشيك</th>
              <th>الفاتورة</th>
              <th>الحالة</th>
              <th>تاريخ الصرف الفعلي</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={canEdit ? 9 : 8} className="text-center text-gray-400 py-6">جاري التحميل...</td></tr>
            ) : visibleChecks.length === 0 ? (
              <tr><td colSpan={canEdit ? 9 : 8} className="text-center text-gray-400 py-6">
                {showAllMonths ? "لا توجد شيكات" : "لا توجد شيكات مستحقة هذا الشهر"}
              </td></tr>
            ) : visibleChecks.map((c) => {
              const isOverdue = c.checkStatus === "Pending" && !!c.checkDueDate && c.checkDueDate.slice(0, 10) < today;
              const daysUntilDue = c.checkDueDate
                ? Math.round((new Date(c.checkDueDate.slice(0, 10)).getTime() - new Date(today).getTime()) / 86400000)
                : null;
              const isDueSoon = !isOverdue && c.checkStatus === "Pending" && daysUntilDue !== null && daysUntilDue >= 0 && daysUntilDue <= DUE_SOON_DAYS;
              return (
                <tr key={c.id} className={isOverdue ? "bg-red-50" : isDueSoon ? "bg-amber-50" : ""}>
                  <td className={isOverdue ? "text-red-700 font-semibold" : isDueSoon ? "text-amber-700 font-semibold" : ""}>
                    {c.checkDueDate ? formatDate(c.checkDueDate) : "—"}
                    {isOverdue && <div className="text-xs">⚠️ فات الاستحقاق</div>}
                    {isDueSoon && <div className="text-xs">⏳ مستحق قريبًا</div>}
                  </td>
                  <td className="font-medium">{c.partnerName}</td>
                  <td className="text-sm text-gray-500">{c.direction === "ToFarmer" ? "للبائع/السائق" : "من المشتري"}</td>
                  <td className="font-medium">{formatCurrency(c.amount)}</td>
                  <td className="text-gray-500">{c.checkNumber || "—"}</td>
                  <td className="text-gray-500 text-sm">{c.invoiceNumber ?? "—"}</td>
                  <td>
                    <span className={`text-xs rounded-full px-2 py-1 ${STATUS_BADGE_CLASS[c.checkStatus ?? "Pending"]}`}>
                      {STATUS_LABELS[c.checkStatus ?? "Pending"]}
                    </span>
                  </td>
                  <td className="text-gray-500 text-sm">{c.checkClearedDate ? formatDate(c.checkClearedDate) : "—"}</td>
                  {canEdit && (
                    <td className="whitespace-nowrap">
                      {c.checkStatus !== "Cleared" && (
                        <button className="text-brand-700 text-sm hover:underline ms-2" disabled={busyId === c.id} onClick={() => setStatus(c, "Cleared")}>
                          تحديد كمصروف
                        </button>
                      )}
                      {c.checkStatus !== "Bounced" && (
                        <button className="text-red-600 text-sm hover:underline ms-2" disabled={busyId === c.id} onClick={() => setStatus(c, "Bounced")}>
                          تحديد كمرتجع
                        </button>
                      )}
                      {c.checkStatus !== "Pending" && (
                        <button className="text-gray-500 text-sm hover:underline ms-2" disabled={busyId === c.id} onClick={() => setStatus(c, "Pending")}>
                          إعادة لقيد التحصيل
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
