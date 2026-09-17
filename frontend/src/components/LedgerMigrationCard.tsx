import { useEffect, useState } from "react";
import { previewLedgerMigration, runLedgerMigration, undoLedgerMigration } from "../api/ledgerMigration";
import { apiErrorMessage } from "../api/client";
import { formatCurrency, formatDateTime } from "../lib/format";
import { CollapsibleRows } from "./CollapsibleRows";
import type { LedgerMigrationPartnerRow, LedgerMigrationPreviewDto } from "../types";

/** Typed in full before the button works. Not a flourish: see the note on the input below. */
const CONFIRM_PHRASE = "انقل";
const UNDO_PHRASE = "تراجع";

/**
 * The one-time move of historical balances from sellers onto the drivers who brought their loads.
 *
 * The screen is mostly the preview, deliberately. The action is one button; everything above it is
 * the answer to "what exactly is about to happen to whose money", named person by person, with the
 * balance each of them has right now and the one they would have after. That list is the point —
 * pressing the button is the easy part and the part nobody needs help with.
 *
 * Nothing here polls or refreshes on its own. A figure that changes under the reader while they are
 * deciding is worse than a stale one they asked for.
 */
export function LedgerMigrationCard() {
  const [preview, setPreview] = useState<LedgerMigrationPreviewDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setPreview(await previewLedgerMigration());
    } catch (err) {
      setError(apiErrorMessage(err, "تعذّر قراءة حالة النقل"));
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const undoing = preview?.alreadyMigrated === true;
  const phrase = undoing ? UNDO_PHRASE : CONFIRM_PHRASE;

  async function act() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = undoing ? await undoLedgerMigration() : await runLedgerMigration();
      setMessage(
        `تم — ${result.rowsMoved} سطر بقيمة ${formatCurrency(result.amountMoved)} ` +
        (undoing ? "رجعت للباعة." : "انتقلت للسواق."),
      );
      setTyped("");
      await refresh();
    } catch (err) {
      setError(apiErrorMessage(err, "فشل التنفيذ"));
    } finally {
      setBusy(false);
    }
  }

  function partnerTable(rows: LedgerMigrationPartnerRow[], heading: string, sign: "-" | "+") {
    if (rows.length === 0) return null;
    return (
      <div className="mt-3">
        <h4 className="text-sm font-semibold mb-1">{heading} ({rows.length})</h4>

        {/* Phone: the name and what moves, with the two balances a tap away. */}
        <div className="sm:hidden border border-gray-200 rounded-md">
          <CollapsibleRows
            rows={rows}
            rowKey={(r) => r.partnerId}
            title={(r) => r.name}
            value={(r) => (
              <span className={sign === "-" ? "text-red-600" : "text-green-700"}>
                {sign} {formatCurrency(r.amount)}
              </span>
            )}
            details={(r) => [
              { label: "عدد السطور", value: r.rows },
              { label: "الرصيد الحالي", value: formatCurrency(r.balanceBefore) },
              { label: "الرصيد بعد النقل", value: formatCurrency(r.balanceAfter) },
            ]}
          />
        </div>

        <div className="hidden sm:block overflow-hidden border border-gray-200 rounded-md">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-right p-2">الاسم</th>
                <th className="text-right p-2">سطور</th>
                <th className="text-right p-2">المبلغ</th>
                <th className="text-right p-2">الرصيد الحالي</th>
                <th className="text-right p-2">بعد النقل</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.partnerId}>
                  <td className="p-2">{r.name}</td>
                  <td className="p-2">{r.rows}</td>
                  <td className={`p-2 ${sign === "-" ? "text-red-600" : "text-green-700"}`}>
                    {sign} {formatCurrency(r.amount)}
                  </td>
                  <td className="p-2">{formatCurrency(r.balanceBefore)}</td>
                  <td className="p-2 font-semibold">{formatCurrency(r.balanceAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-4 mb-4">
      <label className="label">نقل أرصدة البضاعة القديمة للسواق</label>
      <p className="text-xs text-gray-500 mb-3">
        من يوم ما صار الرصيد يترصد عند السائق، الفواتير الجديدة بتتسجّل صح لحالها. الفواتير القديمة ضلّت
        مرصودة عند الباعة. هاد الزر بينقلها — مرة وحدة، وكل سطر بينكتب وين كان عشان يرجع بالضبط إذا لزم.
        <br />
        <strong>خُذ نسخة احتياطية قبل ما تنفّذ.</strong>
      </p>

      {loading && <p className="text-xs text-gray-400">جاري الحساب...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-brand-800">{message}</p>}

      {preview && !loading && (
        <>
          {preview.alreadyMigrated && preview.lastRunAt && (
            <p className="text-sm mb-2">
              انعمل النقل بتاريخ <strong>{formatDateTime(preview.lastRunAt)}</strong>.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
            <div className="bg-gray-50 rounded-md p-2">
              <div className="text-xs text-gray-500">المبلغ</div>
              <div className="font-semibold">{formatCurrency(preview.amountToMove)}</div>
            </div>
            <div className="bg-gray-50 rounded-md p-2">
              <div className="text-xs text-gray-500">سطور الحساب</div>
              <div className="font-semibold">{preview.rowsToMove}</div>
            </div>
            <div className="bg-gray-50 rounded-md p-2">
              <div className="text-xs text-gray-500">فواتير</div>
              <div className="font-semibold">{preview.invoicesAffected}</div>
            </div>
          </div>

          {preview.notes.length > 0 && (
            <ul className="mt-3 text-xs text-gray-600 list-disc pr-4 space-y-1">
              {preview.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}

          {/* Losing first. Whoever is about to see their balance drop is who this has to be read
              for, and putting the gainers on top buries them under good news. */}
          {partnerTable(preview.sellers, undoing ? "الباعة (بيرجعلهم)" : "الباعة (بينزل عنهم)", undoing ? "+" : "-")}
          {partnerTable(preview.drivers, undoing ? "السواق (بينزل عنهم)" : "السواق (بيترصد عليهم)", undoing ? "-" : "+")}

          {preview.blocker && <p className="mt-3 text-sm text-gray-600">{preview.blocker}</p>}

          {preview.canRun && (
            <div className="mt-4 border-t border-gray-200 pt-3">
              {/* Typing the word is not theatre. Everything else on this page is one record at a
                  time and undone by opening it again; this is every account at once, and the pause
                  it costs is cheaper than the afternoon spent working out what happened. */}
              <label className="label">
                اكتب «{phrase}» لتأكيد
              </label>
              <div className="flex gap-2">
                <input
                  className="input"
                  value={typed}
                  disabled={busy}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={phrase}
                />
                <button
                  className={undoing ? "btn-secondary shrink-0" : "btn-danger shrink-0"}
                  disabled={busy || typed.trim() !== phrase}
                  onClick={() => void act()}
                >
                  {busy ? "..." : undoing ? "تراجع عن النقل" : "نفّذ النقل"}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
