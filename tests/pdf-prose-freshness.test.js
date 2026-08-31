const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Guards route.ts's and pdf-artifact.test.js's prose comments against
 * drifting back to describing the *old*, removed Arabic-rendering pipeline
 * (`arabicSafeText`, a hand-rolled `toVisualOrder` reorder) as if it were
 * still current. The current pipeline drives jsPDF's own built-in bidi
 * engine -- `containsArabicScript`/`drawContentAwareText`/`arabicBidiOptions`
 * in src/lib/exports/pdf-fonts.ts -- see that module's and pdf-bidi.ts's own
 * doc comments for the full history.
 *
 * A mention of either stale identifier is fine when it's explicitly framed
 * as history (the word "old", "used to", "no longer", ...  sitting in the
 * same comment paragraph) -- that's exactly how pdf-bidi.ts and the
 * punctuation-adjacent-Arabic section below document *why* the current
 * approach was chosen. It's only a problem when the identifier is mentioned
 * with nothing marking it as history, i.e. prose written as if it still
 * described today's behaviour.
 */

const STALE_IDENTIFIERS = ['arabicSafeText', 'toVisualOrder'];
const HISTORICAL_MARKER = /\b(?:old|used to|no longer|former(?:ly)?|historical|removed|gone|had to)\b/i;

const TARGET_FILES = ['src/app/api/export-pdf/route.ts', 'tests/pdf-artifact.test.js'];

// A "paragraph" is a maximal run of non-blank lines -- good enough to group
// a stale identifier with whatever historical-context marker sits in the
// same comment block, without needing a full comment parser.
function paragraphsOf(source) {
  return source.split(/\n[ \t]*\n/);
}

test('route.ts and pdf-artifact.test.js only mention the removed Arabic pipeline (arabicSafeText/toVisualOrder) as explicitly marked history', () => {
  for (const relPath of TARGET_FILES) {
    const source = fs.readFileSync(path.resolve(relPath), 'utf8');
    for (const paragraph of paragraphsOf(source)) {
      for (const identifier of STALE_IDENTIFIERS) {
        if (!paragraph.includes(identifier)) continue;
        assert.match(
          paragraph,
          HISTORICAL_MARKER,
          `${relPath}: "${identifier}" is mentioned without a historical marker (old/used to/no longer/...) -- ` +
            `current prose must refer to containsArabicScript/drawContentAwareText/arabicBidiOptions instead:\n${paragraph}`
        );
      }
    }
  }
});

test('sanity: the historical-marker heuristic actually distinguishes stale-as-current prose from marked history', () => {
  const stale = 'The label is drawn via toVisualOrder (see pdf-fonts.ts).';
  const historical = 'This module used to also own a hand-rolled toVisualOrder reorder; that code is now gone.';

  assert.doesNotMatch(stale, HISTORICAL_MARKER, 'fixture sanity: the stale example must carry no historical marker');
  assert.match(historical, HISTORICAL_MARKER, 'fixture sanity: the historical example must carry a marker');
});
