import { useEffect, useState } from "react";
import { createOffset, partnerBalances } from "../api/payments";
import { apiErrorMessage } from "../api/client";
import { PartnerAutocomplete } from "./PartnerAutocomplete";
import { formatCurrency, todayLocalDateString } from "../lib/format";
import type { PartnerBalancesDto } from "../types";

/**
 * "مقاصّة" — settling what somebody owes the market as a BUYER against what the market owes them
 * as a SELLER.
 *
 * The same man brings produce in the morning and buys a crate of something else in the afternoon.
 * Until now that was two accounts that never met: the market counted cash out to him for his
 * produce and counted cash back in for his purchases, on the same day, in opposite directions.
 *
 * It writes two ordinary payments, one on each side, sharing an id. Nothing about how either
 * balance is computed changes — which is the whole reason it is safe. Both halves appear in
 * الدفعات with "مقاصّة" as the method, so anybody reconciling the day's cash can see that these
 * two rows moved none of it.
 *
 * The maximum is decided by the server (Domain.Services.OffsetRules) and shown here. It is the
 * smaller of the two balances: settling more than the market owes him would be recording a payment
 * it never made, and leaving him owing the market as a seller for no reason anybody could explain.
 */
export function OffsetDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [partner, setPartner] = useState<{ id: number; name: string } | null>(null);
  const [balances, setBalances] = useState<PartnerBalancesDto | null>(null);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => todayLocalDateString());
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!partner) { setBalances(null); setAmount(""); return; }
    let cancelled = false;
    partnerBalances(partner.id)
      .then((b) => {
        if (cancelled) return;
        setBalances(b);
        // Pre-filled with the whole settleable amount, which is what somebody reaching for this
        // almost always wants. It stays editable for the day it is a part payment.
        setAmount(b.maxOffset > 0 ? String(b.maxOffset) : "");
        setError(null);
      })
      .catch((err) => { if (!cancelled) setError(apiErrorMessage(err, "فشل قراءة الأرصدة")); });
    return () => { cancelled = true; };
  }, [partner]);

  const value = parseFloat(amount) || 0;
  const max = balances?.maxOffset ?? 0;
  const canSave = !!partner && value > 0 && value <= max && !busy;

  async function save() {
    if (!partner) return;
    setBusy(true);
    setError(null);
    try {
      await createOffset({
        partnerId: partner.id,
        amount: value,
        date: new Date(date).toISOString(),
        notes: notes.trim() || undefined,
      });
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err, "فشلت المقاصّة"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card sm:max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-1">مقاصّة</h2>
        <p className="text-sm text-gray-500 mb-4">
          لما يكون الشخص بائع ومشتري بنفس الوقت: بتخصم الي عليه كمشتري من الي إله كبائع، بدل ما
          تعطيه كاش وتستلم منه كاش بنفس اليوم. <span className="font-medium">ما بينتقل أي مبلغ فعلي</span> —
          بس بينكتب بالدفعات على الطرفين.
        </p>

        <div className="mb-3">
          <PartnerAutocomplete
            label="الشخص" value={partner} onChange={setPartner}
            placeholder="اكتب الاسم واختره من القائمة..."
          />
        </div>

        {balances && (
          <div className="rounded-md bg-gray-50 border border-gray-200 p-3 mb-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-500">عليه كمشتري</span>
              <span className="font-semibold">{formatCurrency(balances.buyerOwes)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">إله كبائع</span>
              <span className="font-semibold">{formatCurrency(balances.marketOwesSeller)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-200 pt-1">
              <span className="text-gray-700 font-medium">أكبر مبلغ ممكن تقاصّه</span>
              <span className={max > 0 ? "font-bold text-brand-700" : "font-bold text-gray-400"}>
                {formatCurrency(max)}
              </span>
            </div>
            {max <= 0 && (
              <p className="text-xs text-gray-500 pt-1">
                ما في إشي للمقاصّة — لازم يكون عليه مبلغ كمشتري وإله مبلغ كبائع بنفس الوقت.
              </p>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 mb-3">
          <div>
            <label className="label">المبلغ</label>
            <input
              className="input" type="number" min="0" step="0.01" value={amount}
              disabled={max <= 0}
              onChange={(e) => setAmount(e.target.value)}
            />
            {value > max && max > 0 && (
              <p className="text-xs text-red-600 mt-1">أكبر من المسموح ({formatCurrency(max)}).</p>
            )}
          </div>
          <div>
            <label className="label">التاريخ</label>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        <div className="mb-4">
          <label className="label">ملاحظات (اختياري)</label>
          <input className="input" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)}
            placeholder="مقاصّة بين حسابه كمشتري وحسابه كبائع" />
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2 mb-3">{error}</div>}

        <div className="flex flex-col sm:flex-row gap-3">
          <button className="btn-primary w-full sm:w-auto" disabled={!canSave} onClick={save}>
            {busy ? "جاري الحفظ..." : "نفّذ المقاصّة"}
          </button>
          <button className="btn-secondary w-full sm:w-auto" disabled={busy} onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}
