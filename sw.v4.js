// sw.v4.js — Network-first for HTML and buttons.json, cache-first for other assets
const CACHE_NAME = 'a1vip-static-v4';

// Resolve paths relative to the worker scope (works on GitHub Pages subpaths)
const REL = (p) => new URL(p, self.registration.scope).pathname;

// (Optional) precache your app shell; keep the list small/safe
const PRECACHE_URLS = [
  REL('./'),
  REL('./index.html'),
  REL('./manifest.json'),
];

// Install: warm the cache but DO NOT claim/skip yet (we'll prompt in the page)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(PRECACHE_URLS)).catch(() => {})
  );
});

// Activate: clean old caches and take control
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

// Fetch strategy:
// 1) buttons.json → always network (cache-busted) with safe fallback
// 2) HTML/document → network-first, fallback to cache
// 3) everything else → cache-first, then network and store
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // buttons.json anywhere in path
  if (url.pathname.endsWith('buttons.json')) {
    event.respondWith((async () => {
      try {
        const bust = `${url.toString()}${url.search ? '&' : '?'}v=${Date.now()}`;
        return await fetch(new Request(bust, { cache: 'reload' }));
      } catch {
        const cached = await caches.match(req);
        return (
          cached ||
          new Response(JSON.stringify({ added: {}, removed: {} }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          })
        );
      }
    })());
    return;
  }

  // HTML/documents → network-first
  if (req.destination === 'document' || (req.mode === 'navigate')) {
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

  // Other assets → cache-first
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const net = await fetch(req);
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, net.clone());
      return net;
    } catch {
      // quietly fail for opaque/CDN assets
      throw;
    }
  })());
});

// Messages from page
self.addEventListener('message', async (event) => {
  const msg = event.data || {};
  if (msg.type === 'SKIP_WAITING') {
    // User accepted the update
    self.skipWaiting();
  } else if (msg.type === 'BUST_CACHE') {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
});
