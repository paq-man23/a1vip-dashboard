// sw.js
const STATIC_CACHE = 'a1vip-static-v1';

// Immediately take control on install/activate
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(STATIC_CACHE).then((c) =>
    c.addAll([
      '/',            // if your app is at the origin root; otherwise add /index.html path
      '/index.html',  // include the correct path for your hosted HTML
      '/manifest.json',
      // add icons/css/js that are truly static (logo, styles) if any
    ])
  ));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // clean old caches if you version them later
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k !== STATIC_CACHE ? caches.delete(k) : Promise.resolve())));
    await self.clients.claim();
  })());
});

// Network-first for buttons.json, app shell network-first for HTML, cache-first for static
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Always go to network for buttons.json (bypass any cached copy)
  if (url.pathname.endsWith('/buttons.json')) {
    event.respondWith((async () => {
      try {
        // Force fresh
        const req = new Request(url.toString() + `?v=${Date.now()}`, {
          headers: event.request.headers,
          method: 'GET',
          cache: 'reload',
          mode: 'cors',
          credentials: 'same-origin'
        });
        const net = await fetch(req);
        return net;
      } catch {
        // fallback to cache if you choose (or just error)
        const cached = await caches.match(event.request);
        return cached || new Response(JSON.stringify({ added:{}, removed:{} }), { headers: { 'Content-Type': 'application/json' }});
      }
    })());
    return;
  }

  // Network-first for HTML documents to pick up new code
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

// Optional: allow the page to tell the SW to clear caches
self.addEventListener('message', async (event) => {
  if (event.data && event.data.type === 'BUST_CACHE') {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
});
