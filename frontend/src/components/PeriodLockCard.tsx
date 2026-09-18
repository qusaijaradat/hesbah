import { useEffect, useState } from "react";
import { closePeriod, getPeriodLock, reopenPeriod } from "../api/periodLock";
import { updateSetting } from "../api/settings";
import { apiErrorMessage } from "../api/client";
import type { PeriodLockStatusDto } from "../types";

/** The three settings the lock runs on. Managed here, and hidden from the plain settings list
 * below — a month typed by hand into a text box is how the boundary ends up wrong. */
export const PERIOD_LOCK_KEYS = [
  "period.locked_through",
  "period.auto_lock_days",
  "period.auto_lock_hold_until",
];

/** "2026-08" → "شهر 8 / 2026". The stored form is for the server; nobody reads a month that way. */
function monthLabel(month: string | null | undefined) {
  if (!month) return null;
  const [year, m] = month.split("-");
  return `شهر ${Number(m)} / ${year}`;
}

/** "2026-08-31" → "31/08/2026", left alone if it is not a date. */
function dayLabel(day: string | null | undefined) {
  if (!day) return null;
  const [year, m, d] = day.split("-");
  return d ? `${d}/${m}/${year}` : day;
}

/**
 * Closing a settled month, so what was printed and paid against cannot quietly change afterwards.
 *
 * The card is mostly the explanation, on purpose. Every other setting on this screen is a number
 * somebody already understands; this one changes what other people are allowed to do, and a switch
 * whose effect nobody can describe gets turned on once and worked around forever.
 *
 * Reopening asks for a typed word for the same reason the balance migration does: it is the one
 * action here that takes protection AWAY, and the pause costs less than the afternoon spent
 * working out why a settled month moved.
 */
