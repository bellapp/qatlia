/**
 * Domain module for client quotations (Task 8 — "Add MAD client quotation").
 *
 * Everything here is pure and side-effect free: strict Zod schemas that
 * bound every string/array/number a request can carry, the FR/AR
 * amount-in-words renderers, and the thin pure builders both
 * `/api/export-quotation` and the atelier's `QuotationDialog` go through.
 *
 * This module never recomputes material/edge/labor cost itself.
 * `computeQuotationDocumentTotals` is the single seam every caller uses to
 * turn a `CostBreakdownInput` into a full `QuotationTotals` — it forwards
 * straight into `src/lib/costing.ts`'s `computeCostBreakdown` and
 * `computeQuotationTotals`, exactly like `src/lib/quotation-payload.ts`
 * already does for the (breakdown-only) UI payload. A quotation's totals
 * must always match the plan screen and PDF export it was generated from.
 */
import { z } from 'zod';
import {
  computeCostBreakdown,
  computeQuotationTotals,
  type CostBreakdownInput,
  type QuotationTax,
  type QuotationDiscount,
  type QuotationTotals,
} from '@/lib/costing';
import { CostBreakdownInputSchema } from '@/lib/exports/pdf-schema';

// ─── Output locale — the generated PDF is FR/AR only ───────────────────────
//
// Independent of the atelier's own three-locale UI (fr/en/ar, see
// src/i18n): the quotation *document* handed to a Moroccan client is only
// ever produced in French or Arabic, matching the plan's explicit
// "FR/AR output" requirement. The dialog that builds this request can still
// run in any of the app's three UI locales.

export const QUOTATION_LOCALES = ['fr', 'ar'] as const;
export type QuotationLocale = (typeof QUOTATION_LOCALES)[number];

// ─── Shared string/number bounds ───────────────────────────────────────────
//
// This schema validates a request arriving over the network — nothing here
// can assume the payload is well-formed. Bounds exist to keep a malicious or
// buggy payload from reaching the PDF renderer or the shared cost
// calculator, not to model a real quotation's actual limits.

const MAX_SHORT_TEXT = 200;
const MAX_ADDRESS_TEXT = 500;
const MAX_PHONE_TEXT = 40;
const MAX_NOTES_TEXT = 4000;
const MONEY_MAX = 1_000_000_000;

/**
 * The same bounds the schema above enforces, exported so the UI's
 * `maxLength` attributes can never silently drift from what the server
 * actually accepts (Task 8 remediation — item 2/11, "textarea maxLength and
 * other UI maxLength align schema").
 */
export const QUOTATION_TEXT_LIMITS = {
  shortText: MAX_SHORT_TEXT,
  addressText: MAX_ADDRESS_TEXT,
  phoneText: MAX_PHONE_TEXT,
  notesText: MAX_NOTES_TEXT,
} as const;

const requiredShortText = (max = MAX_SHORT_TEXT) => z.string().trim().min(1).max(max);
const optionalShortText = (max = MAX_SHORT_TEXT) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === '' ? undefined : value));

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const optionalEmail = () =>
  z
    .string()
    .trim()
    .max(MAX_SHORT_TEXT)
    .optional()
    .transform((value) => (value === '' ? undefined : value))
    .refine((value) => value === undefined || EMAIL_PATTERN.test(value), { message: 'invalid email' });

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = () => z.string().regex(ISO_DATE_PATTERN, 'expected an ISO date (YYYY-MM-DD)');

// ─── Company / client identity ─────────────────────────────────────────────

export const CompanyIdentitySchema = z
  .object({
    name: requiredShortText(),
    address: optionalShortText(MAX_ADDRESS_TEXT),
    phone: optionalShortText(MAX_PHONE_TEXT),
    email: optionalEmail(),
    /** Identifiant Commun de l'Entreprise — Moroccan business registry ID. Optional, never assumed. */
    ice: optionalShortText(MAX_PHONE_TEXT),
    /** Identifiant Fiscal — Moroccan tax ID. Optional, never assumed. */
    taxId: optionalShortText(MAX_PHONE_TEXT),
  })
  .strict();
export type CompanyIdentity = z.infer<typeof CompanyIdentitySchema>;

export const ClientIdentitySchema = z
  .object({
    name: requiredShortText(),
    address: optionalShortText(MAX_ADDRESS_TEXT),
    phone: optionalShortText(MAX_PHONE_TEXT),
    email: optionalEmail(),
  })
  .strict();
