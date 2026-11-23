const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');

// Measurements typed instead of a photo (22/11/2026: « 180x160/140x120/260x60 »,
// a carpenter told six times to write them on paper). Read by the model, then
// planned and answered exactly like a photographed sheet, and counted as the
// number's one free read. Anything else falls back to the assistant.

const state = {};
function reset() {
  Object.assign(state, {
    latest: null,
    latestError: null,
    read: { status: 'ok', pieces: [{ name: '', height: 180, width: 60, quantity: 2 }], sheet: null },
    readError: null,
    readCalls: [],
    reservation: { status: 'reserved', id: 'r1' },
    reserveCalls: [],
    completed: [],
    failed: [],
    delivered: [],
    images: [],
    imageResult: true,
  });
}
reset();

stubModule('@/lib/whatsapp/photo-store', {
  latestPhotoRead: async (db, waId, now) => {
    if (state.latestError) throw state.latestError;
    return state.latest;
  },
  reservePhotoRead: async (db, waId, now, cap) => {
    state.reserveCalls.push({ waId, cap });
    return state.reservation;
  },
  completePhotoRead: async (db, id, result) => {
    state.completed.push({ id, ...result });
  },
  failPhotoRead: async (db, id) => {
    state.failed.push(id);
  },
  newPhotoCode: () => 'k7m2qx9dab',
});
stubModule('@/lib/vision/read-cut-list', {
  readTypedCutList: async (text, options) => {
    state.readCalls.push({ text, options });
    if (state.readError) throw state.readError;
    return state.read;
  },
});

const { handleTypedList, TYPED_READ_TIMEOUT_MS } = loadTsModule('src/lib/whatsapp/typed-list.ts');
const { photoLink } = loadTsModule('src/lib/whatsapp/photo-summary.ts');
const { planImageUrl } = loadTsModule('src/lib/whatsapp/plan-image.ts');

const WA = '212600000001';
const NOW = new Date('2026-11-23T12:00:00Z');

function run({ cap = 300, text = '180x60x2', lang = 'ar', withImage = true } = {}) {
  return handleTypedList({
    db: {},
    config: { photoDailyCap: cap },
    waId: WA,
    text,
    lang,
    now: NOW,
    deliver: async (body, kind) => {
      state.delivered.push({ body, kind });
      return true;
    },
    ...(withImage
      ? {
          deliverImage: async (link, caption, kind, card) => {
            state.images.push({ link, kind, card });
            return state.imageResult;
          },
        }
      : {}),
  });
}

test('typed measurements are read, planned, stored and answered with the plan card', async () => {
  reset();
  assert.equal(await run({ text: '180x60x2' }), 'handled');
  assert.deepEqual(state.readCalls, [{ text: '180x60x2', options: { timeoutMs: TYPED_READ_TIMEOUT_MS } }]);
  assert.deepEqual(state.reserveCalls, [{ waId: WA, cap: 300 }]);
  assert.equal(state.completed.length, 1);
  assert.equal(state.completed[0].id, 'r1');
  assert.equal(state.completed[0].code, 'k7m2qx9dab');
  assert.deepEqual(state.completed[0].pieces, [{ name: '', height: 180, width: 60, quantity: 2 }]);
  assert.equal(state.images.length, 1);
  assert.equal(state.images[0].link, planImageUrl('k7m2qx9dab'));
  assert.equal(state.images[0].kind, 'photo_result');
  assert.equal(state.images[0].card.url, photoLink('k7m2qx9dab'));
  assert.equal(state.delivered.length, 0, 'no « je lis » for a typed list');
});

test('a card that cannot go out leaves the text answer, with the link', async () => {
  reset();
  state.imageResult = false;
  assert.equal(await run(), 'handled');
  assert.equal(state.delivered.length, 1);
  assert.equal(state.delivered[0].kind, 'photo_result');
  assert.ok(state.delivered[0].body.includes(photoLink('k7m2qx9dab')));
});

test('the panel typed with the pieces is the one planned on', async () => {
  reset();
  state.read = { status: 'ok', pieces: [{ name: '', height: 100, width: 50, quantity: 1 }], sheet: { height: 244, width: 122 } };
  await run();
  assert.deepEqual(state.completed[0].summary.sheet, { height: 244, width: 122 });
});

test('a number already served gets the assistant, and the model is not called', async () => {
  reset();
  state.latest = { pieceCount: 13, code: 'abcdefghij' };
  assert.equal(await run(), 'fallback');
  assert.equal(state.readCalls.length, 0);
  assert.equal(state.reserveCalls.length, 0);
});

test('nothing read (a panel size alone, a whole wardrobe, a model failure): the assistant answers, no read is used up', async () => {
  for (const read of [{ status: 'unreadable' }, { status: 'error', rateLimited: false, httpStatus: 500 }, { status: 'unavailable' }]) {
    reset();
    state.read = read;
    assert.equal(await run(), 'fallback', read.status);
    assert.equal(state.reserveCalls.length, 0, read.status);
    assert.deepEqual(state.failed, []);
  }
  reset();
  state.read = { status: 'ok', pieces: [{ name: '', height: 0, width: 60, quantity: 1 }], sheet: null };
  assert.equal(await run(), 'fallback', 'no usable line');
  assert.equal(state.reserveCalls.length, 0);
});

test('a reader that throws, or a failing lookup, falls back to the assistant', async () => {
  reset();
  state.readError = new Error('boom');
  assert.equal(await run(), 'fallback');
  reset();
  state.latestError = new Error('db down');
  const errors = test.mock.method(console, 'error', () => {});
  assert.equal(await run(), 'fallback');
  errors.mock.restore();
});

test('reading off, capped or unavailable: the assistant; another read running: silent', async () => {
  reset();
  assert.equal(await run({ cap: 0 }), 'fallback');
  assert.equal(state.readCalls.length, 0);
  for (const status of ['daily_cap', 'too_many_failures', 'unavailable']) {
    reset();
    state.reservation = { status };
    assert.equal(await run(), 'fallback', status);
    assert.equal(state.completed.length, 0);
  }
  reset();
  state.reservation = { status: 'already', code: null };
  assert.equal(await run(), 'fallback');
  reset();
  state.reservation = { status: 'busy' };
  assert.equal(await run(), 'silent');
  assert.equal(state.delivered.length + state.images.length, 0);
});

test('a list nothing of which fits the panel frees the read and falls back', async () => {
  reset();
  state.read = { status: 'ok', pieces: [{ name: '', height: 500, width: 300, quantity: 1 }], sheet: { height: 244, width: 122 } };
  assert.equal(await run(), 'fallback');
  assert.deepEqual(state.failed, ['r1']);
  assert.equal(state.completed.length, 0);
});
