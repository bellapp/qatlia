const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');

// A clear sheet of 319 pieces got "ما قدرتش نقرا هاد الورقة" (21/11/2026): the
// bot refused lists over 300 pieces with the unreadable text. The owner wants
// lists up to 900 pieces. The plan takes ~1.5 s for 319 pieces but ~40 s for
// 900, more than the webhook has left after the read: up to 450 pieces the bot
// plans as before; from 451 to 900 it stores the list and sends the link, and
// the atelier plans it after sign-up; over 900 it says so, never "unreadable".

const state = {};
function reset(pieces) {
  Object.assign(state, { pieces, completed: [], failed: [], delivered: [] });
}

stubModule('@/lib/whatsapp/photo-store', {
  reservePhotoRead: async () => ({ status: 'reserved', id: 'r1' }),
  completePhotoRead: async (db, id, result) => state.completed.push(result),
  failPhotoRead: async (db, id) => state.failed.push(id),
  newPhotoCode: () => 'k7m2qx9dab',
});
stubModule('@/lib/whatsapp/media', {
  fetchMediaDataUrl: async () => ({ ok: true, dataUrl: 'data:image/jpeg;base64,AAA', mimeType: 'image/jpeg', bytes: 3 }),
});
stubModule('@/lib/vision/read-cut-list', {
  readCutList: async () => ({ status: 'ok', pieces: state.pieces, sheet: null }),
});
stubModule('@/lib/whatsapp/store', { countBotMessages: async () => 0 });

const ROOT = path.resolve(__dirname, '..');
const { handlePhoto, MAX_BOT_PIECES } = loadTsModule(path.join(ROOT, 'src/lib/whatsapp/photo.ts'));
const { PHOTO_COPY, ATELIER_LINK } = loadTsModule(path.join(ROOT, 'src/lib/whatsapp/copy.ts'));
const { BOT_PLAN_MAX_PIECES, photoLink, previewPlanFor } = loadTsModule(path.join(ROOT, 'src/lib/whatsapp/photo-summary.ts'));

/** The sheet of 21/11/2026: 319 pieces, "longueur × largeur = nombre". */
const HAMOUDA = [
  [211, 38, 16], [160, 48, 30], [150, 48, 2], [207.5, 78, 30], [207.5, 73, 2], [72.3, 38, 6],
  [77.3, 38, 180], [155, 9, 3], [145, 9, 2], [228, 9, 32], [215, 160, 15], [215, 150, 1],
].map(([height, width, quantity]) => ({ name: '', height, width, quantity }));

const lines = (total) => [{ name: '', height: 50, width: 40, quantity: total }];

function run(lang = 'ar') {
  return handlePhoto({
    db: {},
    config: { photoDailyCap: 300, accessToken: 't', graphVersion: 'v23.0' },
    event: { type: 'inbound', wamid: 'w1', waId: '212600000001', profileName: null, kind: 'image', text: null, referral: null, mediaId: 'M1' },
    lang,
    now: new Date('2026-11-21T09:00:00Z'),
    deliver: async (text, kind) => {
      state.delivered.push({ text, kind });
      return true;
    },
  });
}

test('the limits: 900 pieces read, 450 planned by the bot', () => {
  assert.equal(MAX_BOT_PIECES, 900);
  assert.equal(BOT_PLAN_MAX_PIECES, 450);
});

test('the 319-piece sheet of 21/11 now gets its plan', async () => {
  reset(HAMOUDA);
  assert.equal(await run(), 'handled');
  assert.deepEqual(state.failed, []);
  assert.equal(state.completed.length, 1);
  assert.equal(state.completed[0].summary.pieceCount, 319);
  assert.ok(state.completed[0].summary.sheetsUsed > 0, 'planned');
  assert.deepEqual(state.delivered.map((d) => d.kind), ['photo_reading', 'photo_result']);
  assert.match(state.delivered[1].text, /اللوحات/);
});

test('451 to 900 pieces: stored and linked without a plan, never "unreadable"', async () => {
  for (const [total, lang] of [[451, 'ar'], [900, 'fr']]) {
    reset(lines(total));
    assert.equal(await run(lang), 'handled');
    assert.deepEqual(state.failed, []);
    assert.equal(state.completed.length, 1, 'stored, so the link opens the atelier on the pieces');
    const { summary } = state.completed[0];
    assert.equal(summary.pieceCount, total);
    assert.equal(summary.sheetsUsed, 0, 'no plan computed in the webhook');
    const answer = state.delivered[1];
    assert.equal(answer.kind, 'photo_result');
    assert.ok(answer.text.endsWith(photoLink('k7m2qx9dab')));
    assert.ok(answer.text.includes(String(total)));
    assert.notEqual(answer.text, PHOTO_COPY.unreadable[lang]);
    assert.doesNotMatch(answer.text, /chute|الهدر|الشوت|0 panneau/);
  }
});

test('over 900 pieces: the count and the atelier, never "unreadable"', async () => {
  for (const lang of ['ar', 'fr']) {
    reset(lines(901));
    assert.equal(await run(lang), 'handled');
    assert.deepEqual(state.failed, ['r1'], 'the number is freed, as for any read that does not end in a link');
    assert.equal(state.completed.length, 0);
    const answer = state.delivered[1];
    assert.equal(answer.kind, 'photo_failed');
    assert.equal(answer.text, PHOTO_COPY.tooBig(lang, 901));
    assert.notEqual(answer.text, PHOTO_COPY.unreadable[lang]);
    assert.ok(answer.text.includes('901') && answer.text.includes(ATELIER_LINK));
    assert.doesNotMatch(answer.text, /سكان|scann/i);
  }
});

test('the link page computes its free preview only for a list the bot planned', () => {
  const small = { pieces: HAMOUDA, sheet: { height: 278, width: 208 } };
  const big = { pieces: lines(451), sheet: { height: 278, width: 208 } };
  assert.ok(previewPlanFor(small).sheetsUsed > 0);
  assert.equal(previewPlanFor(big), null, 'the atelier plans it after sign-up');
  const page = fs.readFileSync(path.join(ROOT, 'src/app/(site)/w/[code]/page.tsx'), 'utf8');
  assert.match(page, /preview=\{previewPlanFor\(draft\)\}/);
  const open = fs.readFileSync(path.join(ROOT, 'src/app/(site)/w/[code]/OpenInAtelier.tsx'), 'utf8');
  assert.match(open, /preview: OptimizationResult \| null/);
});
