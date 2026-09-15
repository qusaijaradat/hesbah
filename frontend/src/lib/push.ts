import { isStandalone } from "./platform";
import { pushSubscribe, pushUnsubscribe } from "../api/push";

/**
 * Turning phone notifications on and off, from the browser's side.
 *
 * The part worth knowing before reading any of it: on an iPhone this works ONLY when the app has
 * been added to the home screen. Apple ships Web Push (since iOS 16.4) but offers no subscription
 * at all inside a Safari tab — `Notification` is not even defined there. So the screen has to be
 * able to tell "this device cannot" from "this device has not been installed yet", because those
 * are two completely different things to say to somebody, and only one of them has a fix.
 */

/** Why this device cannot subscribe — or null when it can. */
export type PushBlocker =
  | "unsupported"
  | "needs-install"
  | "denied";

export function pushBlocker(): PushBlocker | null {
  if (typeof window === "undefined") return "unsupported";

  const hasApi = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!hasApi) {
    // An iPhone in a Safari tab lands here. It is not that the phone cannot — it is that iOS only
    // offers this to an installed web app, which is a thing the person can actually go and do.
    return isIos() && !isStandalone() ? "needs-install" : "unsupported";
  }
  // iOS has the APIs in a tab in some versions and still refuses; installing is the answer there
  // too, so it is checked ahead of the permission state.
  if (isIos() && !isStandalone()) return "needs-install";
  if (Notification.permission === "denied") return "denied";
  return null;
}

/**
 * Asks, subscribes, and registers the subscription against the signed-in user.
 *
 * The permission prompt has to come from inside a real click — every browser refuses it otherwise,
 * and Safari refuses it silently — so this is only ever called from a button's own handler, never
 * from an effect.
 */
export async function enablePush(publicKey: string): Promise<void> {
  const blocker = pushBlocker();
  if (blocker) throw new Error(BLOCKER_MESSAGE[blocker]);

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("ما انعطى الإذن للإشعارات على هالجهاز.");

  const registration = await navigator.serviceWorker.ready;

  // An existing subscription made against a DIFFERENT VAPID key can never be decrypted by this
  // server, and the browser will not silently re-key it — it has to go first. This is the failure
  // that otherwise looks like "notifications are on and nothing ever arrives".
  const existing = await registration.pushManager.getSubscription();
  if (existing) await existing.unsubscribe().catch(() => undefined);

  const subscription = await registration.pushManager.subscribe({
    // Required by every browser, and by Apple in particular: a push that shows no notification is
    // grounds for iOS to drop the subscription.
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("المتصفح ما أعطى بيانات اشتراك كاملة.");
  }

  await pushSubscribe({
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    userAgent: navigator.userAgent,
  });
}

/**
 * Both halves, in that order: tell the server to stop, then tell the browser to stop. The server
 * first, because a browser that has unsubscribed no longer knows the endpoint — do it the other
 * way round and the row stays behind, and every morning the server pushes to a device that is not
 * listening until the push service finally says it is gone.
 */
export async function disablePush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  await pushUnsubscribe(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
}

/** Is this device currently subscribed in the browser? Asked on load to set the switch. */
export async function isPushSubscribed(): Promise<boolean> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    return (await registration.pushManager.getSubscription()) !== null;
  } catch {
    return false;
  }
}

export const BLOCKER_MESSAGE: Record<PushBlocker, string> = {
  unsupported: "هذا المتصفح ما بيدعم الإشعارات.",
  "needs-install":
    "على الآيفون الإشعارات بتشتغل بس إذا التطبيق منزّل على الشاشة الرئيسية: افتح المشاركة ⬆️ ثم «إضافة إلى الشاشة الرئيسية»، وافتحه من هناك.",
  denied:
    "الإشعارات مرفوضة لهذا الموقع من إعدادات الجهاز. لازم تسمح فيها من إعدادات المتصفح/التطبيق وبعدها جرّب مرة تانية.",
};

function isIos(): boolean {
  // iPadOS reports itself as a Mac, hence the touch-points half.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * The VAPID public key travels as base64url; `pushManager.subscribe` wants the raw bytes.
 * Standard conversion, and the one place a typo produces a subscription that looks fine and can
 * never be decrypted.
 */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  // Built on an explicit ArrayBuffer: subscribe() wants a real one, and the default Uint8Array is
  // typed over ArrayBufferLike, which includes SharedArrayBuffer and so does not satisfy it.
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}
