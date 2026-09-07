import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listAlerts } from "../api/alerts";
import { formatCurrency, todayLocalDateString } from "../lib/format";
import type { AlertDto, AlertKind } from "../types";

/**
 * The things that need attention right now, across the top of every page.
 *
 * Replaces the single-purpose "شيك تاريخ صرفه اليوم" banner. That one answered exactly one
 * question; everything else that quietly goes wrong — a check whose date passed last week, goods
 * that went out unpriced and were never priced — only surfaced if someone happened to open the
 * right page. What earns a row here (and what deliberately doesn't) is decided server-side; see
 * backend AlertService.
 *
 * Each row is a pointer, not a copy: a count, an amount, a few names, and a link to the page that
 * can actually do something about it. Dismissing hides the banner for the rest of THAT day only —
 * tomorrow's problems bring it back on their own.
 */

const DISMISS_KEY = "alertsBannerDismissedOn";

/** Wording and destination per kind. Kept here rather than server-side so every string the user
 * reads lives in one project — the backend returns the facts, this decides how to say them. */
const ALERT_TEXT: Record<AlertKind, {
  icon: string;
  link: string;
  linkLabel: string;
  title: (alert: AlertDto) => string;
}> = {
  OverdueChecks: {
    icon: "⚠️",
    link: "/checks",
    linkLabel: "عرض الشيكات",
    title: (a) => `${a.count === 1 ? "شيك واحد" : `${a.count} شيكات`} فات موعد استحقاقها ولسا ما انصرفت`,
  },
  ChecksDueToday: {
    icon: "🔔",
    link: "/checks",
    linkLabel: "عرض الشيكات",
    title: (a) => `${a.count === 1 ? "شيك" : `${a.count} شيكات`} تاريخ صرفها اليوم`,
  },
  UnpricedInvoices: {
    icon: "🏷️",
    link: "/invoices?hasUnpricedItems=true",
    linkLabel: "عرض الفواتير",
    title: (a) => `${a.count === 1 ? "فاتورة" : `${a.count} فواتير`} فيها أصناف لسا غير مسعّرة`,
  },
};

/** Critical reads as a problem, warning as a reminder — the two are visually distinct on purpose,
 * so a red row never becomes background noise next to an amber one. */
const SEVERITY_CLASS: Record<AlertDto["severity"], string> = {
  Critical: "bg-red-50 border-red-300 text-red-900",
  Warning: "bg-amber-50 border-amber-300 text-amber-900",
  Info: "bg-blue-50 border-blue-300 text-blue-900",
};

function readDismissedDate(): string | null {
  // A private window or blocked site data makes this throw rather than return null — the banner
  // simply shows in that case, which is the safe direction for a reminder.
  try {
    return window.localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

export function AlertsBanner() {
  const today = todayLocalDateString();
  const [alerts, setAlerts] = useState<AlertDto[]>([]);
  const [dismissedOn, setDismissedOn] = useState<string | null>(() => readDismissedDate());

  useEffect(() => {
    let cancelled = false;
    listAlerts()
      .then((result) => { if (!cancelled) setAlerts(result); })
      // A failure here must never break the page it sits on top of — no banner, no error.
      .catch(() => { if (!cancelled) setAlerts([]); });
    return () => { cancelled = true; };
  }, [today]);

  function dismiss() {
    setDismissedOn(today);
    try {
      window.localStorage.setItem(DISMISS_KEY, today);
    } catch {
      // Storage unavailable — hidden for this page view, back on the next one.
    }
  }

  if (alerts.length === 0 || dismissedOn === today) return null;

  return (
    <div className="border-b border-gray-200">
      {alerts.map((alert, index) => {
        const text = ALERT_TEXT[alert.kind];
        // A kind the backend knows about but this build doesn't — skip it rather than crash the
        // banner (and with it the page underneath) on an unfamiliar string.
        if (!text) return null;
        return (
          <div key={alert.kind} className={`px-4 sm:px-6 py-2 border-b last:border-b-0 ${SEVERITY_CLASS[alert.severity]}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="text-sm">
                <span className="font-semibold">{text.icon} {text.title(alert)}</span>
                {alert.amount > 0 && <span> — بمجموع <span className="font-semibold">{formatCurrency(alert.amount)}</span></span>}
                {alert.names.length > 0 && <span className="opacity-80"> ({alert.names.join("، ")})</span>}
                <Link to={text.link} className="underline font-semibold ms-2">{text.linkLabel}</Link>
              </div>
              {/* One dismiss for the whole banner, on the first row only — dismissing rows one at a
                  time would mean remembering which, and they all come back tomorrow anyway. */}
              {index === 0 && (
                <button
                  type="button" className="opacity-70 hover:opacity-100 text-sm shrink-0"
                  title="إخفاء التنبيهات لباقي اليوم" onClick={dismiss}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
