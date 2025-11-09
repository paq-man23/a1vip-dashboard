// sw.js (A1VIP) — network-first for HTML and buttons.json, cache-first for other static
const STATIC_CACHE = 'a1vip-static-v2';

// Helper: resolve relative to SW scope (works on GitHub Pages subpath)
const REL = (p) => new URL(p, self.registration.scope).pathname;

// Immediately take control on install/activate
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(STATIC_CACHE).then((c) =>
    c.addAll([
      REL('./'),            // app root within GH Pages scope
      REL('./index.html'),
      REL('./manifest.json'),
      // add icons/css/js that are truly static if desired
    ])
  ));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== STATIC_CACHE ? caches.delete(k) : Promise.resolve())));
    await self.clients.claim();
  })());
});

// Network-first for buttons.json, network-first for documents, cache-first for others
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Always go network for buttons.json to pick up new buttons immediately
  if (url.pathname.endsWith('/buttons.json')) {
    event.respondWith((async () => {
      try {
        const bust = `${url.toString()}${url.search ? '&' : '?'}v=${Date.now()}`;
        const req = new Request(bust, {
          headers: event.request.headers,
          method: 'GET',
          cache: 'reload',
          mode: 'cors',
          credentials: 'same-origin'
        });
        const net = await fetch(req);
        return net;
      } catch {
        const cached = await caches.match(event.request);
        return cached || new Response(JSON.stringify({ added: {}, removed: {} }), { headers: { 'Content-Type': 'application/json' }});
      }
    })());
    return;
  }

  // Network-first for HTML documents (ensures app updates quickly)
  if (event.request.destination === 'document') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(event.request, { cache: 'reload' });
        const cache = await caches.open(STATIC_CACHE);
        cache.put(event.request, fresh.clone());
        return fresh;
      } catch {
        const cached = await caches.match(event.request);
        return cached || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // Cache-first for other static assets
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    const net = await fetch(event.request);
    try {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(event.request, net.clone());
    } catch {}
    return net;
  })());
});

// Messages from page (optional)
self.addEventListener('message', async (event) => {
  if (!event.data) return;
  if (event.data.type === 'BUST_CACHE') {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } else if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
