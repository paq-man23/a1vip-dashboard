// sw.v4.js — A1VIP Dashboard
// Update style: show "New update available" banner in the page; activate on user click.
// If you need to force all installs to fetch this worker, bump CACHE_NAME.

const CACHE_NAME = 'a1vip-static-v5'; // bump this once


// Resolve relative to worker scope (safe for GitHub Pages subpaths)
const REL = (p) => new URL(p, self.registration.scope).pathname;

// Keep the precache small and stable
const PRECACHE_URLS = [
  REL('./'),
  REL('./index.html'),
  REL('./manifest.json'),
];

// INSTALL: warm cache (no skipWaiting — page will prompt the user)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(PRECACHE_URLS)).catch(() => {})
  );
});

// ACTIVATE: clean old caches and take control immediately
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

// FETCH:
// 1) buttons.json → network (cache-busted) with safe cached fallback, and write-through to cache
// 2) Documents (HTML/navigate) → network-first, fallback to cache
// 3) Other assets → cache-first, then network and store
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Always-fresh buttons.json
  if (url.pathname.endsWith('buttons.json')) {
    event.respondWith((async () => {
      try {
        const bust = `${url.toString()}${url.search ? '&' : '?'}v=${Date.now()}`;
        const res = await fetch(bust, { cache: 'reload' });
        // write-through to cache for resilience
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, res.clone());
        return res;
      } catch {
        const cached = await caches.match(req);
        return cached || new Response(JSON.stringify({ added: {}, removed: {} }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      }
    })());
    return;
  }

  // HTML/documents: network-first
  if (req.destination === 'document' || req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'reload' });
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(req);
        return cached || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // Other assets: cache-first
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const net = await fetch(req);
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, net.clone());
      return net;
    } catch {
      // Let the request fail quietly for opaque/CDN assets
      throw;
    }
  })());
});

// Page ↔ SW messaging
self.addEventListener('message', async (event) => {
  const msg = event.data || {};
  if (msg.type === 'SKIP_WAITING') {
    // User accepted the in-page "Update" prompt
    self.skipWaiting();
  } else if (msg.type === 'BUST_CACHE') {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
});
