import { useEffect, useState } from "react";
import { pushStatus, pushTest, type PushStatusDto } from "../api/push";
import { apiErrorMessage } from "../api/client";
import { BLOCKER_MESSAGE, disablePush, enablePush, isPushSubscribed, pushBlocker } from "../lib/push";

/**
 * "الإشعارات" — the alerts banner, delivered to a device that is not currently looking at it.
 *
 * Per DEVICE, which is why this is a switch and not a setting: the person is turning notifications
 * on for the phone in their hand, and their tablet is a separate answer. And per USER, because the
 * server builds each notification from that user's own permissions — somebody who cannot open the
 * checks page is never told a check is overdue.
 *
 * The card is only ever as loud as it has to be. Where it cannot work it says why, and on an iPhone
 * in a Safari tab the "why" is a thing the person can go and fix, so it says that instead of
 * calling the phone unsupported.
 */
export function PushNotificationsCard() {
  const [status, setStatus] = useState<PushStatusDto | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const blocker = pushBlocker();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, sub] = await Promise.all([pushStatus(), isPushSubscribed()]);
        if (!alive) return;
        setStatus(s);
        setSubscribed(sub);
      } catch {
        // A status call that fails is not worth a red box on the settings page — the switch simply
        // does not appear, which is the same outcome as the feature being off.
        if (alive) setStatus({ enabled: false, publicKey: null, deviceCount: 0, receivesAny: false });
      }
    })();
    return () => { alive = false; };
  }, []);

  // Nothing to say until we know, and nothing to offer when the server has no keys.
  if (!status || !status.enabled) return null;

  async function toggle() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (subscribed) {
        await disablePush();
        setSubscribed(false);
        setNotice("انطفت الإشعارات على هذا الجهاز.");
      } else {
        await enablePush(status!.publicKey!);
        setSubscribed(true);
        setNotice("انفعّلت. بتوصلك التنبيهات الصبح، وبس الي مسموحلك تشوفه.");
      }
      setStatus(await pushStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : apiErrorMessage(err, "فشل تغيير الإشعارات"));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const sent = await pushTest();
      // Zero is the honest answer to "did it work", and the one worth surfacing: the switch is on,
      // the server tried, and no device took it.
      setNotice(sent > 0
        ? `انبعت على ${sent === 1 ? "جهاز واحد" : `${sent} أجهزة`} — إذا ما وصل، شيّك إعدادات الإشعارات بالجهاز.`
        : "ما في ولا جهاز مشترك حالياً — فعّل الإشعارات على هذا الجهاز أول.");
    } catch (err) {
      setError(apiErrorMessage(err, "فشل إرسال التجربة"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 mb-4">
      <h2 className="font-semibold mb-1">الإشعارات</h2>
      <p className="text-sm text-gray-500 mb-3">
        بتوصلك التنبيهات على جهازك الصبح حتى لو التطبيق مسكّر — شيكات، فواتير غير مسعّرة، مخالات
        عند الناس من زمان. <span className="font-medium">وبتوصلك بس الأشياء الي صلاحيتك بتوصلها</span>:
        إذا عندك صلاحية الدفعات والشيكات بس، ما بيوصلك إشي عن الفواتير.
      </p>

      {!status.receivesAny && (
        <div className="text-sm bg-gray-50 text-gray-600 rounded-md p-3 mb-3">
          صلاحياتك حاليًا ما بتوصل لأي تنبيه، فحتى لو فعّلتها ما رح يوصلك إشي. التنبيه بيوصل
          لمين بيقدر يصلّح الإشي — راجع صفحة «الأدوار والصلاحيات».
        </div>
      )}

      {blocker ? (
        <div className={`text-sm rounded-md p-3 ${blocker === "needs-install" ? "bg-amber-50 text-amber-800" : "bg-gray-50 text-gray-600"}`}>
          {BLOCKER_MESSAGE[blocker]}
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              className={subscribed ? "btn-secondary w-full sm:w-auto" : "btn-primary w-full sm:w-auto"}
              disabled={busy}
              onClick={toggle}
            >
              {busy ? "..." : subscribed ? "🔕 إطفاء الإشعارات على هذا الجهاز" : "🔔 فعّل الإشعارات على هذا الجهاز"}
            </button>
            {subscribed && (
              <button className="btn-secondary w-full sm:w-auto" disabled={busy} onClick={sendTest}>
                جرّب إشعار الآن
              </button>
            )}
          </div>

          {status.deviceCount > 0 && (
            <p className="text-xs text-gray-400 mt-3">
              عندك {status.deviceCount === 1 ? "جهاز واحد مشترك" : `${status.deviceCount} أجهزة مشتركة`}.
              كل جهاز بينفعّل لحاله.
            </p>
          )}
        </>
      )}

      {notice && <div className="text-sm text-brand-700 mt-2">{notice}</div>}
      {error && <div className="text-sm text-red-600 bg-red-50 rounded-md p-2 mt-2">{error}</div>}
    </div>
  );
}
