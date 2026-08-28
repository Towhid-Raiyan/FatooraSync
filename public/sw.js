const SHELL_CACHE = "fatoorasync-shell-v1";
const OFFLINE_ROUTES = ["/receipts/new", "/quotations/new"];

// Actively warm the shell cache the moment this worker installs, rather than
// waiting for the cashier to happen to load one of these routes online first.
// Without this, a fresh install's very first offline launch (start_url is
// /receipts/new) has nothing cached yet and falls through to the browser's
// own offline interstitial -- the app never even gets a chance to render.
// This fetch runs with the installing page's cookies (same-origin, default
// credentials), so it only actually caches real content when the install
// happens while signed in; an unauthenticated install-time fetch resolves to
// the redirected /login page, which the same ok/redirected/basic guard below
// already refuses to cache -- the runtime fetch handler picks it up normally
// on this device's first real online visit instead.
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    Promise.all(
      OFFLINE_ROUTES.map((route) =>
        fetch(route, { cache: "no-store" })
          .then((response) => {
            if (response.ok && !response.redirected && response.type === "basic") {
              return caches.open(SHELL_CACHE).then((cache) => cache.put(route, response));
            }
          })
          .catch(() => {})
      )
    )
  );
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
  // Any GET of these exact pathnames, not just `mode: "navigate"` ones. A
  // cashier already inside the app who clicks "New Receipt" in the sidebar
  // triggers an App Router client-side navigation, which issues a same-origin
  // RSC data fetch rather than a document navigation -- that request would
  // otherwise sail past this handler and fail offline, even though a direct
  // reload of the very same URL works. Nothing else legitimately GETs exactly
  // /receipts/new or /quotations/new, so matching on pathname alone is safe.
  //
  // Note the RSC fetch carries a `?_rsc=<hash>` query param, so it caches (and
  // matches) under a DIFFERENT key than the HTML document for the same route --
  // the flight payload can never overwrite the document, and a warmed-up
  // sidebar navigation is served from its own entry. Do NOT "fix" the miss case
  // below with `{ ignoreSearch: true }`: that would hand the HTML document to a
  // router expecting `text/x-component`. A clean `Response.error()` is the right
  // answer on a miss -- the App Router responds to a failed RSC fetch by falling
  // back to a full document navigation, which this same handler then serves from
  // the cached shell.
  const isOfflineRoute = event.request.method === "GET" && OFFLINE_ROUTES.includes(url.pathname);
  const isStaticAsset = url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");

  if (!isOfflineRoute && !isStaticAsset) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only a genuinely good response may overwrite the last-known-good
        // copy. Without this guard a single 500, a 502 gateway page, or a 307
        // redirect to /login from an expired session would be cached over the
        // working offline shell -- poisoning offline boot until the next
        // successful ONLINE load, which is precisely what you can't get when
        // you need the cache. `type === "basic"` keeps out opaque cross-origin
        // responses, which can't be inspected and so can't be trusted.
        if (response.ok && !response.redirected && response.type === "basic") {
          const clone = response.clone();
          // waitUntil, so the service worker can't be terminated mid-write and
          // leave a half-written entry (or no entry at all).
          event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, clone)));
        }
        return response;
      })
      // Network genuinely failed. Serve the cached copy if there is one; on a
      // real cache miss `caches.match` resolves to `undefined`, and
      // respondWith(undefined) surfaces as an opaque network error, so return
      // an explicit Response.error() instead.
      .catch(() => caches.match(event.request).then((cached) => cached || Response.error()))
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
