const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');

// The link the bot sends (qatlia.ma/w/<code>, plan 2026-11-19, Task 6): it
// opens the atelier on the pieces read from the photo and the panel the
// summary used, through the atelier's own draft, the way a job kept while
// visiting another screen comes back.

const state = { draft: null, calls: [], db: {} };
stubModule('@/lib/admin/db', { getAdminDb: () => state.db });
stubModule('@/lib/whatsapp/photo-store', {
  openPhotoDraft: async (db, code, now) => {
    state.calls.push({ db, code, now });
    if (state.draft instanceof Error) throw state.draft;
    return state.draft;
  },
});

const { loadPhotoLink, isPhotoCode } = loadTsModule('src/lib/whatsapp/photo-link.ts');
const { photoDraftToAtelierDraft } = loadTsModule('src/lib/whatsapp/photo-summary.ts');
const { writeAtelierDraft, readAtelierDraft } = loadTsModule('src/lib/atelier-draft.ts');

const DRAFT = {
  pieces: [
    { name: 'Côté G', height: 41.8, width: 38, quantity: 7 },
    { name: '', height: 53.1, width: 48, quantity: 4, edges: { left: true, right: false, top: false, bottom: false } },
  ],
  sheet: { height: 244, width: 122 },
};

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test('the atelier draft carries the pieces, the panel used and a project name', () => {
  const draft = photoDraftToAtelierDraft(DRAFT, 1700000000000);
  assert.deepEqual(
    { v: draft.v, plannedPieces: draft.plannedPieces, cutMode: draft.cutMode, projectId: draft.projectId, localProjectId: draft.localProjectId, restoredAt: draft.restoredAt, keptAt: draft.keptAt },
    { v: 1, plannedPieces: null, cutMode: '2d', projectId: null, localProjectId: null, restoredAt: null, keptAt: 1700000000000 }
  );
  assert.equal(draft.project.projectName, 'Fiche WhatsApp');
  assert.equal(draft.project.sheets.length, 1);
  assert.equal(draft.project.sheets[0].height, 244);
  assert.equal(draft.project.sheets[0].width, 122);
  assert.equal(draft.project.sheets[0].kerf, 0);
  assert.deepEqual(
    draft.project.pieces.map((p) => [p.id, p.name, p.height, p.width, p.quantity, p.material, p.rotatable]),
    [
      ['1', 'Côté G', 41.8, 38, 7, 'mdf', true],
      ['2', '', 53.1, 48, 4, 'mdf', true],
    ]
  );
  assert.deepEqual(draft.project.pieces[1].edges, { left: true, right: false, top: false, bottom: false });
});

test('the draft survives the atelier draft store round trip', () => {
  const store = memoryStorage();
  const draft = photoDraftToAtelierDraft(DRAFT, Date.now());
  assert.equal(writeAtelierDraft(store, draft), 'full');
  assert.deepEqual(readAtelierDraft(store), draft);
});

test('codes: 10 characters of the link alphabet only', () => {
  assert.equal(isPhotoCode('k7m2qx9dab'), true);
  for (const bad of ['', 'k7m2qx9da', 'k7m2qx9dabc', 'K7M2QX9DAB', 'k7m2qx9da1', 'k7m2qx9dal', '../../etc', null, undefined]) {
    assert.equal(isPhotoCode(bad), false, String(bad));
  }
});

test('a valid code opens its draft', async () => {
  state.calls = [];
  state.draft = DRAFT;
  assert.deepEqual(await loadPhotoLink('k7m2qx9dab'), DRAFT);
  assert.equal(state.calls[0].code, 'k7m2qx9dab');
  assert.equal(state.calls[0].db, state.db);
});

test('expired or unknown : null', async () => {
  for (const answer of ['expired', null]) {
    state.draft = answer;
    assert.equal(await loadPhotoLink('k7m2qx9dab'), null);
  }
});

test('a malformed code never reaches the database', async () => {
  state.calls = [];
  assert.equal(await loadPhotoLink('../admin'), null);
  assert.equal(state.calls.length, 0);
});

test('no database configured, or a database error : null, never a crash', async () => {
  state.db = null;
  assert.equal(await loadPhotoLink('k7m2qx9dab'), null);
  state.db = {};
  state.draft = new Error('down');
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal(await loadPhotoLink('k7m2qx9dab'), null);
  } finally {
    console.error = original;
  }
});
