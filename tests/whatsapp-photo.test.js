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
    failures: [],
    waiting: 0,
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
  failPhotoRead: async (db, id, failure) => {
    state.failed.push(id);
    state.failures.push(failure);
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
    if (kind === 'photo_waiting') return state.waiting;
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

/** The clock stands still unless a test moves it. */
function run(over = {}, lang = 'fr', clock = () => 0) {
  return handlePhoto({
    clock,
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
  assert.deepEqual(state.readCalls, [{ dataUrl: 'data:image/jpeg;base64,AAA', options: { readPanel: true, timeoutMs: 40000 } }]);
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

test('another read of this number is running : silent, no read, the photo is marked as waiting', async () => {
  reset();
  state.reservation = { status: 'busy' };
  assert.equal(await run(), 'silent');
  assert.equal(state.delivered.length, 0);
  assert.equal(state.readCalls.length, 0);
  assert.deepEqual(state.claimCalls, [
    { waId: WA, wamid: 'claim:photo_waiting:w1', direction: 'bot', kind: 'photo_waiting', body: null },
  ]);
});

// azzeadden, 23/11/2026: two sheets sent together, the plan was the first
// one's 45 pieces, and nothing said the second had not been read.
for (const lang of ['ar', 'fr']) {
  test(`photos sent with the one read (${lang}) : after the plan, one message says the plan is of one photo`, async () => {
    reset();
    state.waiting = 3;
    assert.equal(await run({}, lang), 'handled');
    assert.deepEqual(state.delivered.map((d) => d.kind), ['photo_reading', 'photo_result', 'photo_already']);
    assert.equal(state.delivered[2].text, PHOTO_COPY.others[lang]);
    const waiting = state.countCalls.find((c) => c.kind === 'photo_waiting');
    assert.equal(NOW.getTime() - waiting.since.getTime(), 5000);
  });
}

test('one photo alone : nothing after the plan', async () => {
  reset();
  await run();
  assert.deepEqual(state.delivered.map((d) => d.kind), ['photo_reading', 'photo_result']);
});

test('photos sent together, the read failed : only the failed-read text', async () => {
  reset();
  state.waiting = 1;
  state.read = { status: 'unreadable' };
  await run();
  assert.deepEqual(state.delivered.map((d) => d.kind), ['photo_reading', 'photo_failed']);
});

test('a photo that came once the read was stored got the "already read" text : not told twice', async () => {
  reset();
  state.reservation = { status: 'already', code: 'k7m2qx9dab' };
  await run({ wamid: 'w2' });
  state.reservation = { status: 'reserved', id: 'r1' };
  state.waiting = 1;
  await run();
  assert.equal(state.delivered.filter((d) => d.kind === 'photo_already').length, 1);
});

test('a failing lookup of the other photos never undoes the plan', async () => {
  reset();
  Object.defineProperty(state, 'waiting', { configurable: true, get: () => { throw new Error('db down'); } });
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal(await run(), 'handled');
  } finally {
    console.error = original;
    Object.defineProperty(state, 'waiting', { configurable: true, writable: true, enumerable: true, value: 0 });
  }
  assert.deepEqual(state.delivered.map((d) => d.kind), ['photo_reading', 'photo_result']);
  assert.deepEqual(state.failed, []);
});

test('the other-photos text: one photo read, the others in the atelier, never "send it again"', () => {
  assert.match(PHOTO_COPY.others.ar, /الورشة|فالورشة/);
  assert.match(PHOTO_COPY.others.fr, /atelier/);
  assert.doesNotMatch(PHOTO_COPY.others.ar, /عاود|سكان|الأولى/);
  assert.doesNotMatch(PHOTO_COPY.others.fr, /renvoyez|première/i);
});

// الحمد الله, 23/11/2026: a clear sheet, « take the photo again » 32 s after
// "je lis". The read gets the time the route has left, up to 40 s.
test('the read gets what is left of 45 s, at most 40 s', async () => {
  reset();
  let t = 0;
  // Entry at 0, then 12 s gone (a slow download) when the read starts.
  const clock = () => {
    const value = t;
    t = 12_000;
    return value;
  };
  await run({}, 'fr', clock);
  assert.equal(state.readCalls[0].options.timeoutMs, 33_000);
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

test('no time left : the read still has a deadline, never none', async () => {
  reset();
  let t = 0;
  const clock = () => {
    const value = t;
    t = 45_000;
    return value;
  };
  await run({}, 'fr', clock);
  assert.equal(state.readCalls[0].options.timeoutMs, 1000);
});

/** After "je lis", a failure is always answered: the failed-read text, never the (cooldown-bound) hint. */
const answeredAsFailed = (text = PHOTO_COPY.unreadable.fr) => {
  assert.deepEqual(state.delivered.map((d) => d.kind), ['photo_reading', 'photo_failed']);
  assert.equal(state.delivered[1].text, text);
  assert.deepEqual(state.failed, ['r1']);
};

for (const reason of ['lookup_refused', 'lookup_failed', 'download_failed']) {
  test(`a download ${reason} : the read is failed, and the photo is not blamed`, async () => {
    reset();
    state.media = { ok: false, reason, status: 400 };
    assert.equal(await run(), 'handled');
    answeredAsFailed(PHOTO_COPY.ourFault.fr);
    assert.equal(state.readCalls.length, 0);
    assert.equal(state.completed.length, 0);
  });
}

for (const reason of ['too_large', 'bad_type']) {
  test(`a photo refused as ${reason} : the unreadable text, as before`, async () => {
    reset();
    state.media = { ok: false, reason };
    await run();
    answeredAsFailed();
  });
}

test('a read unreadable : failed and answered as such', async () => {
  reset();
  state.read = { status: 'unreadable' };
  assert.equal(await run(), 'handled');
  answeredAsFailed();
  assert.equal(state.completed.length, 0);
});

for (const read of [
  { status: 'error', rateLimited: false, httpStatus: 0 },
  { status: 'error', rateLimited: false, httpStatus: 502 },
  { status: 'unavailable' },
]) {
  test(`a read ${read.status} ${read.httpStatus ?? ''} : failed, and the photo is not blamed`, async () => {
    reset();
    state.read = read;
    assert.equal(await run(), 'handled');
    answeredAsFailed(PHOTO_COPY.ourFault.fr);
    assert.equal(state.completed.length, 0);
  });
}

test('why a read failed, and after how long, is stored with it', async () => {
  const failureOf = async (read) => {
    reset();
    state.read = read;
    let t = 0;
    await run({}, 'fr', () => (t += 1000));
    return state.failures[0];
  };
  const timeout = await failureOf({ status: 'error', rateLimited: false, httpStatus: 0 });
  assert.equal(timeout.reason, 'read error 0');
  assert.ok(timeout.ms > 0);
  assert.equal((await failureOf({ status: 'error', rateLimited: false, httpStatus: 502 })).reason, 'read error 502');
  assert.equal((await failureOf({ status: 'unreadable' })).reason, 'read unreadable');
});

test('the our-fault text does not ask for another photo', () => {
  assert.doesNotMatch(PHOTO_COPY.ourFault.ar, /عاود صوّرها|مسطحة|دابا/);
  assert.doesNotMatch(PHOTO_COPY.ourFault.fr, /reprenez/i);
  assert.match(PHOTO_COPY.ourFault.ar, /من عندنا/);
  assert.match(PHOTO_COPY.ourFault.fr, /de notre côté/);
});

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
  answeredAsFailed(PHOTO_COPY.ourFault.fr);
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
