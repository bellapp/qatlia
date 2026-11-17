const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// The bar invites leaving the atelier for another screen. What is on screen
// (pieces, panel, settings, plan) is kept in the tab while away, and put back
// on return. Keeping it must never make leaving the atelier fail.

const { ATELIER_DRAFT_KEY, writeAtelierDraft, readAtelierDraft, clearAtelierDraft } = loadTsModule('src/lib/atelier-draft.ts');

/** A storage that can refuse its next `failures` writes, as a full quota does. */
function fakeStore({ failures = 0 } = {}) {
  const values = new Map();
  let left = failures;
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => {
      if (left > 0) {
        left -= 1;
        throw new Error('QuotaExceededError');
      }
      values.set(key, String(value));
    },
    removeItem: (key) => { values.delete(key); },
  };
}

function draft(overrides = {}) {
  return {
    v: 1,
    project: {
      name: 'Caissons bas',
      sheet: { height: 244, width: 122, material: 'mdf' },
      pieces: [{ id: 'p1', height: 72, width: 58, quantity: 4 }],
      options: { kerfWidth: 3 },
      result: { sheets: [{ placements: [1, 2, 3] }] },
    },
    plannedPieces: [{ id: 'p1', height: 72, width: 58, quantity: 4 }],
    cutMode: '2d',
    projectId: 'cloud-1',
    localProjectId: null,
    restoredAt: '2026-11-17T09:00:00.000Z',
    ...overrides,
  };
}

test('a draft written is read back as it was', () => {
  const store = fakeStore();

  assert.equal(writeAtelierDraft(store, draft()), 'full');
  assert.deepEqual(readAtelierDraft(store), draft());
  assert.ok(store.values.has(ATELIER_DRAFT_KEY));
});

test('a damaged draft reads as no draft, and is removed', () => {
  for (const damaged of ['{not json', 'null', '[]', '"text"', JSON.stringify({ ...draft(), v: 2 }), JSON.stringify({ ...draft(), project: null }), JSON.stringify({ ...draft(), cutMode: '3d' }), JSON.stringify({ ...draft(), plannedPieces: 'all' })]) {
    const store = fakeStore();
    store.values.set(ATELIER_DRAFT_KEY, damaged);

    assert.equal(readAtelierDraft(store), null, damaged);
    assert.equal(store.values.has(ATELIER_DRAFT_KEY), false, `${damaged} is removed`);
  }
});

test('no draft reads as no draft', () => {
  assert.equal(readAtelierDraft(fakeStore()), null);
});

test('a draft too big for the tab is kept without its plan', () => {
  const store = fakeStore({ failures: 1 });

  assert.equal(writeAtelierDraft(store, draft()), 'without-plan');

  const kept = readAtelierDraft(store);
  assert.equal('result' in kept.project, false, 'the plan is left out');
  assert.equal(kept.plannedPieces, null);
  assert.deepEqual(kept.project.pieces, draft().project.pieces, 'the pieces are kept');
  assert.deepEqual(kept.project.sheet, draft().project.sheet, 'the panel is kept');
  assert.equal(kept.restoredAt, null, 'no plan left to call reopened');
});

test('a draft that cannot be kept at all is dropped without an error, and no older one comes back', () => {
  const store = fakeStore();
  writeAtelierDraft(store, draft({ projectId: 'older' }));
  const full = { ...store, setItem: () => { throw new Error('QuotaExceededError'); } };

  assert.equal(writeAtelierDraft(full, draft()), 'dropped');
  assert.equal(store.values.has(ATELIER_DRAFT_KEY), false);
  assert.equal(readAtelierDraft(store), null);
});

test('the input of the writer is left untouched when the plan is left out', () => {
  const input = draft();

  writeAtelierDraft(fakeStore({ failures: 1 }), input);

  assert.deepEqual(input, draft());
});

test('clearing removes the draft', () => {
  const store = fakeStore();
  writeAtelierDraft(store, draft());

  clearAtelierDraft(store);

  assert.equal(store.values.has(ATELIER_DRAFT_KEY), false);
});

test('a storage that refuses everything never makes the atelier fail', () => {
  const blocked = {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('SecurityError'); },
    removeItem: () => { throw new Error('SecurityError'); },
  };

  assert.equal(writeAtelierDraft(blocked, draft()), 'dropped');
  assert.equal(readAtelierDraft(blocked), null);
  assert.doesNotThrow(() => clearAtelierDraft(blocked));
});
