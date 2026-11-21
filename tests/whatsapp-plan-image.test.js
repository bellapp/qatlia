const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');

// The bot answers a read cut list with a picture of the plan rather than a
// list of numbers (owner, 21/11/2026): the first panel, its pieces in color,
// each with its size and its line on the sheet (owner, same day, after seeing
// the first version without them), "1 / N"; the caption gives the counts and
// the link to the whole plan (all panels, PDF), which stays behind sign-up.

const ROOT = path.resolve(__dirname, '..');
const load = (rel) => loadTsModule(path.join(ROOT, rel));
const { planImageLayout, planImageUrl, PLAN_IMAGE_WIDTH, PLAN_COLORS } = load('src/lib/whatsapp/plan-image.ts');
const { photoResultCaption, photoResultText, summarizeCutList, photoPreviewPlan } = load('src/lib/whatsapp/photo-summary.ts');

const PIECES = [
  { name: 'Côté', height: 200, width: 60, quantity: 2 },
  { name: 'Étagère', height: 80, width: 58, quantity: 6 },
  { name: '', height: 150, width: 100, quantity: 2 },
];
const draft = { pieces: PIECES, sheet: { height: 278, width: 208 } };

test('the image link sits under the plan link, on the site', () => {
  assert.equal(planImageUrl('k7m2qx9dab'), 'https://qatlia.ma/w/k7m2qx9dab/plan.png');
});

test('the layout draws the first panel only, to scale, every piece inside it', () => {
  const result = photoPreviewPlan(draft);
  assert.ok(result.sheetsUsed >= 2, 'the fixture needs more than one panel');
  const layout = planImageLayout(result);
  assert.equal(layout.width, PLAN_IMAGE_WIDTH);
  assert.equal(layout.sheetCount, result.sheetsUsed);
  assert.equal(layout.pieces.length, result.sheets[0].pieces.length);
  const { panel } = layout;
  assert.ok(Math.abs(panel.width / panel.height - 208 / 278) < 0.01, 'the panel keeps its proportions');
  assert.ok(panel.left >= 0 && panel.left + panel.width <= layout.width);
  assert.ok(panel.top + panel.height < layout.height, 'room under the panel for the footer');
  for (const piece of layout.pieces) {
    assert.ok(piece.left >= panel.left - 0.01 && piece.left + piece.width <= panel.left + panel.width + 0.01);
    assert.ok(piece.top >= panel.top - 0.01 && piece.top + piece.height <= panel.top + panel.height + 0.01);
    assert.ok(PLAN_COLORS.includes(piece.color));
  }
});

test('copies of one line share a color, different lines get different ones', () => {
  const layout = planImageLayout(photoPreviewPlan(draft));
  const sheet = photoPreviewPlan(draft).sheets[0];
  const byLine = new Map();
  sheet.pieces.forEach((placed, i) => {
    const color = layout.pieces[i].color;
    if (byLine.has(placed.originalIndex)) assert.equal(byLine.get(placed.originalIndex), color);
    byLine.set(placed.originalIndex, color);
  });
  assert.ok(new Set(byLine.values()).size === byLine.size, 'one color per line');
});

/** The sheet of 21/11/2026 (hamouda), as the bot stores it. */
const HAMOUDA = [
  [211, 48, 32], [211, 38, 16], [160, 48, 30], [150, 48, 2], [207.5, 78, 30], [207.5, 73, 2], [72.3, 38, 6],
  [77.3, 38, 180], [155, 9, 3], [145, 9, 2], [228, 9, 32], [215, 160, 15], [215, 150, 1],
].map(([height, width, quantity]) => ({ name: '', height, width, quantity }));
const hamoudaPlan = () => photoPreviewPlan({ pieces: HAMOUDA, sheet: { height: 278, width: 208 } });

test('every piece shows its line on the sheet and its size, as written on the sheet', () => {
  const plan = hamoudaPlan();
  const layout = planImageLayout(plan);
  plan.sheets[0].pieces.forEach((placed, i) => {
    const { label } = layout.pieces[i];
    assert.ok(label, 'labelled');
    assert.equal(label.line, placed.originalIndex + 1);
    const { height, width } = HAMOUDA[placed.originalIndex];
    assert.equal(label.size, `${height} × ${width}`);
  });
  // The 228 × 9 strips of line 11 stand upright: their label turns with them.
  const strip = layout.pieces.find((p) => p.label && p.label.line === 11);
  assert.ok(strip, 'line 11 is on the first panel');
  assert.equal(strip.label.vertical, true);
});

