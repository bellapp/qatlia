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
    kind: null,
    classifyCalls: [],
    alreadyCount: 0,
    countCalls: [],
    claims: new Set(),
    claimCalls: [],
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
  classifyPhoto: async (dataUrl, options) => {
    state.classifyCalls.push({ dataUrl, options });
    return state.kind;
  },
});
stubModule('@/lib/whatsapp/store', {
  countBotMessages: async (db, waId, kind, since) => {
    state.countCalls.push({ kind, since });
    return state.alreadyCount;
  },
  // whatsapp_messages.wamid is unique: the first insert of a claim wins.
  recordOutbound: async (db, row) => {
    state.claimCalls.push(row);
    if (state.claims.has(row.wamid)) return false;
    state.claims.add(row.wamid);
    return true;
  },
});

const { handlePhoto } = loadTsModule('src/lib/whatsapp/photo.ts');
const { PHOTO_COPY } = loadTsModule('src/lib/whatsapp/copy.ts');
const { photoLink } = loadTsModule('src/lib/whatsapp/photo-summary.ts');

const WA = '212600000001';
const NOW = new Date('2026-11-19T12:00:00Z');
const CONFIG = { photoDailyCap: 300, accessToken: 't', graphVersion: 'v23.0' };
const event = (over = {}) => ({ type: 'inbound', wamid: 'w1', waId: WA, profileName: null, kind: 'image', text: null, referral: null, mediaId: 'M1', ...over });

function run(over = {}, lang = 'fr', clock) {
  return handlePhoto({
    ...(clock ? { clock } : {}),
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

// anas, 20/11/2026: five photos at once got four identical « الورقة الأولى
// ديالك تقرات » in two seconds. Each passed the 10-minute check before any
// answer was stored; a claim on the unique wamid lets one answer through.
test('photos arriving together get one "already read" answer, not one each', async () => {
  reset();
  state.reservation = { status: 'already', code: 'k7m2qx9dab' };
  const outcomes = await Promise.all([run(), run(), run(), run(), run()]);
  assert.equal(state.delivered.length, 1);
  assert.deepEqual(outcomes.filter((o) => o === 'handled').length, 1);
  assert.deepEqual(outcomes.filter((o) => o === 'silent').length, 4);
  const claim = state.claimCalls[0];
  assert.equal(claim.direction, 'bot');
  assert.equal(claim.kind, 'photo_already_claim');
  assert.match(claim.wamid, new RegExp(`^claim:photo_already:${WA}:\\d+$`));
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

// 23/11/2026: a hand drawing of a kitchen and a photo of a fitted kitchen got
// « take the photo again »; the prospects resent nothing. A read with no
// pieces asks what the photo showed; the read is freed so typed pieces can be planned.
for (const kind of ['drawing', 'furniture']) {
  for (const lang of ['ar', 'fr']) {
    test(`a ${kind} instead of a list (${lang}) : the read is freed and the bot asks for the pieces`, async () => {
      reset();
      state.read = { status: 'unreadable' };
      state.kind = kind;
      assert.equal(await run({}, lang), 'handled');
      assert.deepEqual(state.classifyCalls, [{ dataUrl: 'data:image/jpeg;base64,AAA', options: { timeoutMs: 8000 } }]);
      assert.deepEqual(state.delivered.map((d) => d.kind), ['photo_reading', 'photo_failed']);
      assert.equal(state.delivered[1].text, PHOTO_COPY.notAList[kind][lang]);
      assert.deepEqual(state.failed, ['r1']);
    });
  }
}

test('a read with no pieces that is not a drawing : the unreadable text, as before', async () => {
  reset();
  state.read = { status: 'unreadable' };
  state.kind = null;
  await run();
  assert.equal(state.classifyCalls.length, 1);
  answeredAsFailed();
});

test('a read that failed (error, unavailable) or a list read : no classification', async () => {
  for (const read of [{ status: 'error', rateLimited: false, httpStatus: 502 }, { status: 'unavailable' }, { status: 'ok', pieces: [{ name: '', height: 50, width: 40, quantity: 2 }], sheet: null }]) {
    reset();
    state.read = read;
    state.kind = 'drawing';
    await run();
    assert.equal(state.classifyCalls.length, 0, read.status);
  }
});

test('a read with no pieces after more than 30 s : no classification, the unreadable text', async () => {
  reset();
  state.read = { status: 'unreadable' };
  state.kind = 'drawing';
  let t = 0;
  const clock = () => {
    const value = t;
    t += 31_000;
    return value;
  };
  await run({}, 'fr', clock);
  assert.equal(state.classifyCalls.length, 0);
  answeredAsFailed();
});

test('the not-a-list texts ask for the pieces typed in one message, never a new photo', () => {
  for (const kind of ['drawing', 'furniture']) {
    assert.match(PHOTO_COPY.notAList[kind].ar, /ميساج واحد/);
    assert.match(PHOTO_COPY.notAList[kind].ar, /60x40x2/);
    assert.doesNotMatch(PHOTO_COPY.notAList[kind].ar, /عاود|سكان/);
    assert.match(PHOTO_COPY.notAList[kind].fr, /un seul message/);
    assert.match(PHOTO_COPY.notAList[kind].fr, /60x40x2/);
    assert.doesNotMatch(PHOTO_COPY.notAList[kind].fr, /reprenez|renvoyez/i);
  }
  assert.match(PHOTO_COPY.notAList.drawing.ar, /رسم/);
  assert.match(PHOTO_COPY.notAList.furniture.ar, /تصويرة ديال/);
});

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

// Raised from 300 to 900 pieces (owner, 21/11/2026), and answered with the
// count rather than the unreadable text: tests/whatsapp-photo-big-list.test.js.
test('a list over 900 pieces is not taken: freed and answered with its count, no summary', async () => {
  reset();
  state.read = { status: 'ok', pieces: [{ name: '', height: 50, width: 40, quantity: 901 }], sheet: null };
  assert.equal(await run(), 'handled');
  assert.deepEqual(state.failed, ['r1']);
  assert.deepEqual(state.delivered.map((d) => d.kind), ['photo_reading', 'photo_failed']);
  assert.equal(state.delivered[1].text, PHOTO_COPY.tooBig('fr', 901));
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

test('the failed-read text exists in both languages and asks for a new photo here', () => {
  // A failed read frees the number (failPhotoRead): the next photo is read again.
  assert.match(PHOTO_COPY.unreadable.fr, /renvoyez-la-moi ici/);
  assert.match(PHOTO_COPY.unreadable.ar, /صيفطها ليا هنا/);
});
