const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// What the bot answers after reading a cut list (plan 2026-11-19, Task 4):
// the plan computed on the panel stated on the sheet, or the atelier's
// default 278 × 208, always named; the first lines; the link.

const { summarizeCutList, photoLink, photoResultText, plausiblePanel, usablePieces } = loadTsModule('src/lib/whatsapp/photo-summary.ts');
const { PHOTO_COPY, ATELIER_LINK } = loadTsModule('src/lib/whatsapp/copy.ts');

const piece = (height, width, quantity = 1, name = '') => ({ name, height, width, quantity });
const LINK = 'https://qatlia.ma/w/k7m2qx9dab';

test('the link carries the code only (the page records the photo campaign itself)', () => {
  assert.equal(photoLink('k7m2qx9dab'), LINK);
});

test('no panel on the sheet : the default 278 × 208', () => {
  const summary = summarizeCutList([piece(50, 40, 4), piece(60, 30)], null);
  assert.deepEqual(summary.sheet, { height: 278, width: 208 });
  assert.equal(summary.pieceCount, 5);
  assert.equal(summary.lineCount, 2);
  assert.equal(summary.sheetsUsed, 1);
  assert.equal(summary.unplaced, 0);
  assert.ok(Number.isInteger(summary.wastePercent) && summary.wastePercent > 0 && summary.wastePercent < 100);
});

test('a panel stated on the sheet is the one used', () => {
  const summary = summarizeCutList([piece(120, 60, 4)], { height: 244, width: 122 });
  assert.deepEqual(summary.sheet, { height: 244, width: 122 });
  assert.equal(summary.sheetsUsed, 1);
});

test('a piece larger than the panel is counted as unplaced, never a crash', () => {
  const summary = summarizeCutList([piece(300, 50), piece(50, 40)], null);
  assert.equal(summary.unplaced, 1);
  const text = photoResultText('fr', summary, [piece(300, 50), piece(50, 40)], LINK);
  assert.match(text, /1 pièce plus grande que le panneau/);
});

// Owner, 27/11/2026: the waste percentage left the first line; the reusable
// offcuts line says what is left (tests/whatsapp-reusable-offcuts.test.js).
test('French reply : counts, panel, first five lines, the rest counted, the link', () => {
  const pieces = Array.from({ length: 14 }, (_, i) => piece(41.8, 38, 1, i === 0 ? 'Côté G' : ''));
  const summary = { pieceCount: 14, lineCount: 14, sheetsUsed: 3, wastePercent: 8, sheet: { height: 278, width: 208 }, unplaced: 0 };
  const text = photoResultText('fr', summary, pieces, LINK);
  const lines = text.split('\n');
  assert.equal(lines[0], '✅ 14 pièces lues · 3 panneaux 278×208');
  assert.doesNotMatch(text, /% de chute/);
  assert.match(text, /panneau standard/);
  assert.match(text, /Côté G 41,8 × 38 ×1 · Pièce 2 41,8 × 38 ×1 · Pièce 3 41,8 × 38 ×1 · Pièce 4 41,8 × 38 ×1 · Pièce 5 41,8 × 38 ×1 … \(\+9 autres\)/);
  assert.ok(text.endsWith(LINK));
  assert.doesNotMatch(text, /plus grande/);
});

test('French singular forms and a stated panel', () => {
  const summary = { pieceCount: 1, lineCount: 1, sheetsUsed: 1, wastePercent: 92, sheet: { height: 244, width: 122 }, unplaced: 0 };
  const text = photoResultText('fr', summary, [piece(50, 40)], LINK);
  assert.match(text.split('\n')[0], /^✅ 1 pièce lue · 1 panneau 244×122$/);
  assert.doesNotMatch(text, /standard/);
  assert.doesNotMatch(text, /autres/);
});

test('Arabic reply : labelled figures (no number agreement to get wrong), no waste percentage, numbers kept left-to-right', () => {
  const pieces = [piece(41.8, 38, 7, 'Côté G'), piece(53.1, 48, 4)];
  const summary = { pieceCount: 11, lineCount: 2, sheetsUsed: 1, wastePercent: 12, sheet: { height: 278, width: 208 }, unplaced: 1 };
  const text = photoResultText('ar', summary, pieces, LINK);
  const LRI = '⁦';
  const PDI = '⁩';
  assert.ok(text.includes(`${LRI}11${PDI}`), 'count isolated');
  assert.ok(text.includes(`${LRI}278×208${PDI}`), 'panel isolated');
  assert.ok(text.includes(`${LRI}41.8 × 38 ×7${PDI}`), 'piece sizes isolated');
  assert.doesNotMatch(text, /الهدر:|12%/, 'no waste percentage');
  assert.doesNotMatch(text, /ضياع/);
  assert.ok(text.endsWith(LINK));
  for (const word of ['pièce', 'panneau', 'chute', 'Voir', 'standard', 'autres']) {
    assert.ok(!text.includes(word), `no "${word}" in the Arabic reply`);
  }
});

