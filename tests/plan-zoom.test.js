const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// User report, 2026-11-14: on a phone the zoom of the cutting plan did
// nothing. The plan sits in a flex container, and a flex item shrinks to fit
// by default, so its zoomed width was squeezed back to the screen width at
// every level (278px on a 390px phone from 50% to 250%). On a computer the
// same clamp cut 225% and 250% short.

const source = fs.readFileSync(path.resolve('src/app/(site)/atelier/page.tsx'), 'utf8');

/** The element that wraps the plan SVG and carries the zoomed width. */
function planWrapper() {
  const match = source.match(/<div\s+className="([^"]*)"\s+style=\{\{([\s\S]*?)\}\}\s*>\s*<svg\s+data-testid="cut-plan-svg"/);
  assert.ok(match, 'the plan SVG has a sized wrapper');
  return { className: match[1], style: match[2] };
}

test('the zoomed plan is never shrunk back to the screen width', () => {
  const { className } = planWrapper();

  assert.match(className, /(^|\s)shrink-0(\s|$)/);
});

test('the zoom multiplies the width the plan has at 100%', () => {
  const { style } = planWrapper();

  // At 100% the plan is 560px, or the whole viewport when that is narrower,
  // and each step scales that width. A fixed 560px base made the first step
  // on a phone jump from 278px to 700px and every zoom-out step look alike.
  assert.match(style, /width: `calc\(\$\{PLAN_FIT_WIDTH\} \* \$\{zoomLevel\}\)`/);
  assert.doesNotMatch(style, /maxWidth/);
  assert.match(source, /const FULL_WIDTH = '100%';/);
  assert.match(source, /const PLAN_FIT_WIDTH = `min\(560px, \$\{FULL_WIDTH\}\)`;/);
});

test('one button brings the plan back to 100%', () => {
  const marker = source.indexOf('data-testid="cut-plan-zoom-reset"');
  assert.ok(marker > 0, 'the zoom controls carry a reset button');
  const button = source.slice(source.lastIndexOf('<button', marker), source.indexOf('</button>', marker));

  assert.match(button, /onClick=\{\(\) => setZoomLevel\(1\)\}/);
  assert.match(button, /disabled=\{zoomLevel === 1\}/);
  assert.match(button, /aria-label=\{t\('atelier\.plan\.zoomReset'\)\}/);

  const viewport = source.indexOf('data-testid="cut-plan-viewport"');
  assert.ok(source.indexOf('data-testid="cut-plan-zoom-reset"') < viewport, 'it stays put with the other zoom buttons');

  for (const locale of ['fr', 'en', 'ar']) {
    const messages = fs.readFileSync(path.resolve(`src/i18n/messages/${locale}.ts`), 'utf8');
    assert.match(messages, /zoomReset: '[^']+'/, `${locale} names the reset button`);
  }
});

test('the zoom buttons and the sheet readout stay put while the plan scrolls', () => {
  const frame = source.indexOf('data-testid="cut-plan-frame"');
  const viewport = source.indexOf('data-testid="cut-plan-viewport"');
  const zoomOut = source.indexOf("aria-label={t('atelier.plan.zoomOut')}", frame);
  const readout = source.indexOf('{formatDisplayValue(activeSheet.height, displayUnit)}×', frame);

  assert.ok(frame > 0 && viewport > 0 && zoomOut > 0 && readout > 0);
  // An absolute child of a scrolling box scrolls with its content: once the
  // zoomed plan scrolled, the zoom-out button left the screen. Both overlays
  // now sit in a frame that does not scroll, ahead of the scrolling box.
  assert.ok(zoomOut < viewport, 'the zoom buttons are outside the scrolling box');
  assert.ok(readout < viewport, 'the sheet readout is outside the scrolling box');

  const frameStart = source.lastIndexOf('<div', frame);
  const frameTag = source.slice(frameStart, source.indexOf('>', frame) + 1);
  assert.match(frameTag, /className="relative"/);
  assert.doesNotMatch(frameTag, /overflow/, 'the frame itself does not scroll');

  assert.match(viewportTag(), /PLAN_VIEWPORT_ZOOMED/, 'the viewport is the box the zoomed plan scrolls in');
  assert.ok(planViewportClasses('ZOOMED').includes('overflow-auto'));
});

// User report, 2026-11-15: on a phone, a finger put on the plan did not
// scroll the page. The viewport was a scrolling box at every zoom level, with
// its scroll confined to itself: at 100% the plan fits it, so the box had
// nothing to scroll and still kept the gesture from reaching the page.

/** The opening tag of the box the plan sits in. */
function viewportTag() {
  const viewport = source.indexOf('data-testid="cut-plan-viewport"');
  assert.ok(viewport > 0, 'the plan has a viewport');
  // The tag ends where its className expression does: the expression itself
  // holds a ">" (zoomLevel > 1), so the first ">" is not the end of the tag.
  return source.slice(source.lastIndexOf('<div', viewport), source.indexOf('`}>', viewport) + 3);
}

/** The classes the viewport takes when the plan is ZOOMED in, or FITTED (100% or less), one per entry. */
function planViewportClasses(state) {
  const match = source.match(new RegExp(`const PLAN_VIEWPORT_${state} = '([^']*)';`));
  assert.ok(match, `the viewport has classes for the ${state} plan`);
  return match[1].split(' ').filter(Boolean);
}

test('the viewport only becomes a box of its own once the plan is zoomed in', () => {
  assert.ok(
    viewportTag().includes('${zoomLevel > 1 ? PLAN_VIEWPORT_ZOOMED : PLAN_VIEWPORT_FITTED}'),
    'the zoom level picks the viewport classes'
  );
  assert.doesNotMatch(viewportTag(), /overscroll|overflow|max-h-/, 'no scrolling class is set whatever the zoom');
});

test('at 100% or less a finger on the plan scrolls the page', () => {
  const fitted = planViewportClasses('FITTED');
  assert.ok(fitted.length > 0);

  // Confining the scroll is what swallowed the gesture, at any screen size.
  assert.equal(fitted.some((name) => name.includes('overscroll')), false, 'the scroll is never confined to the plan');
  // On a phone or a tablet (one column, below lg) the plan is shown whole and
  // is no scrolling box at all; the two-column layout keeps its height cap.
  for (const name of fitted) assert.match(name, /^lg:/, `${name} only applies to the two-column layout`);
});

test('zoomed in, a finger on the plan moves the plan and not the page', () => {
  const zoomed = planViewportClasses('ZOOMED');

  assert.ok(zoomed.includes('overflow-auto'), 'the zoomed plan scrolls in its box');
  assert.ok(zoomed.includes('overscroll-contain'), 'reaching an edge of the plan does not drag the page along');
  assert.ok(zoomed.includes('max-h-[70vh]'), 'the box stays within the screen');
});
