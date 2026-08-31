/**
 * Content-gating helper for /api/export-pdf's Arabic-aware rendering.
 *
 * This module used to also own a hand-rolled visual (left-to-right drawing)
 * reorder for shaped Arabic text (`toVisualOrder`), built because it looked
 * like jsPDF's own bidi engine couldn't be driven correctly. That turned out
 * to be wrong: jsPDF's `preProcessText`/`postProcessText` pipeline (see
 * pdf-fonts.ts's `drawContentAwareText`) already shapes and reorders logical
 * Arabic text correctly on its own, given the right `doc.text(...)` options
 * (`isInputVisual: false, isOutputVisual: true, isSymmetricSwapping: true`,
 * empirically verified against a real generated PDF re-parsed with
 * pdfjs-dist and rendered with @napi-rs/canvas — see pdf-fonts.ts and
 * tests/pdf-artifact.test.js). The hand-rolled reorder was actively harmful:
 * calling `doc.processArabic()` manually *and* letting jsPDF's own
 * `preProcessText` hook call it again automatically shaped the text twice,
 * which is exactly what produced the lam-alef double-shaping ligature
 * artifact the old test suite had to document and work around. Driving
 * jsPDF's built-in engine correctly needs no custom UAX#9 implementation at
 * all, so that code is gone; only the content-detection helper below (still
 * needed to gate font selection and cell-drawing hooks on whether a string
 * actually contains Arabic script, independent of the export's locale)
 * remains.
 */

// Base Arabic blocks plus the shaped presentation-form ranges jsPDF's own
// `processArabic()` shaping produces, so detection still works correctly
// *after* shaping (a shaped joined letter is still "Arabic" for this check).
const ARABIC_RANGE = '\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF';
const CONTAINS_ARABIC = new RegExp(`[${ARABIC_RANGE}]`);

/**
 * Whether `text` contains any Arabic-script character (base letters or
 * shaped presentation forms). Used to gate Arabic-specific handling
 * (shaping, bidi reordering, font selection) on the *content* of a string
 * rather than solely on the PDF's locale: a project or material name is
 * free-typed by the artisan and can contain Arabic script even in a
 * French/English-locale export, and conversely most technical strings in an
 * Arabic-locale export (a bare dimension, a percentage) contain none.
 */
export function containsArabicScript(text: string): boolean {
  return CONTAINS_ARABIC.test(text);
}