test('the link line : the plan opens without an account, and the link lasts 24 hours (plan-apercu)', () => {
  const summary = { pieceCount: 1, lineCount: 1, sheetsUsed: 1, wastePercent: 92, sheet: { height: 278, width: 208 }, unplaced: 0 };
  const fr = photoResultText('fr', summary, [piece(50, 40)], LINK).split('\n').pop();
  assert.equal(fr, `👉 Voir votre plan de coupe (lien valable 24 h) : ${LINK}`);
  const ar = photoResultText('ar', summary, [piece(50, 40)], LINK).split('\n').pop();
  assert.ok(ar.includes(`${'⁦'}24${'⁩'}`), 'the 24 kept left-to-right');
  assert.match(ar, /ساعة/);
  assert.doesNotMatch(ar, /التسجيل/);
  assert.ok(ar.endsWith(LINK));
});

test('a panel outside 30–400 cm (read in mm, or nonsense) is not trusted', () => {
  assert.deepEqual(plausiblePanel({ height: 244, width: 122 }), { height: 244, width: 122 });
  assert.equal(plausiblePanel({ height: 2800, width: 2070 }), null);
  assert.equal(plausiblePanel({ height: 20, width: 122 }), null);
  assert.equal(plausiblePanel(null), null);
});

test('only pieces with finite positive sizes are kept', () => {
  const kept = usablePieces([piece(50, 40), piece(NaN, 40), piece(50, 0), piece(Infinity, 3), piece(-2, 3), piece(12, 8, 3)]);
  assert.deepEqual(kept, [piece(50, 40), piece(12, 8, 3)]);
});

test('the waiting and "already read" texts exist in both languages, with the links', () => {
  for (const lang of ['fr', 'ar']) {
    assert.ok(PHOTO_COPY.reading[lang].includes('📸'));
    const withLink = PHOTO_COPY.already(lang, LINK);
    assert.ok(withLink.includes(LINK) && withLink.includes(ATELIER_LINK));
    const withoutLink = PHOTO_COPY.already(lang, null);
    assert.ok(!withoutLink.includes('qatlia.ma/w/') && withoutLink.includes(ATELIER_LINK));
  }
});

// Owner, 22/11/2026: « Si la taille du panneau est spécifiée, c'est bon. Sinon,
// on doit prendre la taille des panneaux qui peuvent contenir la taille des
// pièces. » محمد's sheet: strips of 280 cm, no panel written; on the default
// 278 × 208 none of them fitted.
test('no panel on the sheet and pieces too long for 278 × 208: the 280 × 207 format of the catalogue', () => {
  const pieces = [piece(280, 30, 2), piece(280, 60, 2), piece(280, 10, 8)];
  const summary = summarizeCutList(pieces, null);
  assert.deepEqual(summary.sheet, { height: 280, width: 207 });
  assert.equal(summary.unplaced, 0);
  assert.equal(summary.fitted, true);
  const ar = photoResultText('ar', summary, pieces, LINK);
  assert.match(ar, /لوحة ⁦280×207⁩ حيت القطع طوال/);
  const fr = photoResultText('fr', summary, pieces, LINK);
  assert.match(fr, /panneau 280×207 choisi pour la longueur des pièces/);
  assert.doesNotMatch(fr, /panneau standard/);
});

test('a panel written on the sheet always wins, even if a piece is longer', () => {
  const summary = summarizeCutList([piece(250.5, 57), piece(100, 50)], { height: 244, width: 122 });
  assert.deepEqual(summary.sheet, { height: 244, width: 122 });
  assert.equal(summary.unplaced, 1);
  assert.equal(summary.fitted, undefined);
});

test('pieces no standard panel holds: the default, with the oversize count', () => {
  const summary = summarizeCutList([piece(320, 50), piece(50, 40)], null);
  assert.deepEqual(summary.sheet, { height: 278, width: 208 });
  assert.equal(summary.unplaced, 1);
  assert.equal(summary.fitted, undefined);
});

test('a piece fits turned: 210 × 150 needs no other panel than 278 × 208', () => {
  const summary = summarizeCutList([piece(150, 210)], null);
  assert.deepEqual(summary.sheet, { height: 278, width: 208 });
});
