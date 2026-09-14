/*
 * The service worker exists for ONE reason: without one, a browser will not offer to install the
 * app. It is deliberately the smallest thing that earns that, and it is network-first.
 *
 * A cache-first service worker on a single-page app is how you end up shipping a deploy that
 * nobody receives: the old bundle keeps being served from the cache, the API it talks to has moved
 * on, and the only fix a user has is clearing browser data they do not know exists. This app
 * prints money figures; a stale copy of it is worse than no copy.
 *
 * So: every request goes to the network. The cache holds one thing, the app shell, and is read
 * only when the network fails — which turns "you are offline" from a browser error page into the
 * app's own screen saying so.
 *
 * The API is never cached, not even as a fallback. A balance served from yesterday's cache with
 * today's date on the screen is a wrong number presented as a right one.
 */
const SHELL_CACHE = "hesbah-shell-v1";
const SHELL_URL = "/index.html";

self.addEventListener("install", (event) => {
  // skipWaiting so a new deploy takes over on the next load instead of waiting for every tab to
  // close — the whole point of being network-first is not making people wait for the truth.
  self.skipWaiting();
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.add(SHELL_URL)).catch(() => undefined));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Anything the server computes is off limits. See the note at the top.
  if (url.pathname.startsWith("/api/")) return;

  // A navigation is the app being opened. Fetch it, keep a copy of the shell, and fall back to
  // that copy only when the network is gone.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(SHELL_URL, copy)).catch(() => undefined);
          return response;
        })
        .catch(() => caches.match(SHELL_URL).then((cached) => cached ?? Response.error())),
    );
  }
});

/*
 * Notifications.
 *
 * The one thing a service worker can do that a page cannot: run when the app is closed. Everything
 * above is about NOT being a cache; this is the part that earns the worker its keep.
 *
 * The payload is deliberately thin — a title, a line, a path — and it is built per user on the
 * server from that user's own permissions (see AlertPushSender). Nothing is decided here: a worker
 * that filtered its own notifications would be a second copy of the permission rules, living on a
 * phone, out of date the day a role changes.
 */
self.addEventListener("push", (event) => {
  // A push with no body is not a bug worth swallowing silently: iOS in particular will unsubscribe
  // an app that receives a push and shows nothing, so there is always a notification.
  let data = { title: "الحسبة", body: "في إشي بدو انتباه", url: "/", tag: "hesbah" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Not JSON. Show the default rather than nothing.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/favicon-192.png",
      badge: "/favicon-192.png",
      // Replaces an unopened notification instead of stacking a second one behind it.
      tag: data.tag,
      dir: "rtl",
      lang: "ar",
      data: { url: data.url || "/" },
    }),
  );
});

/*
 * Tapping it opens the page that can do something about it — and REUSES an already-open window
 * rather than launching a second copy of the app, which on a phone is how people end up with two
 * of it and no idea which one they typed the invoice into.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        return client.focus().then((focused) => (focused && focused.navigate ? focused.navigate(url) : focused));
      }
      return self.clients.openWindow(url);
    }),
  );
});
