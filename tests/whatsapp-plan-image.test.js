const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');

// The bot answers a read cut list with a picture of the plan rather than a
// list of numbers (owner, 21/11/2026): a "screenshot" of the atelier's result
// screen (owner, same day) with the first panel drawn as the atelier draws it;
// the caption gives the counts and the link to the whole plan (all panels,
// PDF), which stays behind sign-up.

const ROOT = path.resolve(__dirname, '..');
const load = (rel) => loadTsModule(path.join(ROOT, rel));
const { planImageLayout, planImageUrl, PLAN_IMAGE_WIDTH } = load('src/lib/whatsapp/plan-image.ts');
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
  }
});

/** The sheet of 21/11/2026 (hamouda), as the bot stores it. */
const HAMOUDA = [
  [211, 48, 32], [211, 38, 16], [160, 48, 30], [150, 48, 2], [207.5, 78, 30], [207.5, 73, 2], [72.3, 38, 6],
  [77.3, 38, 180], [155, 9, 3], [145, 9, 2], [228, 9, 32], [215, 160, 15], [215, 150, 1],
].map(([height, width, quantity]) => ({ name: '', height, width, quantity }));
const hamoudaPlan = () => photoPreviewPlan({ pieces: HAMOUDA, sheet: { height: 278, width: 208 } });

// "The same display as in the application" (owner, 21/11/2026): the atelier's
// plan (src/app/(site)/atelier/page.tsx) draws "#N" and « H×W cm » on each
// piece, in its palette, and hatches the offcuts with their size.
test('each piece is drawn as in the atelier: its color, "#N" and its size in cm', () => {
  const { PIECE_COLOR_PALETTE } = load('src/lib/pieces/catalog.ts');
  const plan = photoPreviewPlan(draft);
  const layout = planImageLayout(plan);
  plan.sheets[0].pieces.forEach((placed, i) => {
    const piece = layout.pieces[i];
    // The atelier: the piece's own color, the palette by number only without one.
    assert.equal(piece.color, placed.color || PIECE_COLOR_PALETTE[(placed.pieceNumber - 1) % PIECE_COLOR_PALETTE.length]);
    assert.ok(placed.color, 'every WhatsApp piece has its line color');
    assert.equal(piece.number, `#${placed.pieceNumber}`);
    assert.equal(piece.size, `${placed.height.toFixed(1)}×${placed.width.toFixed(1)} cm`);
  });
});

// « Pourquoi différentes couleurs pour le même type de pièce ? » (owner,
// 21/11/2026): in the atelier every line has one color (the swatch of its row,
// getResolvedPieceColor) and its copies share it on the plan. The WhatsApp
// pieces had none, so the plan colored each copy by its number.
test('every copy of a line wears the color the atelier gives that line', () => {
  const { getResolvedPieceColor } = load('src/lib/pieces/catalog.ts');
  const { atelierPieces } = load('src/lib/whatsapp/photo-summary.ts');
  const sheet = { height: 278, width: 208 };
  const pieces = atelierPieces({ pieces: HAMOUDA, sheet });
  pieces.forEach((piece, index) => {
    assert.equal(
      piece.color,
      getResolvedPieceColor({ id: piece.id, name: piece.name, height: piece.height, width: piece.width, quantity: piece.quantity, index }),
    );
  });
  const plan = hamoudaPlan();
  const layout = planImageLayout(plan);
  const byLine = new Map();
  plan.sheets[0].pieces.forEach((placed, i) => {
    const color = layout.pieces[i].color;
    assert.equal(color, pieces[placed.originalIndex].color);
    if (byLine.has(placed.originalIndex)) assert.equal(byLine.get(placed.originalIndex), color, 'one color per line');
    byLine.set(placed.originalIndex, color);
  });
  // The 228 × 9 strips of line 11: all the same color.
  assert.equal(new Set(layout.pieces.filter((p) => p.size === null).map((p) => p.color)).size, 1);
});

