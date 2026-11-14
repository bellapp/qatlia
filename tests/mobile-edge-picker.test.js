const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// User report, 2026-11-14: on a phone the pieces table had no "Chants"
// column, so the edge banding of an existing piece could be neither seen nor
// changed. The column was hidden below 640px because twelve equal tracks left
// it no room. From 360px up the table now uses six sized tracks instead.

const source = fs.readFileSync(path.resolve('src/components/PiecesManager.tsx'), 'utf8');

/** Width of a piece row between its paddings, measured on production. */
const ROW_INNER_WIDTH = { 360: 272, 390: 302, 412: 324 };
const TRACK_GAP_PX = 4;
/** JetBrains Mono is 0.6em wide; the two figures sit 2px either side of the "×". */
const dimensionsWidth = (digits, fontPx) => (2 * digits + 1) * fontPx * 0.6 + 2 * 2;

/** The phone templates of one unit, as `{ from: minWidthPx, tracks: string[] }`. */
function phoneTemplates(unit) {
  const entry = source.match(new RegExp(`\\b${unit}: '([^']*grid-cols-\\[[^']*)'`));
  assert.ok(entry, `PIECES_GRID_PHONE has an entry for ${unit}`);
  return [...entry[1].matchAll(/min-\[(\d+)px\]:grid-cols-\[([^\]]+)\]/g)].map((match) => ({
    from: Number(match[1]),
    tracks: match[2].split('_'),
  }));
}

function fixedWidth(tracks) {
  return tracks
    .filter((track) => /^\d+px$/.test(track))
    .reduce((sum, track) => sum + parseInt(track, 10), 0);
}

test('the edge-banding picker is on the piece row from 360px wide', () => {
  const cell = source.match(/<div className="([^"]*)">\s*<EdgePickerButton/);

  assert.ok(cell, 'the picker sits in its own cell of the row');
  assert.doesNotMatch(cell[1], /hidden sm:flex/, 'the cell is no longer kept for 640px and up');
  assert.match(cell[1], /min-\[360px\]:flex/);
});

test('the header, the rows and the direct-entry line share one grid', () => {
  const grids = source.match(/piecesGridClass\(displayUnit\)/g) || [];

  assert.equal(grids.length, 3);
  assert.doesNotMatch(source, /className="grid grid-cols-12 gap-1/, 'no table line keeps a grid of its own');
});

test('the phone grid has six tracks and the piece name takes what is left', () => {
  for (const unit of ['cm', 'mm']) {
    for (const { tracks } of phoneTemplates(unit)) {
      assert.equal(tracks.length, 6, `${unit}: number, name, dimensions, quantity, edges, actions`);
      assert.equal(tracks[1], 'minmax(0,1fr)');
    }
  }
});

test('on a phone the tracks fit in the row and leave room for the name', () => {
  for (const unit of ['cm', 'mm']) {
    const templates = phoneTemplates(unit);
    assert.equal(templates[0].from, 360, `${unit}: the phone grid starts at 360px`);

    for (const [viewport, inner] of Object.entries(ROW_INNER_WIDTH)) {
      const active = templates.filter((template) => template.from <= Number(viewport)).pop();
      const name = inner - fixedWidth(active.tracks) - 5 * TRACK_GAP_PX;
      assert.ok(name >= 20, `${unit} at ${viewport}px: ${name}px left for the name`);
    }
  }
});

test('the dimensions track holds both figures without clipping a digit', () => {
  // cm shows "230.0" (5 characters), mm "2780.0" (6). The mm figures are set
  // in 9px below 390px, which is what lets them fit on a 360px phone.
  const cases = [
    { unit: 'cm', viewport: 360, digits: 5, fontPx: 10 },
    { unit: 'mm', viewport: 360, digits: 6, fontPx: 9 },
    { unit: 'mm', viewport: 390, digits: 6, fontPx: 10 },
  ];

  for (const { unit, viewport, digits, fontPx } of cases) {
    const active = phoneTemplates(unit).filter((template) => template.from <= viewport).pop();
    const track = parseInt(active.tracks[2], 10);
    assert.ok(
      track >= dimensionsWidth(digits, fontPx),
      `${unit} at ${viewport}px: ${track}px for ${dimensionsWidth(digits, fontPx)}px of figures`
    );
  }

  assert.match(source, /mm: 'text-\[9px\] min-\[390px\]:text-\[10px\]/, 'mm figures stay at 9px below 390px');
});

test('the actions track holds the five 18px buttons', () => {
  for (const unit of ['cm', 'mm']) {
    for (const { tracks } of phoneTemplates(unit)) {
      assert.ok(parseInt(tracks[5], 10) >= 5 * 18 + 4 * 2);
    }
  }
});