export type ClientIdentity = z.infer<typeof ClientIdentitySchema>;

// ─── Tax / discount / delivery — mirrors src/lib/costing.ts's own types ────
//
// These schemas exist purely to give the network boundary a strict shape;
// the values they admit are handed to `computeQuotationTotals` unchanged,
// which is the actual authority on what is valid (see its own
// `resolveTaxAmount`/`resolveDiscountAmount`/`deliveryCost` guards). A
// request this schema accepts can still be rejected by that function (e.g. a
// percentage discount of exactly 100 combined with a huge fixed value is
// caught there, not here) — this schema only narrows obviously-malformed
// input before it reaches the calculator.

const QuotationTaxSchema = z
  .object({
    mode: z.enum(['none', 'percentage']),
    ratePercent: z.number().finite().nonnegative().max(100).optional(),
  })
  .strict()
  .refine((tax) => tax.mode !== 'percentage' || tax.ratePercent !== undefined, {
    message: 'ratePercent is required when mode is "percentage"',
  });

const QuotationDiscountSchema = z
  .object({
    mode: z.enum(['none', 'percentage', 'fixed']),
    value: z.number().finite().nonnegative().max(MONEY_MAX).optional(),
  })
  .strict()
  .refine((discount) => discount.mode === 'none' || discount.value !== undefined, {
    message: 'value is required when mode is not "none"',
  });

// ─── Logo — format/length bounds only; magic-number/dimension checks live
// in src/lib/exports/quotation-logo.ts, which needs the decoded bytes. ────

const LOGO_MAX_DECODED_BYTES = 500 * 1024;
// Base64 expands input by 4/3; a generous margin covers the "data:...;base64,"
// prefix and any padding, without loosening the real 500KB decoded cap that
// quotation-logo.ts enforces on the actual bytes.
const LOGO_MAX_BASE64_TEXT_LENGTH = Math.ceil((LOGO_MAX_DECODED_BYTES / 3) * 4) + 100;

export const LogoDataUrlSchema = z
  .string()
  .max(LOGO_MAX_BASE64_TEXT_LENGTH)
  .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/, 'logo must be a base64 PNG or JPEG data URL');

// ─── Panels / pieces — bounded, optional detail lines for the FR/AR
// line-item table ───────────────────────────────────────────────────────
//
// These never feed the money calculator: every rendered total still comes
// exclusively from `costingInput` via `computeQuotationDocumentTotals` (see
// above). They exist purely so the PDF's detail table can show which panels
// and pieces the quote is actually for. The atelier derives them from the
// optimizer's own result (see `src/lib/quotation-items.ts`'s
// `deriveQuotationPanels`/`deriveQuotationPieces`) — never from a
// user-editable total — but this schema still bounds them strictly, since a
// request smuggling an oversized or malformed array must never reach the
// PDF renderer.

export const MAX_QUOTATION_PANELS = 50;
export const MAX_QUOTATION_PIECES = 500;
const MAX_LINE_QUANTITY = 10_000;
const MAX_LINE_DIMENSION_CM = 100_000;
const MAX_LINE_EDGE_LENGTH_M = 1_000_000;

const lineDimension = () => z.number().finite().positive().max(MAX_LINE_DIMENSION_CM);
const lineQuantity = () => z.number().int().positive().max(MAX_LINE_QUANTITY);

export const QuotationPanelSchema = z
  .object({
    ref: requiredShortText(80),
    material: requiredShortText(80),
    widthCm: lineDimension(),
    heightCm: lineDimension(),
    quantity: lineQuantity(),
  })
  .strict();
export type QuotationPanelLine = z.infer<typeof QuotationPanelSchema>;

const EdgeSideSchema = z.enum(['left', 'right', 'top', 'bottom']);

export const QuotationPieceSchema = z
  .object({
    pieceNumber: z.number().int().nonnegative().max(MAX_LINE_QUANTITY),
    name: requiredShortText(120),
    widthCm: lineDimension(),
    heightCm: lineDimension(),
    quantity: lineQuantity(),
    /** Only present when the optimizer result actually carries edge-banding flags for this piece — never fabricated. */
    edgeBandedSides: z.array(EdgeSideSchema).max(4).optional(),
    /** Total banded length in metres across `quantity` copies — an honest aggregate, never a per-side guess. */
    edgeLengthM: z.number().finite().nonnegative().max(MAX_LINE_EDGE_LENGTH_M).optional(),
  })
  .strict();
