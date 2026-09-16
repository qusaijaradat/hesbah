import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { partnerBalances } from "../api/payments";
import { useAuth } from "../auth/AuthContext";
import { formatCurrency } from "../lib/format";
import type { PartnerBalancesDto } from "../types";

/**
 * "This person has another account, and here is what is on it."
 *
 * A seller who also buys had two balances in this app that never referred to each other. You could
 * stand on his seller statement, see that the market owes him five thousand, pay it — and never
 * learn that he owed two thousand on the other page. The market counted cash out and counted cash
 * back in, on the same day, in opposite directions, because neither screen mentioned the other.
 *
 * So each account page says it, on the page, with the number. That is the whole feature: knowing.
 * The مقاصّة form on الدفعات is what acts on it, and this links there.
 *
 * Shows nothing at all when the other side is empty — which is most people, and the reason this
 * can sit on every account page without becoming furniture.
 */
export function OtherSideNotice({ partnerId, side }: {
  partnerId: number;
  /** Which account page this is sitting on. The notice is about the OTHER one. */
  side: "merchant" | "seller";
}) {
  const { hasPermission } = useAuth();
  const [balances, setBalances] = useState<PartnerBalancesDto | null>(null);

  useEffect(() => {
    // The balances endpoint is gated on payments.view. Somebody without it sees this page and no
    // notice, which is correct: they may not be told about money on a page they cannot open.
    if (!hasPermission("payments.view")) return;
    let cancelled = false;
    partnerBalances(partnerId)
      .then((b) => { if (!cancelled) setBalances(b); })
      // A failure here must never break the statement underneath it.
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [partnerId, hasPermission]);

  if (!balances) return null;

  // Nothing worth saying unless the OTHER side actually has something on it.
  const other = side === "merchant" ? balances.marketOwesSeller : balances.buyerOwes;
  if (other <= 0) return null;

  const canOffset = balances.maxOffset > 0 && hasPermission("payments.create");

  return (
    <div className="text-sm bg-brand-50 text-brand-900 border border-brand-200 rounded-md p-3 mb-4">
      {side === "merchant" ? (
        <>هذا الشخص كمان <span className="font-semibold">بائع</span> عندك، وإله <span className="font-semibold">{formatCurrency(balances.marketOwesSeller)}</span>.</>
      ) : (
        <>هذا الشخص كمان <span className="font-semibold">مشتري</span> عندك، وعليه <span className="font-semibold">{formatCurrency(balances.buyerOwes)}</span>.</>
      )}
      {canOffset ? (
        <>
          {" "}بتقدر تقاصّ <span className="font-semibold">{formatCurrency(balances.maxOffset)}</span> بدل ما تعطيه كاش وتستلم منه كاش.{" "}
          <Link to="/payments" className="underline font-semibold">افتح المقاصّة</Link>
        </>
      ) : (
        // The other side has a balance but the two cannot be netted — one of them is a credit, so
        // there is nothing to settle against. Said plainly rather than offering a button that
        // would refuse.
        <> ما في إشي للمقاصّة حالياً — لازم يكون عليه مبلغ كمشتري وإله مبلغ كبائع بنفس الوقت.</>
      )}
    </div>
  );
}
