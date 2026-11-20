const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// User report, 2026-11-20: the cutting plan showed the panel with rounded
// corners, and a carpenter reads that as a panel cut round at the corners.
// A panel and its pieces are rectangles: the plan draws them square.

const source = fs.readFileSync(path.resolve('src/app/(site)/atelier/page.tsx'), 'utf8');

/** The opening tag of the plan SVG. */
function planSvgTag() {
  const match = source.match(/<svg\s+data-testid="cut-plan-svg"[\s\S]*?>/);
  assert.ok(match, 'the plan SVG is found');
  return match[0];
}

/** The plan SVG, from its opening tag to its closing one. */
function planSvg() {
  const start = source.indexOf('data-testid="cut-plan-svg"');
  const end = source.indexOf('</svg>', start);
  assert.ok(start >= 0 && end > start, 'the plan SVG is found');
  return source.slice(start, end);
}

test('the plan is not clipped to rounded corners', () => {
  assert.doesNotMatch(planSvgTag(), /\brounded(-[a-z0-9]+)?\b/);
});

test('the panel and the pieces are drawn with square corners', () => {
  assert.doesNotMatch(planSvg(), /\brx=/);
});