test('the label fits its piece, in a readable size', () => {
  for (const piece of planImageLayout(hamoudaPlan()).pieces) {
    const { label } = piece;
    assert.ok(label.fontSize >= 12 && label.fontSize <= 34, String(label.fontSize));
    const long = label.vertical ? piece.height : piece.width;
    const thick = label.vertical ? piece.width : piece.height;
    const chars = String(label.line).length + (label.size ? label.size.length : 0);
    assert.ok(chars * 0.6 * label.fontSize < long, 'fits the length');
    assert.ok(label.fontSize < thick, 'fits the thickness');
  }
});

test('a piece too small for its size keeps its line, and one too small for anything stays plain', () => {
  const { pieceLabel } = load('src/lib/whatsapp/plan-image.ts');
  assert.equal(pieceLabel(4, '50 × 40', 230, 184).size, '50 × 40');
  const lineOnly = pieceLabel(4, '50 × 40', 40, 24);
  assert.equal(lineOnly.line, 4);
  assert.equal(lineOnly.size, null);
  assert.equal(pieceLabel(4, '50 × 40', 10, 10), null);
  assert.equal(pieceLabel(4, '207.5 × 78', 100, 900).vertical, true);
});

test('sizes read like the sheet: one decimal at most, a dot', () => {
  const { pieceSize } = load('src/lib/whatsapp/plan-image.ts');
  assert.equal(pieceSize(207.5, 78), '207.5 × 78');
  assert.equal(pieceSize(72.33333, 38), '72.3 × 38');
  assert.equal(pieceSize(211, 48), '211 × 48');
});

test('the panel count and the brand stay under the panel', () => {
  const layout = planImageLayout(photoPreviewPlan(draft));
  assert.equal(layout.badge, `1 / ${layout.sheetCount}`);
});

test('the picture is tried only while the webhook has time left for the text answer', () => {
  const { pictureCheckMs, PICTURE_DEADLINE_MS } = load('src/lib/whatsapp/plan-image.ts');
  assert.equal(PICTURE_DEADLINE_MS, 45000);
  assert.equal(pictureCheckMs(0), 8000);
  assert.equal(pictureCheckMs(30000), 8000);
  assert.equal(pictureCheckMs(40000), 5000);
  assert.equal(pictureCheckMs(43500), null, 'under 2 s left: text');
  assert.equal(pictureCheckMs(60000), null);
  assert.equal(pictureCheckMs(Number.NaN), null);
  const route = fs.readFileSync(path.join(ROOT, 'src/app/api/whatsapp/webhook/route.ts'), 'utf8');
  assert.match(route, /pictureCheckMs\(Date\.now\(\) - startedAt\.getTime\(\)\)/);
  assert.match(route, /deliverPicture\(db, config, waId, link, caption, kind, now\)/);
});

test('no panel, no layout', () => {
  assert.equal(planImageLayout({ sheetsUsed: 0, sheets: [] }), null);
});

test('the caption keeps the counts and the link, drops the list of pieces', () => {
  const summary = summarizeCutList(PIECES, null);
  const link = 'https://qatlia.ma/w/k7m2qx9dab';
  const fr = photoResultCaption('fr', summary, link);
  const ar = photoResultCaption('ar', summary, link);
  const text = photoResultText('fr', summary, PIECES, link);
  assert.equal(fr.split('\n')[0], text.split('\n')[0], 'same first line as the text answer');
  assert.ok(fr.endsWith(link) && ar.endsWith(link));
  assert.doesNotMatch(fr, /Côté|Étagère/);
  assert.match(fr, /👆/);
  assert.match(fr, /24 h/);
  assert.match(ar, /تقرات/);
  assert.match(ar, /شوفو كامل/);
  // Simple words (bot-simple-words): no jargon in what the artisan reads.
  for (const caption of [fr, ar]) {
    assert.doesNotMatch(caption, /PDF|optimis|scann|سكان/i);
    assert.ok(caption.length <= 1024, 'WhatsApp caption limit');
  }
});

