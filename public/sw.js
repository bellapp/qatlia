// Bump CACHE whenever the strategy changes: activate drops every other cache.
const CACHE = 'qatlia-v2';
const PRECACHE = ['/', '/atelier', '/auth/login', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const stale = (await caches.keys()).filter((k) => k !== CACHE);
    await Promise.all(stale.map((k) => caches.delete(k)));
    await self.clients.claim();
    // Upgrading from an older worker: open tabs may be running HTML from a previous
    // build whose chunks are gone (ChunkLoadError). Reload them onto the live build.
    // A first install has no stale cache, so first-time visitors are not reloaded.
    if (stale.length > 0) {
      const windows = await self.clients.matchAll({ type: 'window' });
      await Promise.all(windows.map((w) => w.navigate(w.url).catch(() => {})));
    }
  })());
});

function putInCache(request, res) {
  if (res.ok && res.type === 'basic' && !res.redirected) {
    const clone = res.clone();
    caches.open(CACHE).then((c) => c.put(request, clone));
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Pages: network-first. HTML names build-specific chunks, so a cached page outlives
  // the deploy it came from; the cache is only the offline fallback.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => putInCache(request, res))
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  // Build assets are content-hashed and immutable: cache-first is safe.
  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => putInCache(request, res)))
    );
  }
  // Everything else (API, RSC payloads, public files) goes straight to the network.
});
