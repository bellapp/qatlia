const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadSheetTabs, renderSheetTabs } = require('./helpers/render-sheet-tabs');

// User request, 2026-11-14: improve the tabs of the cutting plan. On a phone
// "Panneau 1 2%" wrapped into "Panneau / 1 2%", which read as 12%; the figure
// was the waste rate with no label while the stats show the yield; and with
// more panels than fit, the active tab sat off-screen.

/** The chips of the rendered markup, as `{ attributes, body }`. */
function chips(html) {
  return [...html.matchAll(/<button([^>]*data-sheet-tab="\d+"[^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({
    attributes: match[1],
    body: match[2],
  }));
}

const attribute = (attributes, name) => (attributes.match(new RegExp(`${name}="([^"]*)"`)) || [])[1];

test('a chip shows the yield of its panel, the figure the stats call Rendement', () => {
  const { sheetYield } = loadSheetTabs();

  // The stats print round(100 - wastePercentage); a chip does the same per panel.
  assert.equal(sheetYield(2.4), 98);
  assert.equal(sheetYield(57.6), 42);
  assert.equal(sheetYield(0), 100);
  assert.equal(sheetYield(130), 0);
  assert.equal(sheetYield(undefined), 100);

  const rendered = chips(renderSheetTabs({ wasteRates: [2.4, 3, 5, 57.6], activeIndex: 0 }));
  assert.deepEqual(
    rendered.map((chip) => (chip.body.match(/>(\d+)%</) || [])[1]),
    ['98', '97', '95', '42']
  );
  assert.deepEqual(
    rendered.map((chip) => (chip.body.match(/<rect[^>]*width="(\d+)"[^>]*class="fill-(?:brand-400|slate-950\/70)"/) || [])[1]),
    ['98', '97', '95', '42'],
    'the bar is filled to the same figure'
  );
});

test('every chip keeps the full label as its name and never wraps', () => {
  const rendered = chips(renderSheetTabs({ wasteRates: [2, 3, 5, 58], activeIndex: 3 }));

  assert.deepEqual(
    rendered.map((chip) => attribute(chip.attributes, 'aria-label')),
    ['Panneau 1', 'Panneau 2', 'Panneau 3', 'Panneau 4']
  );
  for (const chip of rendered) {
    assert.match(attribute(chip.attributes, 'class'), /(^|\s)whitespace-nowrap(\s|$)/);
    assert.match(attribute(chip.attributes, 'class'), /(^|\s)shrink-0(\s|$)/);
    assert.match(chip.body, /<span class="sm:hidden" dir="ltr">\d<\/span><span class="hidden sm:inline">Panneau \d<\/span>/);
  }
  assert.deepEqual(
    rendered.map((chip) => attribute(chip.attributes, 'aria-current') || null),
    [null, null, null, 'true']
  );
});

test('the arrows step through the panels and stop at both ends', () => {
  const button = (html, id) => (html.match(new RegExp(`<button[^>]*data-testid="${id}"[^>]*>`)) || [''])[0];

  const first = renderSheetTabs({ wasteRates: [2, 3, 5], activeIndex: 0 });
  assert.match(button(first, 'sheet-tab-prev'), /disabled=""/);
  assert.doesNotMatch(button(first, 'sheet-tab-next'), /disabled=""/);
  assert.match(button(first, 'sheet-tab-next'), /aria-label="Suivant"/);

  const last = renderSheetTabs({ wasteRates: [2, 3, 5], activeIndex: 2 });
  assert.doesNotMatch(button(last, 'sheet-tab-prev'), /disabled=""/);
  assert.match(button(last, 'sheet-tab-next'), /disabled=""/);

  const single = renderSheetTabs({ wasteRates: [12], activeIndex: 0 });
  assert.equal(chips(single).length, 1);
  assert.doesNotMatch(single, /sheet-tab-(prev|next)/, 'one panel needs no arrows');
});

test('1D results name the chips after bars, and other locales keep their own label', () => {
  const bars = chips(renderSheetTabs({ wasteRates: [4, 9], activeIndex: 0, mode: '1d' }));
  assert.deepEqual(bars.map((chip) => attribute(chip.attributes, 'aria-label')), ['Barre 1', 'Barre 2']);

  const english = chips(renderSheetTabs({ wasteRates: [4, 9], activeIndex: 0 }, 'en'));
  assert.deepEqual(english.map((chip) => attribute(chip.attributes, 'aria-label')), ['Sheet 1', 'Sheet 2']);

  const arabic = renderSheetTabs({ wasteRates: [4, 9], activeIndex: 0 }, 'ar');
  assert.match(arabic, /aria-label="لوح 1"/);
  assert.match(arabic, /aria-label="التالي"/);
});

test('the atelier draws its plan tabs with SheetTabs', () => {
  const page = fs.readFileSync(path.resolve('src/app/(site)/atelier/page.tsx'), 'utf8');

  assert.match(page, /<SheetTabs\s/);
  assert.match(page, /mode=\{result\.cutMode === '1d' \? '1d' : '2d'\}/);
  assert.doesNotMatch(page, /wasteRate\?\.toFixed\(0\)\}%/, 'the unlabelled waste figure is gone');
});
