import { useEffect, useState } from "react";
import { pushStatus } from "../api/push";
import { BLOCKER_MESSAGE, enablePush, isPushSubscribed, pushBlocker } from "../lib/push";

/**
 * The app asking, once, for permission to notify — across the top of the page rather than buried
 * in الإعدادات where nobody would find it.
 *
 * It has to be a button somebody presses. Every browser refuses Notification.requestPermission()
 * outside a real click, and Safari refuses it SILENTLY — so an app that tries to ask on load gets
 * no prompt, no error, and a person who concludes notifications do not work here. The click is the
 * permission to ask for permission.
 *
 * What it will not do:
 *   • ask somebody whose role receives no alerts at all (status.receivesAny) — they would agree,
 *     nothing would ever arrive, and the next thing this app asks for would get the same answer;
 *   • ask again for two weeks after "مش هلأ", and never again once the device is subscribed;
 *   • call a phone unsupported when the truth is "install it first", which on an iPhone is the
 *     whole story and is something the person can actually go and do.
 */

const SNOOZE_KEY = "pushPromptSnoozedUntil";
const SNOOZE_DAYS = 14;

export function PushPrompt() {
  const [show, setShow] = useState(false);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (snoozed()) return;

      const blocker = pushBlocker();
      // "unsupported" and "denied" are both dead ends from here: there is no button that fixes
      // either, and a banner offering one would be a banner that lies.
      if (blocker === "unsupported" || blocker === "denied") return;

      try {
        const [status, subscribed] = await Promise.all([pushStatus(), isPushSubscribed()]);
        if (!alive) return;
        if (!status.enabled || subscribed || !status.receivesAny) return;
        setPublicKey(status.publicKey);
        setNeedsInstall(blocker === "needs-install");
        setShow(true);
      } catch {
        // A status call that fails is not a reason to put anything on screen.
      }
    })();
    return () => { alive = false; };
  }, []);

  if (!show) return null;

  function snooze() {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000));
    setShow(false);
  }

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      await enablePush(publicKey!);
      setDone(true);
      // Left on screen for a moment so the answer to "did that work" is on the same banner that
      // asked, then gone for good — this device is subscribed and will never be asked again.
      setTimeout(() => setShow(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "فشل تفعيل الإشعارات.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="bg-brand-50 border-b border-brand-200 text-brand-800 px-4 py-3 text-sm">
        ✅ انفعّلت الإشعارات على هذا الجهاز.
      </div>
    );
  }

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0 text-sm text-amber-900">
          <span className="font-semibold">🔔 بتحب يوصلك تنبيه على جهازك؟</span>{" "}
          {needsInstall
            ? BLOCKER_MESSAGE["needs-install"]
            : "الشيكات والفواتير غير المسعّرة والمخالات — بيوصلك الصبح حتى لو التطبيق مسكّر، وبس الأشياء الي صلاحيتك بتوصلها."}
        </div>

        <div className="flex gap-2 shrink-0">
          {/* The button IS the gesture the browser requires — see the note at the top. On a phone
              that has to be installed first there is nothing to press yet, so only "مش هلأ" shows. */}
          {!needsInstall && (
            <button className="btn-primary" disabled={busy} onClick={enable}>
              {busy ? "..." : "فعّل"}
            </button>
          )}
          <button className="btn-secondary" disabled={busy} onClick={snooze}>
            مش هلأ
          </button>
        </div>
      </div>
      {error && <div className="text-sm text-red-700 mt-2">{error}</div>}
    </div>
  );
}

function snoozed(): boolean {
  const until = Number(localStorage.getItem(SNOOZE_KEY) ?? 0);
  return Number.isFinite(until) && Date.now() < until;
}
