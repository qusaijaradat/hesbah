import type { AlertDto, AlertKind } from "../types";

/**
 * How each alert is worded and where it goes when tapped.
 *
 * Shared by everything that shows an alert on screen — today the bell in the app bar, tomorrow
 * whatever else — because the same alert must not be called two different things in two places.
 * The backend returns the facts (kind, count, amount, a few names) and this decides how to say
 * them, which is the same split the morning notification uses.
 */
export const ALERT_TEXT: Record<AlertKind, {
  icon: string;
  link: string;
  title: (alert: AlertDto) => string;
}> = {
  OverdueChecks: {
    icon: "⚠️",
    link: "/checks",
    title: (a) => `${a.count === 1 ? "شيك واحد" : `${a.count} شيكات`} فات موعد استحقاقها ولسا ما انصرفت`,
  },
  ChecksDueToday: {
    icon: "🔔",
    link: "/checks",
    title: (a) => `${a.count === 1 ? "شيك" : `${a.count} شيكات`} تاريخ صرفها اليوم`,
  },
  UnpricedInvoices: {
    icon: "🏷️",
    link: "/invoices?hasUnpricedItems=true",
    title: (a) => `${a.count === 1 ? "فاتورة" : `${a.count} فواتير`} فيها أصناف لسا غير مسعّرة`,
  },
  StaleSacks: {
    icon: "🧺",
    link: "/sacks",
    // The count is people, the amount is sacks — saying only one of them would send somebody to
    // the screen just to find out which.
    title: (a) => `${a.count === 1 ? "شخص" : `${a.count} أشخاص`} ماسكين ${a.amount} مخال من أكثر من شهر`,
  },
};

/** Critical reads as a problem, warning as a reminder — distinct on purpose, so a red row never
 * becomes background noise sitting next to an amber one. */
export const SEVERITY_DOT: Record<AlertDto["severity"], string> = {
  Critical: "bg-red-500",
  Warning: "bg-amber-500",
  Info: "bg-blue-500",
};

/**
 * A fingerprint of what is currently wrong — kinds and their counts, in order.
 *
 * This is what "already seen" means here. There are no notification ids to mark read: the alerts
 * are recomputed from the books on every request, so the same overdue check is the same row today
 * and tomorrow. Storing the fingerprint means the badge goes quiet once somebody has looked, and
 * comes back the moment the FACTS change — a fourth unpriced invoice, a check falling overdue —
 * rather than every time the page is opened.
 */
export function alertsSignature(alerts: AlertDto[]): string {
  return alerts.map((a) => `${a.kind}:${a.count}`).join("|");
}
