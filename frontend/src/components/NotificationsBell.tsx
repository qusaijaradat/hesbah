import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listAlerts } from "../api/alerts";
import { formatCurrency } from "../lib/format";
import { ALERT_TEXT, SEVERITY_DOT, alertsSignature } from "../lib/alertText";
import type { AlertDto } from "../types";

/**
 * The bell in the app bar — what needs attention, inside the app, one tap from the page that
 * fixes it.
 *
 * It replaces the banner that used to sit across the top of every page. That banner said the same
 * things, louder, and was dismissed once a day by everybody precisely because it was loud: a
 * reminder that has to be pushed out of the way to read the screen underneath gets pushed out of
 * the way without being read. A count on a bell is quieter and survives the day.
 *
 * "Already seen" is a fingerprint of the facts, not a list of ids — see alertsSignature. The badge
 * goes quiet once somebody has looked and comes back when what is wrong CHANGES, which is the
 * only moment it is worth being loud again.
 *
 * The list is exactly what the server returned: each row is already filtered to what this person
 * may be told and can act on (AlertVisibility). Nothing is decided here.
 */

const SEEN_KEY = "alertsSeenSignature";
const REFRESH_MS = 5 * 60 * 1000;

export function NotificationsBell() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<AlertDto[]>([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string>(() => read(SEEN_KEY) ?? "");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => listAlerts()
      .then((result) => { if (!cancelled) setAlerts(result); })
      // A failure here must never break the page the bar sits on top of: no alerts, no error.
      .catch(() => { if (!cancelled) setAlerts([]); });

    load();

    // The books move while somebody has the app open all day — a check falls overdue at midnight,
    // an invoice gets priced — so this polls. But only while somebody is LOOKING at it.
    //
    // A market phone lives in a pocket with this app open behind whatever else is on screen. A
    // timer that keeps firing there is a request every five minutes, all day, to refresh a bell
    // nobody can see — paid for in battery on the phone and in queries on the server, by every
    // staff member at once. Hidden tabs stop; coming back re-reads immediately, which is also when
    // the answer matters most, because it is the moment somebody is about to look at it.
    let timer = 0;
    function start() {
      if (timer) return;
      timer = window.setInterval(load, REFRESH_MS);
    }
    function stop() {
      if (!timer) return;
      window.clearInterval(timer);
      timer = 0;
    }
    function onVisibility() {
      if (document.hidden) { stop(); return; }
      load();
      start();
    }

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Clicking anywhere else closes it, the way every menu like this behaves.
  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onEsc(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const signature = alertsSignature(alerts);
  const unseen = alerts.length > 0 && signature !== seen;

  function toggle() {
    const next = !open;
    setOpen(next);
    // Opening it IS reading it.
    if (next && signature) {
      setSeen(signature);
      write(SEEN_KEY, signature);
    }
  }

  function go(link: string) {
    setOpen(false);
    navigate(link);
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        aria-label={alerts.length > 0 ? `${alerts.length} تنبيه` : "التنبيهات"}
        aria-expanded={open}
        className="relative rounded-md p-1.5 hover:bg-brand-800"
        onClick={toggle}
      >
        <span className="text-xl leading-none">🔔</span>
        {unseen && (
          <span className="absolute -top-0.5 -end-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-red-600 text-white text-[0.7rem] font-bold flex items-center justify-center">
            {alerts.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute top-full mt-2 end-0 z-50 w-[min(22rem,calc(100vw-2rem))] bg-white text-gray-900 rounded-lg shadow-xl border border-gray-200 overflow-hidden"
        >
          <div className="px-4 py-2 border-b border-gray-100 font-semibold text-sm">التنبيهات</div>

          {alerts.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-400">ما في إشي بدو انتباه 👌</div>
          ) : (
            <ul className="max-h-[70vh] overflow-y-auto">
              {alerts.map((alert) => {
                const text = ALERT_TEXT[alert.kind];
                // A kind this build does not know about — skip the row rather than crash the menu
                // (and with it the bar) on an unfamiliar string.
                if (!text) return null;
                return (
                  <li key={alert.kind} className="border-b border-gray-100 last:border-b-0">
                    <button
                      type="button"
                      className="w-full text-start px-4 py-3 hover:bg-gray-50 flex gap-3"
                      onClick={() => go(text.link)}
                    >
                      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${SEVERITY_DOT[alert.severity]}`} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium">{text.icon} {text.title(alert)}</span>
                        {alert.amount > 0 && (
                          <span className="block text-xs text-gray-500 mt-0.5">
                            بمجموع {formatCurrency(alert.amount)}
                          </span>
                        )}
                        {alert.names.length > 0 && (
                          <span className="block text-xs text-gray-400 mt-0.5 truncate">{alert.names.join("، ")}</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// A private window, or site data blocked, makes these throw rather than return null. The badge
// simply shows every time in that case, which is the safe direction for a reminder.
function read(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* shown again next time */ }
}
