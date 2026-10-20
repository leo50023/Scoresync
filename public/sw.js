// ScoreSync Service Worker — v10
// Full offline support: caches scoring page + serves offline-scoring.html when no internet

const CACHE_STATIC = 'scoresync-static-v10';
const CACHE_PAGES  = 'scoresync-pages-v7';
const CACHE_FONTS  = 'scoresync-fonts-v7';

const STATIC_ASSETS = [
  '/tailwind.css',
  '/fa.embedded.css',
  '/fa.min.css',
  '/manifest.json',
  '/scoresync-logo.png',
  '/minsu-logo.png',
  '/icon.png',
  '/offlineScores.js',
  '/offline-scoring.html',           // pre-cache the offline scoring page
  '/webfonts/fa-solid-900.woff2',
  '/webfonts/fa-regular-400.woff2',
  '/webfonts/fa-brands-400.woff2',
];

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_STATIC)
      .then(c => c.addAll(STATIC_ASSETS))
      .catch(() => {})
  );
});

// ── Activate ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_STATIC && k !== CACHE_PAGES && k !== CACHE_FONTS)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // 1. Google Fonts — cache on first load
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(CACHE_FONTS).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(res => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          }).catch(() => new Response('', { status: 503 }));
        })
      )
    );
    return;
  }

  // 2. Tailwind CDN — cache on first load
  if (url.hostname === 'cdn.tailwindcss.com') {
    e.respondWith(
      caches.open(CACHE_STATIC).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(res => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          }).catch(() => new Response('', { status: 503 }));
        })
      )
    );
    return;
  }

  // 3. Local static assets — cache first
  const isStatic = STATIC_ASSETS.some(s => url.pathname === s)
    || url.pathname.startsWith('/webfonts/');

  if (isStatic) {
    e.respondWith(
      caches.match(e.request).then(cached =>
        cached || fetch(e.request).then(res => {
          if (res.ok) caches.open(CACHE_STATIC).then(c => c.put(e.request, res.clone()));
          return res;
        }).catch(() => new Response('', { status: 503 }))
      )
    );
    return;
  }

  // 4. Scoring page — network first, fallback to cached page
  //    When offline: redirect to /offline-scoring.html (pre-cached, works 100% locally)
  const isScoringPage = url.pathname.endsWith('/scoring');

  if (isScoringPage) {
    e.respondWith(
      fetch(e.request.clone())
        .then(res => {
          // Online — cache it fresh for next time
          if (res.ok) {
            caches.open(CACHE_PAGES).then(c => c.put(e.request, res.clone()));
          }
          return res;
        })
        .catch(() => {
          // Offline — try cached scoring page first, then fall back to offline-scoring.html
          return caches.match(e.request).then(cached => {
            if (cached) return cached;
            // No cached scoring page — serve the offline standalone app
            return caches.match('/offline-scoring.html');
          });
        })
    );
    return;
  }

  // 5. /offline-scoring direct access — always serve from cache
  if (url.pathname === '/offline-scoring.html' || url.pathname === '/offline-scoring') {
    e.respondWith(
      caches.match('/offline-scoring.html').then(cached =>
        cached || fetch(e.request).then(res => {
          if (res.ok) caches.open(CACHE_STATIC).then(c => c.put(e.request, res.clone()));
          return res;
        })
      )
    );
    return;
  }

  // 6. Everything else — network only (always fresh)
});