export type QuotationPieceLine = z.infer<typeof QuotationPieceSchema>;

// ─── The full /api/export-quotation request ────────────────────────────────

export const QuotationRequestSchema = z
  .object({
    /** Optional: query only a project owned by the caller (see route.ts). Never trusted as an ownership claim on its own. */
    projectId: z.string().uuid().optional(),
    /** The exact input the optimizer passed to computeCostBreakdown — never a client-submitted CostBreakdown/QuotationTotals. */
    costingInput: CostBreakdownInputSchema,
    tax: QuotationTaxSchema,
    discount: QuotationDiscountSchema,
    deliveryCost: z.number().finite().nonnegative().max(MONEY_MAX).default(0),
    company: CompanyIdentitySchema,
    client: ClientIdentitySchema,
    quoteNumber: requiredShortText(),
    issueDate: isoDate(),
    expiryDate: isoDate().optional(),
    /** Optional, free-typed reference (e.g. the client's own order/PO number) — bounded like every other short text field, never required. */
    projectReference: optionalShortText(),
    notes: optionalShortText(MAX_NOTES_TEXT),
    locale: z.enum(QUOTATION_LOCALES).default('fr'),
    includeAmountInWords: z.boolean().default(false),
    logoDataUrl: LogoDataUrlSchema.optional(),
    panels: z.array(QuotationPanelSchema).max(MAX_QUOTATION_PANELS).default([]),
    pieces: z.array(QuotationPieceSchema).max(MAX_QUOTATION_PIECES).default([]),
  })
  .strict();
export type QuotationRequest = z.infer<typeof QuotationRequestSchema>;

// ─── Totals — the single seam that reaches src/lib/costing.ts ─────────────

/**
 * Recomputes the full quotation totals from a `CostBreakdownInput`, never
 * from a client-submitted breakdown or totals. Both `/api/export-quotation`
 * and this module's own tests call this instead of composing
 * `computeCostBreakdown`/`computeQuotationTotals` by hand, so there is one
 * place that wiring can drift.
 */
export function computeQuotationDocumentTotals(
  costingInput: CostBreakdownInput,
  tax: QuotationTax,
  discount: QuotationDiscount,
  deliveryCost = 0
): QuotationTotals {
  const costBreakdown = computeCostBreakdown(costingInput);
  return computeQuotationTotals({ costBreakdown, tax, discount, deliveryCost });
}

// ─── Pure UI-facing request builder ────────────────────────────────────────

export interface QuotationRequestPayloadInput {
  costingInput: CostBreakdownInput;
  tax: QuotationTax;
  discount: QuotationDiscount;
  deliveryCost: number;
  company: CompanyIdentity;
  client: ClientIdentity;
  quoteNumber: string;
  issueDate: string;
  expiryDate?: string;
  projectReference?: string;
  notes?: string;
  locale: QuotationLocale;
  includeAmountInWords: boolean;
  logoDataUrl?: string;
  projectId?: string;
  /** Bounded detail lines derived from the optimizer's own result — see the module doc above `QuotationPanelSchema`/`QuotationPieceSchema`. */
  panels?: QuotationPanelLine[];
  pieces?: QuotationPieceLine[];
}

/**
 * Builds the exact JSON body `QuotationDialog` sends to
 * `/api/export-quotation`. Pure and side-effect free so it can be
 * unit-tested without a UI or network call — mirrors the pattern already
 * established by `src/lib/pdf-payload.ts` and `src/lib/quotation-payload.ts`.
 */
export function buildQuotationRequestPayload(input: QuotationRequestPayloadInput): QuotationRequestPayloadInput {
  return { ...input };
}

const FILENAME_SAFE_MAX_LENGTH = 64;
const FILENAME_UNSAFE_CHARS = /[^A-Za-z0-9._-]/g;

/**
 * Whitelists a caller-controlled quote number down to the exact charset safe
 * to embed unquoted-content-wise inside an HTTP `Content-Disposition`
 * plain-ASCII `filename="..."` parameter (or a client-side `<a download>`
 * attribute) — never a blacklist. A quote number is free-typed by the
 * artisan (see `QuotationRequestSchema.quoteNumber`), so it can legitimately
 * contain a `"`, `;`, CR/LF or other bytes that would otherwise let it break
 * out of the quoted filename value and inject further header parameters.
 * Bounded to 64 characters — comfortably more than any real reference — and
 * falls back to the stable literal `DEVIS` when nothing whitelisted survives
 * (e.g. a quote number typed entirely in Arabic/CJK script).
 */
