const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');

// The photo flow of the WhatsApp bot (plan 2026-11-19, Task 5): reserve the
// number's one read, say "je lis", download, read, summarise, store, answer.
// Store, media and reader are stubs; summary and copy are the real ones.

const state = {};
function reset() {
  Object.assign(state, {
    reservation: { status: 'reserved', id: 'r1' },
    reserveError: null,
    reserveCalls: [],
    completed: [],
    failed: [],
    media: { ok: true, dataUrl: 'data:image/jpeg;base64,AAA', mimeType: 'image/jpeg', bytes: 3 },
    mediaCalls: [],
    read: { status: 'ok', pieces: [{ name: '', height: 50, width: 40, quantity: 2 }], sheet: null },
    readError: null,
    readCalls: [],
    alreadyCount: 0,
    countCalls: [],
    delivered: [],
  });
}
reset();

stubModule('@/lib/whatsapp/photo-store', {
  reservePhotoRead: async (db, waId, now, cap) => {
    state.reserveCalls.push({ waId, cap });
    if (state.reserveError) throw state.reserveError;
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
stubModule('@/lib/whatsapp/media', {
  fetchMediaDataUrl: async (config, mediaId) => {
    state.mediaCalls.push(mediaId);
    return state.media;
  },
});
stubModule('@/lib/vision/read-cut-list', {
  readCutList: async (dataUrl, options) => {
    state.readCalls.push({ dataUrl, options });
    if (state.readError) throw state.readError;
    return state.read;
  },
});
stubModule('@/lib/whatsapp/store', {
  countBotMessages: async (db, waId, kind, since) => {
    state.countCalls.push({ kind, since });
    return state.alreadyCount;
  },
});

const { handlePhoto } = loadTsModule('src/lib/whatsapp/photo.ts');
const { PHOTO_COPY } = loadTsModule('src/lib/whatsapp/copy.ts');
const { photoLink } = loadTsModule('src/lib/whatsapp/photo-summary.ts');

const WA = '212600000001';
const NOW = new Date('2026-11-19T12:00:00Z');
const CONFIG = { photoDailyCap: 300, accessToken: 't', graphVersion: 'v23.0' };
const event = (over = {}) => ({ type: 'inbound', wamid: 'w1', waId: WA, profileName: null, kind: 'image', text: null, referral: null, mediaId: 'M1', ...over });

function run(over = {}, lang = 'fr') {
  return handlePhoto({
    db: {},
    config: CONFIG,
    event: event(over),
    lang,
    now: NOW,
    deliver: async (text, kind) => {
      state.delivered.push({ text, kind });
      return true;
    },
  });
}

test('a first photo : "je lis", then the summary with the link, and the read is stored', async () => {
  reset();
  assert.equal(await run(), 'handled');
  assert.deepEqual(state.reserveCalls, [{ waId: WA, cap: 300 }]);
  assert.deepEqual(state.mediaCalls, ['M1']);
  assert.deepEqual(state.readCalls, [{ dataUrl: 'data:image/jpeg;base64,AAA', options: { readPanel: true, timeoutMs: 30000 } }]);
  assert.deepEqual(state.delivered.map((d) => d.kind), ['photo_reading', 'photo_result']);
  assert.equal(state.delivered[0].text, PHOTO_COPY.reading.fr);
  assert.ok(state.delivered[1].text.endsWith(photoLink('k7m2qx9dab')));
  assert.equal(state.completed.length, 1);
  const done = state.completed[0];
  assert.equal(done.id, 'r1');
  assert.equal(done.code, 'k7m2qx9dab');
  assert.deepEqual(done.summary.sheet, { height: 278, width: 208 });
  assert.equal(done.now, NOW);
  assert.deepEqual(state.failed, []);
});

test('the reply follows the language', async () => {
  reset();
  await run({}, 'ar');
  assert.equal(state.delivered[0].text, PHOTO_COPY.reading.ar);
  assert.match(state.delivered[1].text, /تقرات/);
});

test('a photo without a media id : hint, nothing reserved', async () => {
  reset();
  assert.equal(await run({ mediaId: null }), 'hint');
  assert.equal(state.reserveCalls.length, 0);
});

test('another read of this number is running : silent, no read', async () => {
  reset();
  state.reservation = { status: 'busy' };
  assert.equal(await run(), 'silent');
  assert.equal(state.delivered.length, 0);
  assert.equal(state.readCalls.length, 0);
});

test('a number already served gets its link and the atelier, once per 10 minutes', async () => {
  reset();
  state.reservation = { status: 'already', code: 'k7m2qx9dab' };
  assert.equal(await run(), 'handled');
  assert.deepEqual(state.delivered, [{ text: PHOTO_COPY.already('fr', photoLink('k7m2qx9dab')), kind: 'photo_already' }]);
  assert.equal(state.countCalls[0].kind, 'photo_already');
  assert.equal(NOW.getTime() - state.countCalls[0].since.getTime(), 10 * 60 * 1000);
  assert.equal(state.readCalls.length, 0);

  state.alreadyCount = 1;
  state.delivered = [];
  assert.equal(await run(), 'silent');
  assert.equal(state.delivered.length, 0);
});

test('an expired first read : the atelier only', async () => {
  reset();
  state.reservation = { status: 'already', code: null };
  await run();
  assert.equal(state.delivered[0].text, PHOTO_COPY.already('fr', null));
});

for (const status of ['too_many_failures', 'daily_cap', 'unavailable']) {
  test(`reservation ${status} : hint, no download`, async () => {
    reset();
    state.reservation = { status };
    assert.equal(await run(), 'hint');
    assert.equal(state.mediaCalls.length, 0);
    assert.equal(state.delivered.length, 0);
  });
}

test('a reservation that throws : hint', async () => {
  reset();
  state.reserveError = new Error('db down');
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal(await run(), 'hint');
  } finally {
    console.error = original;
  }
  assert.equal(state.delivered.length, 0);
});

/** After "je lis", a failure is always answered: the failed-read text, never the (cooldown-bound) hint. */
const answeredAsFailed = () => {
  assert.deepEqual(state.delivered.map((d) => d.kind), ['photo_reading', 'photo_failed']);
  assert.equal(state.delivered[1].text, PHOTO_COPY.unreadable.fr);
  assert.deepEqual(state.failed, ['r1']);
};

test('a download refused : the read is failed and answered as such', async () => {
  reset();
  state.media = { ok: false, reason: 'lookup_refused', status: 400 };
  assert.equal(await run(), 'handled');
  answeredAsFailed();
  assert.equal(state.readCalls.length, 0);
  assert.equal(state.completed.length, 0);
});

for (const read of [{ status: 'unreadable' }, { status: 'error', rateLimited: false, httpStatus: 502 }, { status: 'unavailable' }]) {
  test(`a read ${read.status} : failed and answered as such`, async () => {
    reset();
    state.read = read;
    assert.equal(await run(), 'handled');
    answeredAsFailed();
    assert.equal(state.completed.length, 0);
  });
}

test('a reader that throws : failed and answered as such', async () => {
  reset();
  state.readError = new Error('boom');
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal(await run(), 'handled');
  } finally {
    console.error = original;
  }
  answeredAsFailed();
});

test('a list over 300 pieces is not planned: failed and answered, no summary', async () => {
  reset();
  state.read = { status: 'ok', pieces: [{ name: '', height: 50, width: 40, quantity: 301 }], sheet: null };
  assert.equal(await run(), 'handled');
  answeredAsFailed();
  assert.equal(state.completed.length, 0);
});

test('lines without a usable size are dropped; none left : failed and answered', async () => {
  reset();
  state.read = { status: 'ok', pieces: [{ name: '', height: NaN, width: 40, quantity: 1 }, { name: '', height: 50, width: 40, quantity: 2 }], sheet: null };
  await run();
  assert.deepEqual(state.completed[0].pieces, [{ name: '', height: 50, width: 40, quantity: 2 }]);
  assert.doesNotMatch(state.delivered[1].text, /NaN/);
  reset();
  state.read = { status: 'ok', pieces: [{ name: '', height: NaN, width: 40, quantity: 1 }], sheet: null };
  assert.equal(await run(), 'handled');
  answeredAsFailed();
});

test('nothing fits the panel : failed and answered, never "0 panneau"', async () => {
  reset();
  state.read = { status: 'ok', pieces: [{ name: '', height: 300, width: 300, quantity: 1 }], sheet: null };
  assert.equal(await run(), 'handled');
  answeredAsFailed();
});

test('a panel read in mm or out of range falls back to the default panel', async () => {
  reset();
  state.read = { status: 'ok', pieces: [{ name: '', height: 50, width: 40, quantity: 2 }], sheet: { height: 2800, width: 2070 } };
  await run();
  assert.deepEqual(state.completed[0].summary.sheet, { height: 278, width: 208 });
  assert.equal(state.completed[0].sheet, null);
});

test('once the read is stored, a failing result message never turns it into a failure', async () => {
  reset();
  const original = console.error;
  console.error = () => {};
  let outcome;
  try {
    outcome = await handlePhoto({
      db: {},
      config: CONFIG,
      event: event(),
      lang: 'fr',
      now: NOW,
      deliver: async (text, kind) => {
        if (kind === 'photo_result') throw new Error('outbound record failed');
        state.delivered.push({ text, kind });
        return true;
      },
    });
  } finally {
    console.error = original;
  }
  assert.equal(outcome, 'handled');
  assert.equal(state.completed.length, 1);
  assert.deepEqual(state.failed, []);
});

test('the failed-read text exists in both languages and offers the atelier', () => {
  const { ATELIER_LINK } = loadTsModule('src/lib/whatsapp/copy.ts');
  for (const lang of ['fr', 'ar']) assert.ok(PHOTO_COPY.unreadable[lang].includes(ATELIER_LINK));
});