test('the atelier font rules, scaled: a piece under 10 cm shows its number only', () => {
  const layout = planImageLayout(hamoudaPlan());
  const plan = hamoudaPlan();
  const s = layout.scale;
  plan.sheets[0].pieces.forEach((placed, i) => {
    const piece = layout.pieces[i];
    const minSide = Math.min(placed.width, placed.height);
    const near = (a, b) => Math.abs(a - b) < 0.2;
    assert.ok(near(piece.numberFont, Math.min(5.5, Math.max(2.5, minSide / 12)) * s), 'number font');
    assert.ok(near(piece.sizeFont, Math.min(4.5, Math.max(2, minSide / 14)) * s), 'size font');
    assert.equal(piece.size === null, minSide < 10);
  });
  // The 228 × 9 strips: their number, no size, as in the atelier.
  assert.ok(layout.pieces.some((p) => p.size === null));
  assert.ok(layout.pieces.some((p) => p.size === '160.0×48.0 cm' || p.size === '48.0×160.0 cm'));
});

test('the offcuts of the panel are drawn with their size from 14 × 10 cm', () => {
  const plan = hamoudaPlan();
  const layout = planImageLayout(plan);
  const offcuts = plan.sheets[0].offcuts;
  assert.ok(offcuts.length > 0, 'the fixture leaves offcuts');
  assert.equal(layout.offcuts.length, offcuts.length);
  offcuts.forEach((offcut, i) => {
    const expected = offcut.width >= 14 && offcut.height >= 10 ? `${offcut.height.toFixed(1)} × ${offcut.width.toFixed(1)} cm` : null;
    assert.equal(layout.offcuts[i].size, expected);
  });
});

// « Garde ce format d'envoi sous forme de capture d'écran du résultat »
// (owner, 21/11/2026, on a screenshot of the atelier): the picture is the
// atelier's result screen, top to bottom: the cost banner, the panel tabs with
// their yield, the plan of panel 1, the export buttons. French, as on that screen.
test('the picture is the atelier result screen: cost banner, panel tabs, plan, exports', () => {
  const plan = hamoudaPlan();
  const layout = planImageLayout(plan);

  assert.deepEqual(layout.banner, {
    label: 'COÛT TOTAL ESTIMÉ',
    amount: '32 612,83',
    currency: 'MAD',
    meta: '641,9 m linéaires de coupe · 47 panneaux',
  });

  // One chip per panel, "Panneau N" and its yield (100 − waste, rounded, as
  // SheetTabs), the first one active; as many as the row holds, then "›".
  const { tabs } = layout;
  assert.ok(tabs.length >= 4 && tabs.length < plan.sheetsUsed, `${tabs.length} chips`);
  assert.ok(layout.moreTabs);
  tabs.forEach((tab, i) => {
    assert.equal(tab.label, `Panneau ${i + 1}`);
    assert.equal(tab.yield, Math.max(0, Math.min(100, Math.round(100 - plan.sheets[i].wasteRate))));
    assert.equal(tab.active, i === 0);
    assert.ok(tab.left + tab.width <= layout.width - 40, 'every chip fits the row');
  });
  assert.equal(tabs[0].yield, 95);

  assert.deepEqual(layout.exports, {
    files: ['CSV', 'JSON', 'PNG', 'DXF'],
    pdf: 'Exporter le rapport PDF',
    quote: 'Devis client',
  });

  // Top to bottom, inside the picture.
  assert.ok(layout.bannerBox.top + layout.bannerBox.height <= layout.tabsTop);
  assert.ok(tabs[0].top + tabs[0].height <= layout.panel.top);
  assert.ok(layout.panel.top + layout.panel.height <= layout.exportsTop);
  assert.ok(layout.exportsTop < layout.height);
});

test('a plan without a price shows a dash, as the atelier does', () => {
  const plan = { ...hamoudaPlan(), costBreakdown: undefined };
  assert.equal(planImageLayout(plan).banner.amount, '—');
  const single = photoPreviewPlan({ pieces: [{ name: '', height: 50, width: 40, quantity: 1 }], sheet: { height: 278, width: 208 } });
  const layout = planImageLayout(single);
  assert.match(layout.banner.meta, / · 1 panneau$/);
  assert.equal(layout.moreTabs, false);
  assert.equal(layout.tabs.length, 1);
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
