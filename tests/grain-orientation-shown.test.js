const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// User question, 2026-11-26: ticking « Panneau avec ramage » left both
// « Vertical » and « Horizontal » unselected, while the plan already laid the
// grain vertically (a panel with no direction set is vertical). The selector
// now shows the direction the plan applies.

function readSource(relativePath) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

test('a grained panel with no direction set shows « Vertical » selected', () => {
  const page = readSource('src/app/(site)/atelier/page.tsx');

  assert.match(page, /aria-pressed=\{\(activeSheet\.grainOrientation \?\? 'vertical'\) === dir\}/);
  assert.match(page, /\$\{\(activeSheet\.grainOrientation \?\? 'vertical'\) === dir \? 'bg-brand-400/);
  assert.doesNotMatch(page, /activeSheet\.grainOrientation === dir/, 'no button reads the raw, possibly unset, direction');
});
