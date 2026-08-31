/**
 * Page-geometry constants for `/api/export-quotation`'s PDF layout (Task 8
 * remediation — item 2, pagination). Lives in its own module (rather than
 * being exported straight from route.ts) purely because a Next.js App
 * Router route file may only export the handful of recognized route-handler
 * names (`GET`, `POST`, `config`, ...) — anything else fails Next's own
 * generated route-type check. `renderQuotationPdf` in route.ts is the real
 * consumer; tests import this module directly for geometry assertions (see
 * tests/quotation-artifact.test.js's footer-band-position checks).
 *
 * A4 portrait, millimetres throughout (jsPDF's own unit for this document).
 */
export const QUOTATION_PDF_LAYOUT = {
  pageWidthMm: 210,
  pageHeightMm: 297,
  marginMm: 14,
  /** Where manually-cursored content (and every autoTable's `margin.top`) resumes on a continuation page — leaves room for the slim repeated header stamped in the final pass. */
  contentTopMm: 24,
  /** The horizontal rule under a continuation page's repeated header (page > 1 only) — sits between that header and `contentTopMm`, close enough to visually separate the two without crowding either. */
  continuationSeparatorYMm: 23,
  /** Nothing manually drawn or table-rendered may cross this — the reserved footer band starts here. */
  contentBottomMm: 278,
  /** Baseline of the footer note + page indicator, stamped on every page in the final pass. */
  footerYMm: 288,
} as const;
