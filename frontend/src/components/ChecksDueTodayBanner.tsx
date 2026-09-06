import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listChecks } from "../api/payments";
import { formatCurrency, todayLocalDateString } from "../lib/format";
import type { PaymentDto } from "../types";

/**
 * "في شيك تاريخ صرفه اليوم" — a banner across the top of every page listing the checks that come
 * due TODAY and are still قيد التحصيل, so a check due this morning can't quietly pass unnoticed
 * because nobody happened to open the الشيكات page that day.
 *
 * Lives in Layout, above the page content, rather than on any one screen — the whole point is
 * that it finds you wherever you are. Only checks still Pending count: one already marked تم
 * الصرف or مرتجع is settled business and needs no reminder.
 *
 * Dismissing hides it for the rest of THAT day only (stored per-date in localStorage) — the next
 * day's checks bring it back on their own. Deliberately per-day rather than per-session, so it
 * doesn't reappear on every navigation once it's been dealt with.
 */

const DISMISS_KEY = "checksDueBannerDismissedOn";

function readDismissedDate(): string | null {
  // Private windows / blocked site data make this throw rather than return null — the banner
  // simply shows in that case, which is the safe direction for a reminder.
  try {
    return window.localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

export function ChecksDueTodayBanner() {
  const today = todayLocalDateString();
  const [checks, setChecks] = useState<PaymentDto[]>([]);
  const [dismissedOn, setDismissedOn] = useState<string | null>(() => readDismissedDate());

  useEffect(() => {
    let cancelled = false;
    // Asks the backend for exactly today's Pending checks — no client-side filtering of a bigger
    // list, so this stays one small request on every page load.
    //
    // The bounds are pinned to UTC ("Z") ON PURPOSE. A check's due date is written as
    // `new Date("YYYY-MM-DD").toISOString()` everywhere it's recorded, and JS parses a date-ONLY
    // string as UTC — so every CheckDueDate in the database sits at exactly T00:00:00Z of its due
    // day. Sending an offset-less bound instead would let the API server's own timezone decide
    // how to read it, and on a server west of UTC the window would slide right past the very
    // instant it's meant to match, showing no banner on the one day it's for.
    listChecks({ status: "Pending", dueFrom: `${today}T00:00:00Z`, dueTo: `${today}T23:59:59Z`, pageSize: 200 })
      .then((result) => { if (!cancelled) setChecks(result.items); })
      // A failure here must never break the page it's sitting on top of — no banner, no error.
      .catch(() => { if (!cancelled) setChecks([]); });
    return () => { cancelled = true; };
  }, [today]);

  function dismiss() {
    setDismissedOn(today);
    try {
      window.localStorage.setItem(DISMISS_KEY, today);
    } catch {
      // Storage unavailable — it stays hidden for this page view and comes back on the next one.
    }
  }

  if (checks.length === 0 || dismissedOn === today) return null;

  const total = checks.reduce((sum, check) => sum + check.amount, 0);
  const names = Array.from(new Set(checks.map((check) => check.partnerName))).join("، ");

  return (
    <div className="bg-amber-50 border-b border-amber-300 text-amber-900 px-4 sm:px-6 py-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="text-sm">
          <span className="font-semibold">
            🔔 في {checks.length === 1 ? "شيك" : `${checks.length} شيكات`} تاريخ صرفها اليوم
          </span>
          <span> — بمجموع <span className="font-semibold">{formatCurrency(total)}</span></span>
          {names && <span className="text-amber-800"> ({names})</span>}
          {/* The list itself lives on the الشيكات page — this is a pointer, not a second copy of
              that table, so there's only ever one place to actually act on a check. */}
          <Link to="/checks" className="underline font-semibold ms-2">عرض الشيكات</Link>
        </div>
        <button
          type="button" className="text-amber-700 hover:text-amber-900 text-sm shrink-0"
          title="إخفاء التنبيه لباقي اليوم" onClick={dismiss}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