export function sanitizeQuoteNumberForFilename(quoteNumber: string): string {
  const cleaned = quoteNumber.replace(FILENAME_UNSAFE_CHARS, '').slice(0, FILENAME_SAFE_MAX_LENGTH);
  return cleaned || 'DEVIS';
}

// RFC 5987's `attr-char` grammar (used by the `filename*=UTF-8''...`
// Content-Disposition parameter, RFC 6266) excludes `! ' ( ) *` in addition
// to the usual reserved characters — but `encodeURIComponent` never escapes
// exactly those five, since they're valid unencoded in a URI component. Left
// bare, a caller-controlled filename containing them (see `quoteNumber`,
// free-typed by the artisan) would still be syntactically inside spec for
// encodeURIComponent yet violate the stricter ext-value grammar this HTTP
// header parameter actually requires. CR/LF are already escaped by
// encodeURIComponent, so this is defense in depth against header-splitting,
// not the only guard against it.
const RFC5987_EXTRA_UNSAFE = /['()*!]/g;

/** Strictly RFC 5987-compliant percent-encoding for a `filename*=UTF-8''...` Content-Disposition value. */
export function encodeRfc5987Filename(value: string): string {
  return encodeURIComponent(value).replace(
    RFC5987_EXTRA_UNSAFE,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/** A deterministic, human-editable default quote number/reference, derived only from the given date (UTC, so it never depends on the caller's timezone). */
export function suggestQuoteNumber(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `DEV-${yyyy}${mm}${dd}`;
}

// ─── Amount in words — FR/AR, deterministic and bounded ────────────────────
//
// Scoped to three-digit groups (units / thousands / millions) — comfortably
// enough for any realistic artisan quotation — rather than an open-ended
// "milliard"+ implementation. `AMOUNT_IN_WORDS_MAX_MAD` is the documented
// cap; anything above it throws rather than silently truncating a client
// document. Both renderers work in integer cents (`Math.round(amount*100)`)
// so floating-point subtraction never produces a stray 100th centime.

export const AMOUNT_IN_WORDS_MAX_MAD = 99_999_999.99;

function assertAmountInWordsBound(amountMad: number, fnName: string): void {
  if (!Number.isFinite(amountMad) || amountMad < 0) {
    throw new RangeError(`${fnName}: amountMad must be a finite number >= 0, received ${amountMad}`);
  }
  if (amountMad > AMOUNT_IN_WORDS_MAX_MAD) {
    throw new RangeError(`${fnName}: amountMad exceeds the documented bound of ${AMOUNT_IN_WORDS_MAX_MAD} MAD`);
  }
}

function splitIntoCents(amountMad: number): { units: number; cents: number } {
  const totalCents = Math.round(amountMad * 100);
  return { units: Math.floor(totalCents / 100), cents: totalCents % 100 };
}

// ─── French ─────────────────────────────────────────────────────────────

const FR_UNITS = [
  'zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf',
] as const;
const FR_TENS: Record<number, string> = { 20: 'vingt', 30: 'trente', 40: 'quarante', 50: 'cinquante', 60: 'soixante' };

/**
 * 0-99 in French. `allowTrailingS` gates the "quatre-vingts" 's': it takes
 * the plural only when this two-digit group is the true end of the whole
 * number — the Académie's classic rule is that "vingt" (and "cent", see
 * `frThreeDigits`) loses its 's' the moment *anything* follows it, including
 * a scale word ("quatre-vingt mille", not "quatre-vingts mille"). Callers
 * building a thousands/millions coefficient (always followed by "mille"/
 * "million") must pass `false`; only the final units group passes `true`.
 */
function frTwoDigits(n: number, allowTrailingS: boolean): string {
  if (n < 20) return FR_UNITS[n];
  if (n < 70) {
    const tens = Math.floor(n / 10) * 10;
    const rem = n % 10;
    const tensWord = FR_TENS[tens];
    if (rem === 0) return tensWord;
    if (rem === 1) return `${tensWord} et un`;
    return `${tensWord}-${FR_UNITS[rem]}`;
  }
  if (n < 80) {
    const rem = n - 60; // 10..19
    if (rem === 11) return 'soixante et onze';
    return `soixante-${FR_UNITS[rem]}`;
  }
  if (n < 90) {
    const rem = n - 80;
    if (rem === 0) return allowTrailingS ? 'quatre-vingts' : 'quatre-vingt';
    return `quatre-vingt-${FR_UNITS[rem]}`;
  }
  const rem = n - 80; // 10..19
  return `quatre-vingt-${FR_UNITS[rem]}`;
}

/** 0-999 in French. See `frTwoDigits` for why `allowTrailingS` exists — the same rule governs "cent"/"cents". */
function frThreeDigits(n: number, allowTrailingS: boolean): string {
  const hundreds = Math.floor(n / 100);
  const rem = n % 100;
  let words = '';
  if (hundreds > 0) {
    words = hundreds === 1 ? 'cent' : `${FR_UNITS[hundreds]} cent`;
    if (hundreds > 1 && rem === 0 && allowTrailingS) words += 's';
  }
  if (rem > 0) {
    const remWords = frTwoDigits(rem, allowTrailingS);
    words = words ? `${words} ${remWords}` : remWords;
  }
  return words;
}

/** Any non-negative integer up to `AMOUNT_IN_WORDS_MAX_MAD`'s whole-unit range, in French. */
function frNumberToWords(n: number): string {
  if (n === 0) return 'zéro';
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const units = n % 1000;

  const parts: string[] = [];
  if (millions > 0) {
    parts.push(millions === 1 ? 'un million' : `${frThreeDigits(millions, false)} millions`);
  }
  if (thousands > 0) {
    parts.push(thousands === 1 ? 'mille' : `${frThreeDigits(thousands, false)} mille`);
  }
  if (units > 0 || parts.length === 0) {
    parts.push(frThreeDigits(units, true));
  }
  return parts.join(' ');
}

/**
 * Whether `frNumberToWords(n)`'s phrase ends on a bare "million(s)" word
 * directly adjacent to the noun that follows it — i.e. `n` is a non-zero
 * multiple of 1,000,000 with no thousands/units remainder. Unlike "cent" and
 * "mille" (adjectives), "million"/"milliard" are true nouns in French and
 * take "de" before the noun they count, but only when nothing (no
 * thousands/units group) sits between them and that noun — "un million de
 * dirhams", but "un million deux cent mille dirhams" (no "de": "million" is
 * followed by "deux cent mille", not directly by "dirhams").
 */
function frNeedsDeBeforeNoun(n: number): boolean {
  return n > 0 && n % 1_000_000 === 0;
}

/** Renders an amount in French words: "<dirhams> dirham(s) [et <centimes> centime(s)]". Deterministic, bounded — see `AMOUNT_IN_WORDS_MAX_MAD`. */
export function amountInWordsFr(amountMad: number): string {
  assertAmountInWordsBound(amountMad, 'amountInWordsFr');
  const { units: dirhams, cents: centimes } = splitIntoCents(amountMad);

  const dirhamLabel = dirhams <= 1 ? 'dirham' : 'dirhams';
  const dirhamConnector = frNeedsDeBeforeNoun(dirhams) ? 'de ' : '';
  let result = `${frNumberToWords(dirhams)} ${dirhamConnector}${dirhamLabel}`;

  if (centimes > 0) {
    const centimeLabel = centimes <= 1 ? 'centime' : 'centimes';
    // centimes is always < 100 (see splitIntoCents), so this connector is
    // always empty in practice — kept for correctness/symmetry, not dead code.
    const centimeConnector = frNeedsDeBeforeNoun(centimes) ? 'de ' : '';
    result += ` et ${frNumberToWords(centimes)} ${centimeConnector}${centimeLabel}`;
  }
  return result;
}

// ─── Arabic ─────────────────────────────────────────────────────────────
//
// A deliberately bounded, documented simplification of Arabic
// numeral-noun agreement (the same trade-off src/i18n/index.ts's
// `pluralForm` makes for CLDR plural rules): masculine forms only (دِرهم and
// سنتيم are both masculine, so this never needs the feminine paradigm), and
// numeral-before-noun word order throughout, which is how most Arabic
// invoicing software renders amounts even though classical grammar places
// the noun first for "one"/"two". The counted-noun agreement itself
// (singular for 0 and >=11, dual for 2, plural for 3-10) *is* the real
// standard rule and is applied consistently everywhere a count meets a noun
// below (dirham, centime, thousand, million).

const AR_UNITS = [
  'صفر', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة',
  'عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر',
] as const;
const AR_TENS: Record<number, string> = {
  20: 'عشرون', 30: 'ثلاثون', 40: 'أربعون', 50: 'خمسون', 60: 'ستون', 70: 'سبعون', 80: 'ثمانون', 90: 'تسعون',
};
/** Construct-state prefix used to build the compact "ثلاثمائة"-style hundreds (300-900). */
const AR_HUNDRED_PREFIX: Record<number, string> = {
  3: 'ثلاث', 4: 'أربع', 5: 'خمس', 6: 'ست', 7: 'سبع', 8: 'ثمان', 9: 'تسع',
};

function arTwoDigits(n: number): string {
  if (n < 20) return AR_UNITS[n];
  const tens = Math.floor(n / 10) * 10;
  const rem = n % 10;
  if (rem === 0) return AR_TENS[tens];
  return `${AR_UNITS[rem]} و${AR_TENS[tens]}`;
}

function arThreeDigits(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rem = n % 100;
  let words = '';
  if (hundreds === 1) words = 'مائة';
  else if (hundreds === 2) words = 'مئتان';
  else if (hundreds > 0) words = `${AR_HUNDRED_PREFIX[hundreds]}مائة`;
  if (rem > 0) {
    const remWords = arTwoDigits(rem);
    words = words ? `${words} و${remWords}` : remWords;
  }
  return words;
}

/**
 * Standard Arabic counted-noun agreement: singular for 0 and >=11, dual for
 * 2, plural for 3-10. Zero patterns with >=11 (singular), not with 3-10
 * (plural) — matching how the numeral-noun agreement table is taught, and
 * matching this function's own name/behaviour everywhere else it's used
 * (dirham/centime, and the ألف/مليون scale words below).
 */
function arCountedForm(count: number, forms: { singular: string; dual: string; plural: string }): string {
  if (count === 1) return forms.singular;
  if (count === 2) return forms.dual;
  if (count >= 3 && count <= 10) return forms.plural;
  return forms.singular; // 0 and >=11
}

const AR_THOUSAND_FORMS = { singular: 'ألف', dual: 'ألفان', plural: 'آلاف' };
const AR_MILLION_FORMS = { singular: 'مليون', dual: 'مليونان', plural: 'ملايين' };

function arScaleWord(count: number, forms: { singular: string; dual: string; plural: string }): string {
  if (count === 1) return forms.singular;
  if (count === 2) return forms.dual;
  const noun = count <= 10 ? forms.plural : forms.singular;
  return `${arThreeDigits(count)} ${noun}`;
}

/** Any non-negative integer up to `AMOUNT_IN_WORDS_MAX_MAD`'s whole-unit range, in Arabic. */
function arNumberToWords(n: number): string {
  if (n === 0) return 'صفر';
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const units = n % 1000;

  const parts: string[] = [];
  if (millions > 0) parts.push(arScaleWord(millions, AR_MILLION_FORMS));
  if (thousands > 0) parts.push(arScaleWord(thousands, AR_THOUSAND_FORMS));
  if (units > 0 || parts.length === 0) parts.push(arThreeDigits(units));
  return parts.join(' و');
}

const AR_DIRHAM_FORMS = { singular: 'درهم', dual: 'درهمان', plural: 'دراهم' };
const AR_CENTIME_FORMS = { singular: 'سنتيم', dual: 'سنتيمان', plural: 'سنتيمات' };

/** Renders an amount in Arabic words: "<dirhams> <noun> [و<centimes> <noun>]", Western digits never involved. Deterministic, bounded — see `AMOUNT_IN_WORDS_MAX_MAD`. */
export function amountInWordsAr(amountMad: number): string {
  assertAmountInWordsBound(amountMad, 'amountInWordsAr');
  const { units: dirhams, cents: centimes } = splitIntoCents(amountMad);

  let result = `${arNumberToWords(dirhams)} ${arCountedForm(dirhams, AR_DIRHAM_FORMS)}`;
  if (centimes > 0) {
    result += ` و${arNumberToWords(centimes)} ${arCountedForm(centimes, AR_CENTIME_FORMS)}`;
  }
  return result;
}

/** Dispatches to `amountInWordsFr`/`amountInWordsAr` for the given output locale. */
export function amountInWords(amountMad: number, locale: QuotationLocale): string {
  return locale === 'ar' ? amountInWordsAr(amountMad) : amountInWordsFr(amountMad);
}
