import { useEffect, useState } from "react";
import { createSettlement, partnerBalances } from "../api/payments";
import { apiErrorMessage } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatCurrency, todayLocalDateString } from "../lib/format";
import type { PartnerBalancesDto } from "../types";

/**
 * "تسوية" — an amount written straight onto somebody's account.
 *
 * This replaced a "مقاصّة" screen that made you pick the person, showed both his balances,
 * computed the most that could be netted between them and refused anything larger. It was correct
 * and nobody used it: settling a balance in a market is a sentence — "خلص، صافينا" — and the screen
 * made it a procedure. So: one amount, one reason, one button, on the account page you are already
 * looking at.
 *
 * The one thing it does say out loud is WHERE the amount lands, before you press save. For most
 * people that is one account; for the man who sells in the morning and buys in the afternoon it is
 * both, and the line below says so rather than letting him find out from a balance later.
 *
 * No ceiling, by request. Overshooting shows up as a credit and is deleted like any other payment.
 */
export function SettlementCard({ partnerId, onChanged }: { partnerId: number; onChanged: () => void }) {
  const { hasPermission } = useAuth();
  const [balances, setBalances] = useState<PartnerBalancesDto | null>(null);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(() => todayLocalDateString());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const canWrite = hasPermission("payments.create");
  const canRead = hasPermission("payments.view");

  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    partnerBalances(partnerId)
      .then((b) => { if (!cancelled) setBalances(b); })
      // Never break the statement underneath this card over a balance line.
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [partnerId, canRead, done]);

  if (!canWrite) return null;

  const value = parseFloat(amount) || 0;
  // Read off the balances rather than guessed: a person with something on both sides gets both,
  // which is the whole of what the old مقاصّة did.
  const hasBuyerSide = balances != null && balances.buyerOwes !== 0;
  const hasSellerSide = balances != null && balances.marketOwesSeller !== 0;
  const bothSides = hasBuyerSide && hasSellerSide;

  async function handleSave() {
    setError(null);
    setDone(null);
    if (value <= 0) { setError("أدخل مبلغ أكبر من صفر."); return; }
    setBusy(true);
    try {
      const rows = await createSettlement({
        partnerId,
        amount: value,
        date: new Date(date).toISOString(),
        notes: notes.trim() || undefined,
      });
      setAmount("");
      setNotes("");
      setDone(
        rows.length > 1
          ? `تم — ${formatCurrency(value)} نزلت من حسابه كبائع ومن حسابه كمشتري.`
          : `تم — ${formatCurrency(value)} نزلت من الحساب.`,
      );
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, "فشل حفظ التسوية"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 mb-4">
      <div className="font-semibold text-gray-700">تسوية على الحساب</div>
      <p className="text-xs text-gray-500 mt-1">
        مبلغ بتحطه مباشرة على الحساب — مصاري انصفّت برّا النظام، أو رصيد بدك تسكّره. بتطلع كسطر
        مستقل بكشف الحساب المطبوع مع السبب اللي بتكتبه. ما بتأثر على العمولة ولا على أي فاتورة.
      </p>

      {/* Said before the button, not after the fact. */}
      {bothSides && (
        <p className="text-xs bg-amber-50 text-amber-900 border border-amber-200 rounded-md p-2 mt-2">
          هذا الشخص <span className="font-semibold">بائع ومشتري</span> — عليه{" "}
          <span className="font-semibold">{formatCurrency(balances!.buyerOwes)}</span> كمشتري وإله{" "}
          <span className="font-semibold">{formatCurrency(balances!.marketOwesSeller)}</span> كبائع.
          المبلغ اللي بتكتبه رح ينزل من <span className="font-semibold">الطرفين</span>.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">المبلغ (₪)</label>
          <input
            className="input"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div>
          <label className="label">التاريخ</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="flex-1 min-w-0">
          <label className="label">السبب (اختياري — بيطلع بالكشف)</label>
          <input
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="مثلاً: تصفية حساب نقدًا"
          />
        </div>
        <button className="btn-primary shrink-0" disabled={busy || value <= 0} onClick={() => void handleSave()}>
          {busy ? "..." : "💾 حفظ التسوية"}
        </button>
      </div>

      {error && <div className="text-sm text-red-600 mt-2">{error}</div>}
      {done && <div className="text-sm text-brand-800 mt-2">{done}</div>}
    </div>
  );
}