// --- The photo flow sends the picture, the text only when the picture fails ---

const sent = { images: [], texts: [], imageOk: true, pieces: null };
stubModule('@/lib/whatsapp/photo-store', {
  reservePhotoRead: async () => ({ status: 'reserved', id: 'r1' }),
  completePhotoRead: async () => {},
  failPhotoRead: async () => {},
  newPhotoCode: () => 'k7m2qx9dab',
});
stubModule('@/lib/whatsapp/media', {
  fetchMediaDataUrl: async () => ({ ok: true, dataUrl: 'data:image/jpeg;base64,AAA', mimeType: 'image/jpeg', bytes: 3 }),
});
stubModule('@/lib/vision/read-cut-list', {
  readCutList: async () => ({ status: 'ok', pieces: sent.pieces ?? PIECES, sheet: null }),
});
stubModule('@/lib/whatsapp/store', { countBotMessages: async () => 0 });
const { handlePhoto } = load('src/lib/whatsapp/photo.ts');

function run(lang = 'fr') {
  sent.images = [];
  sent.texts = [];
  return handlePhoto({
    db: {},
    config: { photoDailyCap: 300, accessToken: 't', graphVersion: 'v23.0' },
    event: { type: 'inbound', wamid: 'w1', waId: '212600000001', profileName: null, kind: 'image', text: null, referral: null, mediaId: 'M1' },
    lang,
    now: new Date('2026-11-21T12:00:00Z'),
    deliver: async (text, kind) => {
      sent.texts.push({ text, kind });
      return true;
    },
    deliverImage: async (link, caption, kind) => {
      sent.images.push({ link, caption, kind });
      return sent.imageOk;
    },
  });
}

test('a read photo is answered with the plan picture and its caption', async () => {
  sent.imageOk = true;
  assert.equal(await run('ar'), 'handled');
  assert.deepEqual(sent.texts.map((t) => t.kind), ['photo_reading']);
  assert.equal(sent.images.length, 1);
  assert.equal(sent.images[0].link, 'https://qatlia.ma/w/k7m2qx9dab/plan.png');
  assert.equal(sent.images[0].kind, 'photo_result');
  assert.equal(sent.images[0].caption, photoResultCaption('ar', summarizeCutList(PIECES, null), 'https://qatlia.ma/w/k7m2qx9dab'));
});

test('a list too long for the bot to plan gets no picture, only its text', async () => {
  sent.imageOk = true;
  sent.pieces = [{ name: '', height: 50, width: 40, quantity: 451 }];
  try {
    await run('ar');
  } finally {
    sent.pieces = null;
  }
  assert.equal(sent.images.length, 0);
  assert.deepEqual(sent.texts.map((t) => t.kind), ['photo_reading', 'photo_result']);
  assert.match(sent.texts[1].text, /لائحة كبيرة/);
});

test('when the picture cannot go out, the text answer goes instead', async () => {
  sent.imageOk = false;
  await run('fr');
  assert.equal(sent.images.length, 1);
  assert.deepEqual(sent.texts.map((t) => t.kind), ['photo_reading', 'photo_result']);
  assert.match(sent.texts[1].text, /Côté/);
});

// --- The image route ------------------------------------------------------

test('the image route never counts as an opening, and stamps the sRGB profile', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/app/(site)/w/[code]/plan.png/route.ts'), 'utf8');
  assert.match(source, /markOpened: false/);
  assert.match(source, /isPhotoCode\(/);
  assert.match(source, /withSrgbProfile\(/);
  assert.match(source, /previewPlanFor\(draft\)/, 'no plan drawn for a list over 450 pieces');
  assert.match(source, /'Content-Type': 'image\/png'/);
  assert.match(source, /'Cache-Control': 'no-store'/);
  assert.match(source, /status: 404/);
});

test('the link page shows the plan picture in its WhatsApp preview', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/app/(site)/w/[code]/page.tsx'), 'utf8');
  assert.match(source, /export function generateMetadata/);
  assert.match(source, /planImageUrl\(params\.code\)/);
});
