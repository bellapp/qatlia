const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');

// A first-time visitor's photo and pieces survive the sign-in they are asked
// for (user request, 2026-11-12), and the post-login redirect stays on site.

const pending = () => loadTsModule('src/lib/pending-work.ts');

/** An in-memory Storage, optionally refusing writes above a size. */
function memoryStore({ maxChars = Infinity } = {}) {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      if (String(value).length > maxChars) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      data.set(key, String(value));
    },
    removeItem: (key) => data.delete(key),
  };
}

const PHOTO = `data:image/jpeg;base64,${'A'.repeat(5000)}`;
const PIECES = [{ id: 'p1', name: 'Côté', height: 63, width: 55, quantity: 2 }];
const SHEETS = [{ id: 's1', height: 278, width: 208, kerf: 0.3, material: 'mdf' }];
const NOW = 1_800_000_000_000;

test('kept work comes back in the tab that asked for it', () => {
  const { savePendingWork, loadPendingWork, isFromThisTab } = pending();
  const store = memoryStore();
  const tab = memoryStore();
  assert.equal(savePendingWork(store, tab, { action: 'scan', image: PHOTO, pieces: PIECES, sheets: SHEETS, projectName: 'Cuisine' }, NOW), true);
  const work = loadPendingWork(store, NOW + 60_000);
  assert.equal(work.action, 'scan');
  assert.equal(work.image, PHOTO);
  assert.deepEqual(work.pieces, PIECES);
  assert.equal(work.projectName, 'Cuisine');
  assert.equal(isFromThisTab(tab, work), true);
  assert.equal(isFromThisTab(memoryStore(), work), false, 'another tab (email confirmation) is not the asking tab');
});

test('kept work expires after a few hours and is then cleared', () => {
  const { savePendingWork, loadPendingWork, PENDING_WORK_TTL_MS, PENDING_WORK_KEY } = pending();
  const store = memoryStore();
  savePendingWork(store, memoryStore(), { action: 'optimize', pieces: PIECES, sheets: SHEETS }, NOW);
  assert.ok(loadPendingWork(store, NOW + PENDING_WORK_TTL_MS));
  assert.equal(loadPendingWork(store, NOW + PENDING_WORK_TTL_MS + 1), null);
  assert.equal(store.getItem(PENDING_WORK_KEY), null);
});

test('a malformed or tampered entry is ignored', () => {
  const { parsePendingWork } = pending();
  const valid = { v: 1, id: 'x', action: 'optimize', savedAt: NOW, pieces: [], sheets: [] };
  assert.ok(parsePendingWork(JSON.stringify(valid), NOW));
  for (const bad of [
    'not json',
    JSON.stringify(null),
    JSON.stringify({ ...valid, v: 2 }),
    JSON.stringify({ ...valid, action: 'pdf' }),
    JSON.stringify({ ...valid, pieces: 'x' }),
    JSON.stringify({ ...valid, image: 42 }),
    JSON.stringify({ ...valid, action: 'scan' }),
    JSON.stringify({ ...valid, savedAt: NOW + 10_000 }),
  ]) {
    assert.equal(parsePendingWork(bad, NOW), null, bad);
  }
});

test('when storage is full, a run is kept without its photo but a scan without its photo is not kept', () => {
  const { savePendingWork, loadPendingWork } = pending();
  const smallStore = memoryStore({ maxChars: 2000 });
  assert.equal(savePendingWork(smallStore, memoryStore(), { action: 'optimize', image: PHOTO, pieces: PIECES, sheets: SHEETS }, NOW), true);
  const run = loadPendingWork(smallStore, NOW);
  assert.equal(run.image, undefined);
  assert.deepEqual(run.pieces, PIECES);

  const otherSmallStore = memoryStore({ maxChars: 2000 });
  assert.equal(savePendingWork(otherSmallStore, memoryStore(), { action: 'scan', image: PHOTO, pieces: [], sheets: SHEETS }, NOW), false);
  assert.equal(loadPendingWork(otherSmallStore, NOW), null);
});

test('work is offered once, in the first other tab, which keeps it if the page remounts', () => {
  const { savePendingWork, loadPendingWork, shouldOfferPendingWork } = pending();
  const store = memoryStore();
  savePendingWork(store, memoryStore(), { action: 'optimize', pieces: PIECES, sheets: SHEETS }, NOW);
  const confirmationTab = memoryStore();
  assert.equal(shouldOfferPendingWork(store, confirmationTab, loadPendingWork(store, NOW)), true);
  assert.equal(loadPendingWork(store, NOW).offered, true);
  // The page mounts a second time right after loading: still shown there.
  assert.equal(shouldOfferPendingWork(store, confirmationTab, loadPendingWork(store, NOW)), true);
  // A later visit in a new tab does not restore it over newer work.
  assert.equal(shouldOfferPendingWork(store, memoryStore(), loadPendingWork(store, NOW)), false);
});

test('clearing removes the work and the tab mark', () => {
  const { savePendingWork, loadPendingWork, clearPendingWork, PENDING_TAB_KEY } = pending();
  const store = memoryStore();
  const tab = memoryStore();
  savePendingWork(store, tab, { action: 'optimize', pieces: PIECES, sheets: SHEETS }, NOW);
  clearPendingWork(store, tab);
  assert.equal(loadPendingWork(store, NOW), null);
  assert.equal(tab.getItem(PENDING_TAB_KEY), null);
});

test('only a same-site path is accepted as the post-login destination', () => {
  const { safeRedirectPath } = pending();
  assert.equal(safeRedirectPath('/atelier'), '/atelier');
  assert.equal(safeRedirectPath('/history?x=1'), '/history?x=1');
  for (const hostile of ['@evil.example', '//evil.example', '/\\evil.example', 'https://evil.example', 'evil.example', '/atelier\r\nSet-Cookie: x', '', null, undefined]) {
    assert.equal(safeRedirectPath(hostile, '/'), '/', String(hostile));
  }
});

// ─── /auth/callback ─────────────────────────────────────────────────────────

stubModule('@/lib/supabase/server', {
  createClient: () => ({ auth: { exchangeCodeForSession: async () => ({ error: null }) } }),
});

async function callback(query) {
  const { GET } = loadTsModule('src/app/(site)/auth/callback/route.ts');
  const res = await GET(new Request(`https://qatlia.ma/auth/callback?${query}`));
  return res.headers.get('location');
}

test('signing in with Google brings the visitor back to the atelier', async () => {
  assert.equal(await callback('code=abc&redirect=%2Fatelier'), 'https://qatlia.ma/atelier');
});

test('the callback never sends a freshly signed-in visitor to another site', async () => {
  assert.equal(await callback('code=abc&redirect=%40evil.example'), 'https://qatlia.ma/');
  assert.equal(await callback('code=abc&redirect=%2F%2Fevil.example'), 'https://qatlia.ma/');
  assert.equal(await callback('code=abc&redirect=https%3A%2F%2Fevil.example'), 'https://qatlia.ma/');
});