export function PeriodLockCard({ canEdit, canEditSettings }: { canEdit: boolean; canEditSettings: boolean }) {
  const [status, setStatus] = useState<PeriodLockStatusDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const [days, setDays] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const next = await getPeriodLock();
      setStatus(next);
      setDays(String(next.autoLockDays));
    } catch (err) {
      setError(apiErrorMessage(err, "تعذّر قراءة حالة القفل"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function run(what: () => Promise<PeriodLockStatusDto>, done: string) {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const next = await what();
      setStatus(next);
      setDays(String(next.autoLockDays));
      setTyped("");
      setMessage(done);
    } catch (err) {
      setError(apiErrorMessage(err, "فشل التنفيذ"));
    } finally {
      setBusy(false);
    }
  }

  async function saveDays() {
    setBusy(true);
    setError(null);
    try {
      await updateSetting("period.auto_lock_days", days.trim());
      await refresh();
      setMessage("تم الحفظ");
    } catch (err) {
      setError(apiErrorMessage(err, "فشل الحفظ"));
    } finally {
      setBusy(false);
    }
  }

  const closed = monthLabel(status?.lockedThroughMonth);
  // Offered only when there is actually a month between the lock and today. The server decides
  // which one that is; the button never names a month of its own.
  const canClose =
    status !== null &&
    (status.lockedThroughMonth === null || status.closableNow > status.lockedThroughMonth);

  return (
    <div className="card p-4 mb-4">
      <label className="label">قفل الفترة</label>
      <p className="text-xs text-gray-500 mb-3">
        لما تخلص حساب شهر وتطبع الكشوف وتحاسب عليها، بتقفل الشهر. بعدها ما بيقدر حدا — مهما كانت
        صلاحيته بالتعديل — يعدّل أو يحذف فاتورة أو دفعة أو مصروف تاريخها ضمن الشهر المقفل أو قبله،
        ولا يدخّل إشي جديد بتاريخ قديم. التصحيح بصير بقيد جديد بتاريخ اليوم، فالكشف القديم بيضل زي
        ما هو والفرق بيبيّن بالشهر الجديد.
        <br />
        <span className="text-gray-400">
          الإقفال اليومي تقرير — بيلخّص اليوم وما بيمنع إشي. هاد هو القفل.
        </span>
      </p>

      {loading && <p className="text-xs text-gray-400">جاري القراءة...</p>}
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      {message && <p className="text-sm text-brand-800 mb-2">{message}</p>}

      {status && !loading && (
        <>
          <div className="rounded-md p-3 mb-3 bg-gray-50">
            {closed ? (
              <div className="text-sm">
                مقفل لغاية <strong>{dayLabel(status.closedThrough)}</strong>{" "}
                <span className="text-gray-500">(آخر شهر مقفل: {closed})</span>
              </div>
            ) : (
              <div className="text-sm text-amber-700">
                ما فيه أي شهر مقفل لهلأ — أي حدا عنده صلاحية تعديل بيقدر يعدّل فاتورة من أي شهر.
              </div>
            )}

            {status.nextMonthToClose ? (
              <div className="text-xs text-gray-500 mt-1">
                الجاي: <strong>{monthLabel(status.nextMonthToClose)}</strong> بينقفل لحاله بتاريخ{" "}
                {dayLabel(status.nextCloseOn)}.
              </div>
            ) : status.autoLockDays > 0 ? (
              // Not a fault. The automatic close deliberately waits for a first close by hand, so a
              // system installed today does not seal a year of history nobody was warned about.
              <div className="text-xs text-gray-500 mt-1">
                القفل التلقائي بيشتغل بعد أول ما تقفل شهر بإيدك.
              </div>
            ) : (
              <div className="text-xs text-gray-500 mt-1">القفل التلقائي مطفّي.</div>
            )}

            {status.holdUntil && (
              <div className="text-xs text-amber-700 mt-1">
                الشهر مفتوح للتصحيح لحد {dayLabel(status.holdUntil)} — وبعدها بينقفل لحاله.
              </div>
            )}
          </div>

          {canEditSettings && (
            <div className="mb-3">
              <label className="label">كم يوم بعد نهاية الشهر بينقفل لحاله</label>
              <div className="flex gap-2">
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={days}
                  disabled={busy}
                  onChange={(e) => setDays(e.target.value)}
                />
                <button className="btn-primary shrink-0" disabled={busy} onClick={() => void saveDays()}>
                  حفظ
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                صفر = بطّل القفل التلقائي وخلّي القفل بإيدك. الافتراضي ١٠ أيام — بتكون حسبة الشهر خلصت.
              </p>
            </div>
          )}

          {canEdit && (
            <div className="border-t border-gray-200 pt-3 flex flex-col gap-3">
              {canClose && (
                <div>
                  <button
                    className="btn-primary"
                    disabled={busy}
                    onClick={() => void run(
                      () => closePeriod(status.closableNow),
                      `تم قفل ${monthLabel(status.closableNow)}`,
                    )}
                  >
                    {busy ? "..." : `أقفل ${monthLabel(status.closableNow)}`}
                  </button>
                  <p className="text-xs text-gray-400 mt-1">
                    بيقفل هاد الشهر وكل اللي قبله. ما بينقفل شهر لسا ما خلص.
                  </p>
                </div>
              )}

              {closed && (
                <div>
                  <label className="label">افتح آخر شهر مقفل ({closed})</label>
                  <div className="flex gap-2">
                    <input
                      className="input"
                      value={typed}
                      disabled={busy}
                      onChange={(e) => setTyped(e.target.value)}
                      placeholder="اكتب «افتح» للتأكيد"
                    />
                    <button
                      className="btn-danger shrink-0"
                      disabled={busy || typed.trim() !== "افتح"}
                      onClick={() => void run(reopenPeriod, `انفتح ${closed} للتصحيح`)}
                    >
                      افتح
                    </button>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    بيفتح هاد الشهر بس — اللي قبله بيضل مقفل — وبينقفل لحاله بعد ٣ أيام.
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
