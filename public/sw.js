const SHELL_CACHE = "fatoorasync-shell-v1";
const OFFLINE_ROUTES = ["/receipts/new", "/quotations/new"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Network-first, falling back to the last successfully cached response, for
// the two navigable routes this feature makes offline-capable. Every other
// route is intentionally left untouched -- it simply won't load offline,
// per the scope boundary in the design spec.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isOfflineRoute = event.request.mode === "navigate" && OFFLINE_ROUTES.includes(url.pathname);
  const isStaticAsset = url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");

  if (!isOfflineRoute && !isStaticAsset) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
