const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// Owner, 27/11/2026: the « جولة » button of the atelier did nothing. driver.js,
// loaded from a CDN, was called as `window.driver(...)` (its IIFE exposes
// `window.driver.js.driver`), and the four steps aimed at ids the atelier no
// longer had. The tour is now our own, and each step points at an element
// marked `data-tour` in the atelier.

const ROOT = path.join(__dirname, '..');
const tour = fs.readFileSync(path.join(ROOT, 'src/components/OnboardingTour.tsx'), 'utf8');
const atelier = fs.readFileSync(path.join(ROOT, 'src/app/(site)/atelier/page.tsx'), 'utf8');

const targets = [...tour.matchAll(/target: '([a-z-]+)'/g)].map((m) => m[1]);

test('the tour has four steps, in the order of the work', () => {
  assert.deepEqual(targets, ['photo', 'pieces', 'panel', 'plan']);
});

test('every step points at an element the atelier marks, exactly once', () => {
  for (const target of targets) {
    const marks = atelier.split(`data-tour="${target}"`).length - 1;
    assert.equal(marks, 1, `data-tour="${target}" appears ${marks} times in the atelier`);
  }
});

test('the step on the plan is the main button that computes it', () => {
  assert.match(atelier, /ref=\{mainRunRef\}\s*\n\s*data-tour="plan"/);
});

test('no script from a CDN, no driver.js', () => {
  assert.doesNotMatch(tour, /cdn\.|jsdelivr|driver\.js|createElement\('script'\)/);
});

test('the step texts are plain and never count credits', () => {
  const { catalogs } = loadTsModule('src/i18n/index.ts');
  for (const [locale, catalog] of Object.entries(catalogs)) {
    for (const n of [1, 2, 3, 4]) {
      const title = catalog.tour[`step${n}Title`];
      const desc = catalog.tour[`step${n}Desc`];
      assert.ok(title && desc, `${locale}.tour.step${n} is missing`);
      // The progress line numbers the steps; titles do not repeat it.
      assert.doesNotMatch(title, /^\d/, `${locale}.tour.step${n}Title starts with a number`);
      assert.doesNotMatch(`${title} ${desc}`, /crédit|credit|رصيد|DXF|JSON|optimi|تحسين/i, `${locale}.tour.step${n}`);
    }
  }
});
