// ScoreSync Service Worker — v15
// PWA support: caches static assets for fast loads

const CACHE_STATIC = 'scoresync-static-v15';
const CACHE_FONTS  = 'scoresync-fonts-v8';

const STATIC_ASSETS = [
  '/tailwind.css',
  '/fa.embedded.css',
  '/manifest.json',
  '/scoresync-logo.png',
  '/icon.png',
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
        keys.filter(k => k !== CACHE_STATIC && k !== CACHE_FONTS)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // 0. Never intercept /api/ routes — let the browser handle them normally
  if (url.pathname.startsWith('/api/')) return;

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
          if (res.ok) {
            const resClone = res.clone();
            caches.open(CACHE_STATIC).then(c => c.put(e.request, resClone));
          }
          return res;
        }).catch(() => new Response('', { status: 503 }))
      )
    );
    return;
  }

  // 4. Everything else — network only (always fresh)
});

// ── Web Push ───────────────────────────────────────────────────────────────────
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  const title = data.title || 'ScoreSync';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon.png',
    badge: data.badge || '/icon.png',
    data: { url: data.url || '/dashboard' },
    vibrate: [200, 100, 200],
    tag: 'scoresync-notif',
    renotify: true,
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(function(clientList) {
      const url = e.notification.data?.url || '/dashboard';
      for (var c of clientList) {
        if (c.url.includes(url) && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
