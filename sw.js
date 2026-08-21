// Morfeo service worker — caches app shell for offline use
const CACHE = 'morfeo-v1';
const SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/indicators.js',
  '/js/optimiser.js',
  '/js/portfolio.js',
  '/js/charts.js',
  '/js/app.js',
  '/js/auth.js',
  '/js/help.js',
  '/js/firebase-config.js',
  '/morfeo.png',
  '/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for API calls; cache-first for app shell assets
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Always go to network for API calls, Firebase, Yahoo Finance, etc.
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('yahoo') ||
    url.hostname.includes('alphavantage') ||
    url.hostname.includes('allorigins') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('gstatic') ||
    url.hostname.includes('plot.ly') ||
    e.request.method !== 'GET'
  ) {
    return; // let browser handle normally
  }

  // Network-first for navigations/HTML: netlify.toml sends no-cache on *.html
  // specifically so redeploys are picked up immediately — a cache-first SW
  // would silently defeat that. Fall back to the cache when offline.
  const isHTML = e.request.mode === 'navigate' || e.request.destination === 'document';
  if (isHTML) {
    e.respondWith(
      fetch(e.request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => caches.match(e.request).then(cached => cached || caches.match('/index.html')))
    );
    return;
  }

  // Cache-first for the rest of the app shell (CSS/JS/images)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp.ok && e.request.url.startsWith(self.location.origin)) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => caches.match('/index.html')); // offline fallback
    })
  );
});
