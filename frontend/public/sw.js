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
