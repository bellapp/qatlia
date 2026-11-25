/**
 * Where the measures of a piece are written on the plan: the width along its
 * top side, the height along its left side, turned to read along it (owner
 * request, 2026-11-25). « H × W » in the middle made the one who cuts look for
 * which is which. One place for the atelier's plan, the PDF and the WhatsApp
 * picture, so the three can never disagree.
 *
 * The sizes are those of the piece as it lies on the panel: a turned piece
 * shows what the saw cuts along each side. Any unit of length, the same for
 * the box and the style. Pure module.
 */

/** The height of a digit, for a font size of 1. */
const DIGIT_HEIGHT = 0.72;
/** Air between two texts, for a font size of 1. */
const AIR = 0.25;
/** Of the short side: what the label may leave between itself and the edge. */
const INSET_SHARE = 0.19;
/** Of the inset: what stays free at each end of the text. */
const END_SHARE = 0.5;
const FONT_STEP = 0.95;

export interface MeasureStyle {
  /** The font follows the short side of the piece, between these two. */
  share: number;
  minFont: number;
  maxFont: number;
  /** From the edge to the text: past the dashes of a chant. Less on a narrow strip. */
  inset: number;
  /** Width of a character, for a font size of 1. */
  charWidth: number;
  /** Width of the decimal point: narrow, except in a monospace font. */
  pointWidth: number;
  /** The piece number, kept off the measures. */
  number?: { text: string; font: number };
}

/** In centimetres on the panel; the WhatsApp picture is the same, scaled. */
export const SCREEN_MEASURES: MeasureStyle = { share: 0.25, minFont: 2, maxFont: 4.8, inset: 2.3, charWidth: 0.6, pointWidth: 0.6 };
/** In centimetres on the panel; the route scales it and bounds the font in points. */
export const PDF_MEASURES: MeasureStyle = { share: 0.35, minFont: 2, maxFont: 5, inset: 3.1, charWidth: 0.556, pointWidth: 0.278 };

export interface SideMeasure {
  text: string;
  /** The middle of the text. */
  x: number;
  y: number;
  font: number;
  /** Along the side. */
  length: number;
  /** Across it: the height of the digits. */
  thickness: number;
}

export interface SideMeasures {
  /** Along the top side, upright; null where it would not be readable. */
  width: SideMeasure | null;
  /** Along the left side, turned a quarter counter-clockwise; null likewise. */
  height: SideMeasure | null;
  /** The middle of the piece number, in the middle of the piece when it is free. */
  number: { x: number; y: number; font: number };
}

interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** "87.0" → "87": a plan is read at a glance. */
export function shortMeasure(formatted: string): string {
  return formatted.replace(/\.0+$/, '');
}

function around(x: number, y: number, dx: number, dy: number): Rect {
  return { x1: x - dx / 2, x2: x + dx / 2, y1: y - dy / 2, y2: y + dy / 2 };
}

function touches(a: Rect, b: Rect, air: number): boolean {
  return a.x1 < b.x2 + air && b.x1 < a.x2 + air && a.y1 < b.y2 + air && b.y1 < a.y2 + air;
}

/** A style in centimetres, for a drawing at `scale` units per centimetre. */
export function scaleMeasures(style: MeasureStyle, scale: number): MeasureStyle {
  return { ...style, minFont: style.minFont * scale, maxFont: style.maxFont * scale, inset: style.inset * scale };
}

export function sideMeasures(
  box: { x: number; y: number; width: number; height: number },
  texts: { width: string; height: string },
  style: MeasureStyle
): SideMeasures {
  const { width: w, height: h } = box;
  const shortSide = Math.min(w, h);
  const inset = Math.min(style.inset, shortSide * INSET_SHARE);
  const ends = 2 * END_SHARE * inset;
  const wanted = Math.min(style.maxFont, Math.max(style.minFont, shortSide * style.share));

  const measure = (text: string, font: number, x: number, y: number): SideMeasure => ({
    text,
    x,
    y,
    font,
    length: Array.from(text).reduce((sum, char) => sum + (char === '.' ? style.pointWidth : style.charWidth), 0) * font,
    thickness: DIGIT_HEIGHT * font,
  });
  const along = (font: number) => inset + (DIGIT_HEIGHT * font) / 2;
  const widthAt = (font: number): SideMeasure | null => {
    const m = measure(texts.width, font, w / 2, along(font));
    return m.length <= w - ends && m.thickness <= h - 2 * inset ? m : null;
  };
  const heightAt = (font: number): SideMeasure | null => {
    const m = measure(texts.height, font, along(font), h / 2);
    return m.length <= h - ends && m.thickness <= w - 2 * inset ? m : null;
  };
  const widthRect = (m: SideMeasure) => around(m.x, m.y, m.length, m.thickness);
  const heightRect = (m: SideMeasure) => around(m.x, m.y, m.thickness, m.length);
  const largest = <T>(find: (font: number) => T | null): T | null => {
    for (let font = wanted; font > style.minFont; font *= FONT_STEP) {
      const found = find(font);
      if (found) return found;
    }
    return find(style.minFont);
  };

  const both = largest((font) => {
    const top = widthAt(font);
    const left = heightAt(font);
    if (!top || !left) return null;
    const air = AIR * font;
    if (!touches(widthRect(top), heightRect(left), air)) return { top, left };
    // A small piece: the height slides down its side, under the width.
    const from = inset + top.thickness + air;
    const to = h - ends / 2;
    return left.length <= to - from ? { top, left: { ...left, y: (from + to) / 2 } } : null;
  });
  let top = both?.top ?? null;
  let left = both?.left ?? null;
  if (!both) {
    // Only one is readable: the long side, which says where the strip goes.
    if (w >= h) top = largest(widthAt);
    else left = largest(heightAt);
  }

  const rects = [...(top ? [widthRect(top)] : []), ...(left ? [heightRect(left)] : [])];
  const numberFont = style.number?.font ?? 0;
  const numberLength = (style.number?.text.length ?? 0) * style.charWidth * numberFont;
  const afterLeft = left ? heightRect(left).x2 : 0;
  const afterTop = top ? widthRect(top).y2 : 0;
  const spots = [
    { x: w / 2, y: h / 2 },
    // A strip: further along it.
    w >= h ? { x: w * 0.75, y: h / 2 } : { x: w / 2, y: h * 0.75 },
    // A small piece: the corner the measures leave.
    { x: (afterLeft + w) / 2, y: (afterTop + h) / 2 },
  ];
  const free = spots.find((s) => !rects.some((r) => touches(r, around(s.x, s.y, numberLength, DIGIT_HEIGHT * numberFont), AIR * numberFont)));
  const spot = style.number ? free ?? spots[spots.length - 1] : spots[0];

  const onPanel = <T extends { x: number; y: number }>(m: T): T => ({ ...m, x: m.x + box.x, y: m.y + box.y });
  return {
    width: top && onPanel(top),
    height: left && onPanel(left),
    number: onPanel({ ...spot, font: numberFont }),
  };
}
