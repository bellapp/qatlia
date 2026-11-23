// Footer note of the quotation PDF: the business name is free text (up to 200
// characters), the rest of the sentence is fixed. The note stays on one line,
// so a name that does not fit is shortened — and only the name.
import { containsArabicScript } from './pdf-bidi';

const ELLIPSIS = '…';

/**
 * An Arabic string with a Latin run in it (the business name in the footer
 * note) laid out in a single draw call comes out in the wrong order: jsPDF
 * runs one bidi pass over the whole string and the runs end up swapped. So
 * each run is its own segment. Text with no Arabic in it needs none of this
 * and stays one draw call.
 */
export function footerNoteSegments(note: string, companyName: string): string[] {
  const at = companyName ? note.indexOf(companyName) : -1;
  if (at < 0 || !containsArabicScript(note)) return [note];
  const before = note.slice(0, at).trimEnd();
  const after = note.slice(at + companyName.length).trimStart();
  if (!containsArabicScript(after)) return [before, companyName, after].filter(Boolean);
  // A dash or full stop at the edge of an Arabic run would be placed on the
  // wrong side of it (the bidi pass takes a left-to-right base direction), so
  // each such mark is a segment of its own.
  const [lead, core, trail] = /^([—–-]?)\s*([\s\S]*?)([.،]?)$/.exec(after)!.slice(1);
  return [before, companyName, lead, core, trail].filter(Boolean);
}

/** One space between segments, except before a closing full stop or comma. */
export function joinSegments(segments: string[]): string[] {
  return segments.flatMap((segment, index) =>
    index === 0 || /^[.,،:;!?؟]+$/.test(segment) ? [segment] : [' ', segment]
  );
}

/**
 * The footer note for `companyName`, as the segments to draw, with the name
 * shortened by a trailing `…` until the whole line is at most `maxWidth`
 * wide (`measure` = drawn width of one segment, in the font and size in use).
 */
export function fittedFooterNoteSegments(
  footerNote: (companyName: string) => string,
  companyName: string,
  maxWidth: number,
  measure: (text: string) => number
): string[] {
  const segmentsFor = (name: string) => footerNoteSegments(footerNote(name), name);
  const widthOf = (segments: string[]) => joinSegments(segments).reduce((sum, part) => sum + measure(part), 0);

  let segments = segmentsFor(companyName);
  if (widthOf(segments) <= maxWidth) return segments;

  const chars = Array.from(companyName);
  while (chars.length > 0) {
    chars.pop();
    const name = `${chars.join('').trimEnd()}${ELLIPSIS}`;
    segments = segmentsFor(name);
    if (widthOf(segments) <= maxWidth) return segments;
  }
  return segmentsFor(ELLIPSIS);
}
