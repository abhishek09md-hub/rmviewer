const CACHE_VERSION = 'v15';
const CACHE_NAME = 'readme-viewer-' + CACHE_VERSION;

const PRECACHE_URLS = [
  './',
  './index.html',
  './about/',
  './about/index.html',
  './style.css',
  './app.js',
  './lib/marked.min.js',
  './lib/mermaid.min.js',
  './manifest.webmanifest',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigation requests: try the exact URL (covers known routes like /
  // and /about/), then fall back to the app shell so deep links like
  // /foo.md route through index.html → resolveFileFromUrl picks the file.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      // 1. Cache match for the exact URL.
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      // 2. Network for the exact URL — known routes (like /about/) are
      //    served by the origin server, then cached for next time.
      try {
        const resp = await fetch(req);
        if (resp && resp.ok) {
          const url = new URL(req.url);
          const isHtmlNav = resp.headers.get('content-type') &&
            resp.headers.get('content-type').includes('text/html');
          // Only cache navigations that look like real HTML pages, not the
          // SPA-shell fallback the origin server might return for unknown paths.
          if (isHtmlNav && (url.pathname === '/' || url.pathname.endsWith('/') || url.pathname.endsWith('.html'))) {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return resp;
        }
      } catch (e) { /* offline — fall through */ }
      // 3. App shell fallback for SPA-style deep links.
      return (await caches.match('./index.html')) || fetch('./index.html');
    })());
    return;
  }

  // Static assets: cache-first, fall back to network and cache the response.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        if (resp && resp.ok && resp.type === 'basic') {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return resp;
      });
    })
  );
});
