const CACHE_VERSION = 'v1';
const CACHE_NAME = 'readme-viewer-' + CACHE_VERSION;

const PRECACHE_URLS = [
  './',
  './index.html',
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

  // Navigation requests: serve the app shell so deep links like /foo.md
  // load index.html, then resolveFileFromUrl picks the file.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => {
        const network = fetch('./index.html').then((resp) => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          }
          return resp;
        }).catch(() => cached);
        return cached || network;
      })
    );
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
