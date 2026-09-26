/*
 * Keeps the app shell available with no signal, so a driver who loses coverage
 * mid-job can still open the app and see the last-known job list (cached by the
 * app itself in localStorage).
 *
 * - Page navigations: network first (so a new deploy is picked up), falling
 *   back to the cached shell.
 * - Same-origin static files: cache first (Vite fingerprints asset names).
 * - Anything cross-origin (the Supabase RPCs) is never touched: job data and
 *   actions must always hit the server, never a stale cache.
 */
const CACHE = "nokael-driver-v1";
// The app lives under a sub-path (coc.nokael.com/driver-app/); everything is relative to it.
const BASE = new URL(self.registration.scope).pathname;
const INDEX = BASE + "index.html";
const SHELL = ["", "index.html", "manifest.webmanifest", "icons/icon-192.png"].map((path) => BASE + path);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Leave the rest of coc.nokael.com (the confirmation portal) alone.
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(INDEX, copy));
          return response;
        })
        .catch(() => caches.match(INDEX)),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
