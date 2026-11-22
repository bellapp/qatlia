const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Offline, a page already visited still shows from the cache; a page never
// visited shows a « Pas de connexion » screen instead of the cached landing and
// its prices (spec 2026-11-14, lot 2).

const ROOT = path.resolve(__dirname, '..');
const SW = fs.readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8');
const OFFLINE = fs.readFileSync(path.join(ROOT, 'public/offline.html'), 'utf8');

/** Runs sw.js against a fake worker, offline, with `cached` already stored. */
function offlineWorker(cached) {
  const handlers = {};
  const store = new Map(Object.entries(cached));
  const keyOf = (req) => (typeof req === 'string' ? req : new URL(req.url).pathname);
  const caches = {
    match: async (req) => store.get(keyOf(req)),
    open: async () => ({ put: async () => {}, addAll: async () => {} }),
    keys: async () => [],
    delete: async () => true,
  };
  const self = {
    location: { origin: 'https://qatlia.ma' },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting() {},
    clients: { claim: async () => {}, matchAll: async () => [] },
  };
  vm.runInNewContext(SW, { self, caches, URL, fetch: () => Promise.reject(new TypeError('offline')) });
  return async (pathname) => {
    let response;
    handlers.fetch({
      request: { method: 'GET', mode: 'navigate', url: `https://qatlia.ma${pathname}` },
      respondWith: (p) => { response = p; },
    });
    return response;
  };
}

test('offline, a visited page comes from the cache', async () => {
  const navigate = offlineWorker({ '/atelier': 'ATELIER', '/offline.html': 'OFFLINE', '/': 'LANDING' });
  assert.equal(await navigate('/atelier'), 'ATELIER');
});

test('offline, a page never visited shows the offline screen, not the landing', async () => {
  const navigate = offlineWorker({ '/offline.html': 'OFFLINE', '/': 'LANDING' });
  assert.equal(await navigate('/history'), 'OFFLINE');
});

test('the offline screen is stored at install, and the cache name moves on', () => {
  const precache = /const PRECACHE = \[([^\]]*)\]/.exec(SW)[1];
  assert.match(precache, /'\/offline\.html'/);
  assert.doesNotMatch(SW, /const CACHE = 'qatlia-v2'/, 'a new cache name reloads open tabs onto the new worker');
});

test('the offline screen offers to retry and sells nothing', () => {
  assert.match(OFFLINE, /Pas de connexion/);
  assert.match(OFFLINE, /Réessayer/);
  assert.match(OFFLINE, /location\.reload\(\)/);
  assert.doesNotMatch(OFFLINE, /credits|MAD|DH|€|\$|tarif|prix|pack/i);
  assert.doesNotMatch(OFFLINE, /<script[^>]+src=|<link[^>]+href=/, 'self-contained: nothing to load while offline');
});
