const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Owner, 27/11/2026: the bot's result also says how much of a panel the
// reusable offcuts make, and what they are worth at an average panel price
// (600 DH for a 278 × 208, scaled to the panel's area). A fact about this
// plan, never a promised gain (see tests/claims-audit.test.js).

const { summarizeCutList, photoResultText, photoResultCaption, photoResultCard, AVERAGE_PANEL_PRICE_MAD } =
  loadTsModule('src/lib/whatsapp/photo-summary.ts');

const piece = (height, width, quantity = 1) => ({ name: '', height, width, quantity });
const LINK = 'https://qatlia.ma/w/abcdefghij';
const base = { pieceCount: 4, lineCount: 1, sheetsUsed: 1, wastePercent: 50, sheet: { height: 278, width: 208 }, unplaced: 0 };

test('the average panel price is 600 DH', () => {
  assert.equal(AVERAGE_PANEL_PRICE_MAD, 600);
});

test('the summary measures the reusable offcuts of the plan', () => {
  // One piece of half the panel: the other half (139 × 208) is one reusable offcut.
  const summary = summarizeCutList([piece(139, 208)], null);
  assert.equal(summary.reusableM2, (139 * 208) / 10000);
});

test('offcuts narrower than 15 cm are not counted as reusable', () => {
  // 268 × 208 leaves a 10 cm strip: waste, not a reusable offcut.
  const summary = summarizeCutList([piece(268, 208)], null);
  assert.equal(summary.reusableM2 ?? 0, 0);
});

test('French: the share of a panel and its value at the average price', () => {
  const half = (278 * 208) / 2 / 10000;
  const text = photoResultText('fr', { ...base, reusableM2: half }, [piece(139, 208)], LINK);
  assert.match(text, /♻️ Chutes réutilisables : 0,5 panneau \(≈ 300 DH\)/);
});

test('Arabic: the same line, numbers kept left-to-right', () => {
  const half = (278 * 208) / 2 / 10000;
  const caption = photoResultCaption('ar', { ...base, reusableM2: half }, LINK);
  assert.match(caption, /♻️ الهدر اللي تقدر تعاود تخدم بيه: ⁦0\.5⁩ لوحة \(تقريبا ⁦300⁩ درهم\)/);
});

test('the value follows the panel size: a 244 × 122 panel is worth less than a 278 × 208', () => {
  const sheet = { height: 244, width: 122 };
  const reusableM2 = (244 * 122) / 10000; // one whole 244 × 122
  const { body } = photoResultCard('fr', { ...base, sheet, reusableM2 }, LINK);
  // 600 DH × (2.9768 / 5.7824) = 308.9 → 310 DH, to the nearest 10.
  assert.match(body, /Chutes réutilisables : 1 panneau \(≈ 310 DH\)/);
});

test('two panels and more take the plural', () => {
  const reusableM2 = (278 * 208 * 2.3) / 10000;
  const text = photoResultCaption('fr', { ...base, sheetsUsed: 5, reusableM2 }, LINK);
  assert.match(text, /Chutes réutilisables : 2,3 panneaux \(≈ 1380 DH\)/);
});

test('no line when the offcuts are under a tenth of a panel, or not measured (an older read)', () => {
  const small = photoResultCaption('fr', { ...base, reusableM2: 0.2 }, LINK);
  const older = photoResultCaption('fr', base, LINK);
  assert.doesNotMatch(small, /Chutes réutilisables/);
  assert.doesNotMatch(older, /Chutes réutilisables/);
});

test('the line states a value, never a gain', () => {
  const half = (278 * 208) / 2 / 10000;
  for (const lang of ['fr', 'ar']) {
    const text = photoResultText(lang, { ...base, reusableM2: half }, [piece(139, 208)], LINK);
    assert.doesNotMatch(text, /gagn|économis|ربح|وفّر|وفر|توفير/i);
  }
});
