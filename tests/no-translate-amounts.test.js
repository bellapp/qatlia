const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// A customer's phone set to Arabic machine-translated the French atelier and
// Chrome rendered "MAD" as "درهمًا إماراتيًا" (UAE dirham). Every element that
// prints an amount with its currency therefore carries translate="no", so the
// browser's page translation leaves the figure and "MAD"/"DH" untouched.

const ATELIER = 'src/app/(site)/atelier/page.tsx';

function linesOf(relPath) {
  return fs.readFileSync(path.resolve(relPath), 'utf8').split(/\r?\n/);
}

test('every atelier amount carries translate="no"', () => {
  const lines = linesOf(ATELIER);
  const amountKeys = /t\('atelier\.cost\.(amount|currency|detail\.perPanel|detail\.perM2|detail\.perMeter)'/;
  const offenders = [];
  lines.forEach((line, i) => {
    if (!amountKeys.test(line)) return;
    // The key is either on the element's own line, or inside an element opened
    // on one of the few lines above it (multi-line JSX).
    const context = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
    if (!context.includes('translate="no"')) offenders.push(`${ATELIER}:${i + 1}: ${line.trim()}`);
  });
  assert.deepEqual(offenders, [], `amounts without translate="no":\n${offenders.join('\n')}`);
});

test('the cost banner total is protected from page translation', () => {
  const source = linesOf(ATELIER).join('\n');
  assert.match(source, /data-testid="cost-banner-total"[^>]*translate="no"/);
});
