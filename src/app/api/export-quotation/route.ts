import { NextResponse } from 'next/server';
import { jsPDF, type TextOptionsLight } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminConfig } from '@/lib/billing/config';
import { createRateLimiter, QUOTATION_RATE_LIMIT } from '@/lib/rate-limit';
import {
  QuotationRequestSchema,
  computeQuotationDocumentTotals,
  amountInWords,
  AMOUNT_IN_WORDS_MAX_MAD,
  sanitizeQuoteNumberForFilename,
  encodeRfc5987Filename,
  type QuotationLocale,
  type QuotationPanelLine,
  type QuotationPieceLine,
} from '@/lib/quotation';
import { quotationCatalogFor, localizeQuotationMaterial, type QuotationCatalog } from '@/lib/exports/quotation-catalog';
import { UNNAMED_PIECE_NAME_PLACEHOLDER } from '@/lib/quotation-items';
import { validateLogoDataUrl } from '@/lib/exports/quotation-logo';
import {
  registerAmiriFont,
  payloadNeedsArabicFont,
  drawContentAwareText,
  arabicSafeCellHooks,
  stripBidiControls,
  AMIRI_FONT_FAMILY,
  NOT_REGISTERED,
  type FontRegistration,
} from '@/lib/exports/pdf-fonts';
import { containsArabicScript } from '@/lib/exports/pdf-bidi';
import { QUOTATION_PDF_LAYOUT } from '@/lib/exports/quotation-pdf-layout';
import { formatDateTime } from '@/i18n';

/**
 * `/api/export-quotation` — turns an optimized plan into a client-facing MAD
 * quotation PDF (Task 8). Every figure it renders comes from
 * `computeQuotationDocumentTotals`, which forwards `costingInput` through
 * the same shared calculator every other surface uses
 * (`src/lib/costing.ts`) — this route never trusts a client-submitted total
 * or cost breakdown, and `QuotationRequestSchema` is `.strict()` so a
 * request smuggling one in is rejected outright rather than silently
 * ignored. `panels`/`pieces` (see src/lib/quotation.ts) only ever feed the
 * human-readable detail table below — they never touch a money figure.
 *
 * Order of operations, deliberately: auth -> per-user rate limit -> a
 * byte-capped body read -> parse/validate -> (if projectId) ownership-safe
 * lookup -> logo validation -> totals -> amount-in-words bound check -> (if
 * projectId) a *fresh* re-fetch immediately before merging/writing -> PDF
 * render. The rate limit sits right after auth and before the body is even
 * read, so an oversized or malformed request still counts against the
 * caller's budget instead of parsing/validating for free on every retry.
 */

const BASE_FONT = 'helvetica';

/** One limiter per server instance (see the scope note in src/lib/rate-limit.ts). */
const quotationRateLimiter = createRateLimiter(QUOTATION_RATE_LIMIT);

/**
 * Generous upper bound on the raw request body, enforced by actually
 * counting bytes as the body streams in (see `readJsonBodyWithLimit`) —
 * never by trusting a caller-supplied `Content-Length` header alone. Covers
 * a ~500KB logo (≈683KB once base64-encoded) plus every other bounded field
 * (4000-char notes, up to 500 piece lines, etc.) with generous headroom.
 */
const MAX_QUOTATION_BODY_BYTES = 2_000_000;

type DbClient = SupabaseClient;

/** The service-role client when configured (bypasses RLS for the ownership-checked read/write below); otherwise the session-scoped client, which RLS still protects. Either way every query is additionally scoped with `.eq('user_id', user.id)` explicitly — defense in depth, never relying on RLS alone. */
function createDbClient(): DbClient {
  const adminConfig = getSupabaseAdminConfig();
  if (adminConfig) return createAdminClient(adminConfig.url, adminConfig.serviceRoleKey);
  return createClient() as unknown as DbClient;
}

interface ProjectRow {
  id: string;
  user_id: string;
  options_json: Record<string, unknown> | null;
}

type OwnershipLookup = { status: 'found'; row: ProjectRow } | { status: 'not_found' } | { status: 'error' };

/** Looks up a project the caller owns. "Doesn't exist" and "exists but belongs to someone else" are answered identically by the caller (see route below) — this function itself never distinguishes them either, so there is nothing to accidentally leak. */
async function lookupOwnedProject(db: DbClient, projectId: string, userId: string): Promise<OwnershipLookup> {
  const { data, error } = await db
    .from('projects')
    .select('id, user_id, options_json')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) return { status: 'error' };
  if (!data) return { status: 'not_found' };
  return { status: 'found', row: data as ProjectRow };
}

const fmtMad = (valueMad: number) => `${valueMad.toFixed(2).replace('.', ',')} MAD`;

/**
 * Reads the request body up to `maxBytes`, aborting the underlying stream as
 * soon as that cap is exceeded — never trusting a `Content-Length` header
 * alone (a caller can omit it, lie about it, or use chunked transfer
 * encoding). Falls back to `req.text()` only when the runtime provides no
 * readable stream at all (e.g. some test/edge environments), still bounded
 * by a length check on the result.
 */
async function readJsonBodyWithLimit(req: Request, maxBytes: number): Promise<{ ok: true; data: unknown } | { ok: false; reason: 'TOO_LARGE' | 'INVALID_JSON' }> {
  const reader = req.body?.getReader?.();
  let text: string;
  if (!reader) {
    text = await req.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) return { ok: false, reason: 'TOO_LARGE' };
  } else {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: 'TOO_LARGE' };
      }
      chunks.push(value);
    }
    text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
  }
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, reason: 'INVALID_JSON' };
  }
}

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'AUTH_REQUIRED' }, { status: 401 });
    }

    // Rate limit before the body is even read: an oversized or malformed
    // request must still cost the caller budget, or a flood of them could
    // hammer this route for free forever (see the module doc above).
    const rateLimit = quotationRateLimiter.check(user.id);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'RATE_LIMITED', retryAfterSeconds: rateLimit.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      );
    }

    const bodyResult = await readJsonBodyWithLimit(req, MAX_QUOTATION_BODY_BYTES);
    if (!bodyResult.ok) {
      if (bodyResult.reason === 'TOO_LARGE') {
        return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
      }
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    }

    const parsed = QuotationRequestSchema.safeParse(bodyResult.data);
    if (!parsed.success) {
      return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    }
    const input = parsed.data;

    // ─── Ownership-safe project lookup, before any expensive rendering ────
    let db: DbClient | null = null;
    if (input.projectId) {
      db = createDbClient();
      const lookup = await lookupOwnedProject(db, input.projectId, user.id);
      if (lookup.status === 'error') {
        return NextResponse.json({ error: 'PROJECT_LOOKUP_FAILED' }, { status: 503 });
      }
      // "not found" and "belongs to someone else" answer identically — a 404
      // that distinguished them would let a caller enumerate other artisans'
      // project ids.
      if (lookup.status === 'not_found') {
        return NextResponse.json({ error: 'PROJECT_NOT_FOUND' }, { status: 404 });
      }
    }

    // ─── Logo: strict decode/magic-number/dimension validation ─────────────
    let logo: { mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array; width: number; height: number } | null = null;
    if (input.logoDataUrl) {
      const validated = validateLogoDataUrl(input.logoDataUrl);
      if (!validated.ok) {
        return NextResponse.json({ error: 'LOGO_INVALID', reason: validated.code }, { status: 400 });
      }
      // The validated, decoded bytes are what get embedded below — never the
      // raw client-submitted string re-derived from `input.logoDataUrl`
      // (see quotation-logo.ts's module doc and route.ts's own logging
      // discipline: this Uint8Array is never logged either).
      logo = { mime: validated.mime, bytes: validated.bytes, width: validated.width, height: validated.height };
    }

    // ─── Totals: always recomputed from costingInput, never trusted ────────
    let totals: ReturnType<typeof computeQuotationDocumentTotals>;
    try {
      totals = computeQuotationDocumentTotals(input.costingInput, input.tax, input.discount, input.deliveryCost);
    } catch (error) {
      console.error('QUOTATION_COMPUTATION_FAILED:', error instanceof Error ? error.message : error);
      return NextResponse.json({ error: 'QUOTATION_COMPUTATION_FAILED' }, { status: 400 });
    }

    // A total past the documented amount-in-words bound must fail cleanly
    // here (400) rather than throw deep inside PDF rendering (which would
    // otherwise fall through to the generic 500 handler below).
    if (input.includeAmountInWords && totals.total > AMOUNT_IN_WORDS_MAX_MAD) {
      return NextResponse.json({ error: 'AMOUNT_IN_WORDS_TOO_LARGE' }, { status: 400 });
    }

    // ─── Merge into the owned project's options_json, if any ───────────────
    let projectSaved: boolean | null = null;
    if (input.projectId && db) {
      // Re-fetched immediately before writing, not reused from the earlier
      // ownership lookup above — narrowing the window in which a concurrent
      // update (e.g. the artisan editing the plan in another tab) could be
      // silently clobbered by a stale snapshot. Still not a full transaction
      // (no row lock), but the freshest read this route can reasonably take.
      const fresh = await lookupOwnedProject(db, input.projectId, user.id);
      if (fresh.status === 'found') {
        const existing = fresh.row.options_json && typeof fresh.row.options_json === 'object' ? fresh.row.options_json : {};
        const mergedOptionsJson = {
          ...existing,
          // Never the raw logo — see quotation-logo.ts's module doc: it is
          // decoded fresh from the request on every render, never persisted.
          quotation: {
            company: input.company,
            client: input.client,
            quoteNumber: input.quoteNumber,
            issueDate: input.issueDate,
            expiryDate: input.expiryDate,
            projectReference: input.projectReference,
            notes: input.notes,
            locale: input.locale,
            deliveryCost: input.deliveryCost,
            tax: input.tax,
            discount: input.discount,
            includeAmountInWords: input.includeAmountInWords,
            updatedAt: new Date().toISOString(),
          },
        };
        const { error: updateError } = await db
          .from('projects')
          .update({ options_json: mergedOptionsJson })
          .eq('id', input.projectId)
          .eq('user_id', user.id);
        projectSaved = !updateError;
        if (updateError) console.error('QUOTATION_PROJECT_SAVE_FAILED:', updateError.message);
      } else {
        // The project passed ownership at the start of this request but has
        // since disappeared (or changed owner) by the time of this re-fetch
        // — an unlikely race, not a hard error. The quote itself still
        // renders; it is simply reported as not saved.
        projectSaved = false;
      }
    }

    // ─── Render ──────────────────────────────────────────────────────────
    const pdfBytes = await renderQuotationPdf(input, totals, logo);

    const asciiQuoteNumber = sanitizeQuoteNumberForFilename(input.quoteNumber);
    const utf8FileName = `QatlIA_Devis_${input.quoteNumber}.pdf`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/pdf',
      'Content-Disposition':
        `attachment; filename="QatlIA_Devis_${asciiQuoteNumber}.pdf"; ` +
        `filename*=UTF-8''${encodeRfc5987Filename(utf8FileName)}`,
    };
    if (input.projectId) headers['X-Quotation-Project-Saved'] = String(projectSaved === true);

    return new Response(pdfBytes, { status: 200, headers });
  } catch (error: unknown) {
    // Never leak error.message — it can carry internal detail (a stack
    // trace, a raw DB error). Logged server-side only.
    console.error('QUOTATION_EXPORT_FAILED:', error);
    return NextResponse.json({ error: 'QUOTATION_EXPORT_FAILED' }, { status: 500 });
  }
}

type QuotationInputData = import('@/lib/quotation').QuotationRequest;
type QuotationTotalsData = ReturnType<typeof computeQuotationDocumentTotals>;
type ValidatedLogo = { mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array; width: number; height: number } | null;

/** A page-aware cursor: manually-drawn content (amount-in-words/notes) checks this before every line and starts a fresh page instead of overflowing into the footer band. */
interface Cursor {
  y: number;
}

function ensureRoom(doc: jsPDF, cursor: Cursor, neededMm: number): void {
  if (cursor.y + neededMm > QUOTATION_PDF_LAYOUT.contentBottomMm) {
    doc.addPage('a4', 'portrait');
    cursor.y = QUOTATION_PDF_LAYOUT.contentTopMm;
  }
}

/**
 * Wraps `text` to `maxWidthMm` using the *actual* font that will draw it —
 * the embedded Amiri face for Arabic-script content (when registered),
 * never Helvetica, which has no Arabic glyph metrics at all and would wrap
 * at the wrong widths (Task 8 remediation — item 3). Restores whatever font
 * was active beforehand.
 */
function splitTextForWrap(doc: jsPDF, text: string, maxWidthMm: number, registration: FontRegistration): string[] {
  const isArabic = containsArabicScript(text);
  if (!isArabic || !registration.ok) {
    return doc.splitTextToSize(text, maxWidthMm) as string[];
  }
  const prior = doc.getFont();
  doc.setFont(AMIRI_FONT_FAMILY, prior.fontStyle);
  const lines = doc.splitTextToSize(text, maxWidthMm) as string[];
  doc.setFont(prior.fontName, prior.fontStyle);
  return lines;
}

type Halign = 'left' | 'center' | 'right';
type ColumnStyles = Record<number, { halign?: Halign; cellWidth?: number }>;

/** Reverses a table row's column order for `ar` — RTL reads right-to-left, so the row's *reading-start* (rightmost) column must be the first one a French/LTR reader would expect on the left. No-op for `fr`. */
function rtlRow<T>(row: T[], isRtl: boolean): T[] {
  return isRtl ? [...row].reverse() : row;
}

const MIRROR_HALIGN: Record<Halign, Halign> = { left: 'right', right: 'left', center: 'center' };

/** Mirrors both column *position* and each column's text alignment, so "start of row" stays semantically the label column and "end of row" stays the value column, whichever visual side that lands on. No-op for `fr`. */
function rtlColumnStyles(styles: ColumnStyles, columnCount: number, isRtl: boolean): ColumnStyles {
  if (!isRtl) return styles;
  const mirrored: ColumnStyles = {};
  for (const [key, style] of Object.entries(styles)) {
    const mirroredIndex = columnCount - 1 - Number(key);
    mirrored[mirroredIndex] = { ...style, halign: style.halign ? MIRROR_HALIGN[style.halign] : style.halign };
  }
  return mirrored;
}

async function renderQuotationPdf(input: QuotationInputData, totals: QuotationTotalsData, logo: ValidatedLogo): Promise<ArrayBuffer> {
  const { pageWidthMm: pageWidth, marginMm: margin, contentTopMm: contentTop } = QUOTATION_PDF_LAYOUT;
  const locale = input.locale as QuotationLocale;
  const isRtl = locale === 'ar';
  const cat = quotationCatalogFor(locale);

  // Every free-typed field is stripped of invisible bidi control characters
  // once, up front — independent of whether it happens to contain Arabic
  // script (see stripBidiControls's own doc comment in pdf-fonts.ts).
  const clean = (value: string | undefined) => (value === undefined ? undefined : stripBidiControls(value));
  const company = {
    name: clean(input.company.name) ?? '',
    address: clean(input.company.address),
    phone: clean(input.company.phone),
    email: clean(input.company.email),
    ice: clean(input.company.ice),
    taxId: clean(input.company.taxId),
  };
  const client = {
    name: clean(input.client.name) ?? '',
    address: clean(input.client.address),
    phone: clean(input.client.phone),
    email: clean(input.client.email),
  };
  const quoteNumber = clean(input.quoteNumber) ?? '';
  const projectReference = clean(input.projectReference);
  const notes = clean(input.notes);
  // Panels/pieces carry free-typed text too (a panel's material is a stable
  // enum value in practice, but an artisan's piece names are not) — cleaned
  // the same way as every other drawn field, and re-derived once here so
  // both the Arabic-font gate below and the detail table further down read
  // the same cleaned values.
  const panels = input.panels.map((panel) => ({ ...panel, ref: clean(panel.ref) ?? panel.ref, material: clean(panel.material) ?? panel.material }));
  // A piece the optimizer placed with no artisan-given name arrives here
  // carrying `UNNAMED_PIECE_NAME_PLACEHOLDER` (see quotation-items.ts's own
  // doc comment) — substituted for the locale-appropriate, numbered
  // `unnamedPieceLabel` here, once this document's actual output locale is
  // known, rather than a hardcoded French fallback leaking into an Arabic
  // document. Every other (real, artisan-typed) piece name still goes
  // through the same `clean()` bidi-control stripping as every other field.
  const pieces = input.pieces.map((piece) => ({
    ...piece,
    name: piece.name === UNNAMED_PIECE_NAME_PLACEHOLDER ? cat.unnamedPieceLabel(piece.pieceNumber) : clean(piece.name) ?? piece.name,
  }));

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Every string this render actually draws feeds the gate — not just
  // company/client name+address — so a document whose *locale* is `fr` but
  // whose quote number, a phone/ICE/tax id, a panel material or a piece name
  // happens to contain Arabic script still gets the embedded Amiri face
  // instead of silently falling back to Helvetica tofu for just that field
  // (Task 8 remediation — re-review, item 5).
  const fontRegistration = payloadNeedsArabicFont(
    locale,
    company.name,
    company.address ?? '',
    company.phone ?? '',
    company.email ?? '',
    company.ice ?? '',
    company.taxId ?? '',
    client.name,
    client.address ?? '',
    client.phone ?? '',
    client.email ?? '',
    quoteNumber,
    projectReference ?? '',
    notes ?? '',
    ...panels.flatMap((panel) => [panel.ref, panel.material]),
    ...pieces.map((piece) => piece.name)
  )
    ? await registerAmiriFont(doc)
    : NOT_REGISTERED;
  const cellHooks = arabicSafeCellHooks(doc, fontRegistration);
  const drawText = (text: string, x: number, y: number, options?: TextOptionsLight) => {
    drawContentAwareText(doc, fontRegistration, text, x, y, options);
  };

  // Reading-start/end anchors: for `fr`, start (where a block's own title
  // sits) is the left margin; for `ar`, start is the right margin — the
  // page's anchors and halign mirror accordingly (Task 8 remediation — item 3).
  const startX = isRtl ? pageWidth - margin : margin;
  const startAlign: Halign = isRtl ? 'right' : 'left';

  if (logo) {
    // A generous, fixed on-page box; the image is fitted inside it
    // preserving aspect ratio so a very wide or very tall logo never
    // distorts or blows past the header band. Always anchored at the
    // reading-*end* corner (opposite the document title), on both locales.
    const maxW = 30;
    const maxH = 18;
    const scale = Math.min(maxW / logo.width, maxH / logo.height, 1);
    const w = logo.width * scale;
    const h = logo.height * scale;
    const format = logo.mime === 'image/png' ? 'PNG' : 'JPEG';
    const logoX = isRtl ? 14 : pageWidth - 14 - w;
    try {
      doc.addImage(logo.bytes, format, logoX, 10, w, h);
    } catch (error) {
      // A logo that fails to embed must never fail the whole quotation.
      console.error('QUOTATION_LOGO_EMBED_FAILED:', error instanceof Error ? error.message : 'unknown error');
    }
  }

  doc.setFont(BASE_FONT, 'bold');
  doc.setFontSize(16);
  doc.setTextColor(30, 58, 95);
  drawText(cat.documentTitle, startX, 18, { align: startAlign });

  doc.setFont(BASE_FONT, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  // A running cursor (rather than fixed y offsets for each line) so the
  // optional expiry date and project reference below never leave a visual
  // gap when either — or both — are absent.
  let headerLineY = 25;
  drawText(`${cat.quoteNumberLabel}: ${quoteNumber}`, startX, headerLineY, { align: startAlign });
  headerLineY += 5;
  const issueLabel = formatDateTime(locale, `${input.issueDate}T00:00:00.000Z`, { day: '2-digit', month: '2-digit', year: 'numeric' });
  drawText(`${cat.issueDateLabel}: ${issueLabel}`, startX, headerLineY, { align: startAlign });
  headerLineY += 5;
  if (input.expiryDate) {
    const expiryLabel = formatDateTime(locale, `${input.expiryDate}T00:00:00.000Z`, { day: '2-digit', month: '2-digit', year: 'numeric' });
    drawText(`${cat.expiryDateLabel}: ${expiryLabel}`, startX, headerLineY, { align: startAlign });
    headerLineY += 5;
  }
  // Optional, bounded, free-typed reference (Task 8 remediation — item 4) —
  // rendered only when the artisan actually provided one, never fabricated.
  if (projectReference) {
    drawText(`${cat.projectReferenceLabel}: ${projectReference}`, startX, headerLineY, { align: startAlign });
    headerLineY += 5;
  }

  // Each column wraps content-aware within its own width instead of running
  // into the other column — a long address/phone previously drew as one
  // unbroken line that could visually collide with the adjacent identity
  // block (Task 8 remediation — re-review, item 5). The far edge of each
  // column is the near edge of the next one (or the page's own reading-end
  // margin for the last column), less a small gap.
  const IDENTITY_COLUMN_GAP_MM = 6;
  const readingEndX = isRtl ? margin : pageWidth - margin;
  const identityBlock = (
    title: string,
    identity: { name: string; address?: string; phone?: string; email?: string; ice?: string; taxId?: string },
    x: number,
    align: Halign,
    maxWidthMm: number
  ) => {
    doc.setFont(BASE_FONT, 'bold');
    doc.setFontSize(9);
    drawText(title, x, 46, { align });
    doc.setFont(BASE_FONT, 'normal');
    doc.setFontSize(8.5);
    let y = 51;
    // Every continuation line of a wrapped field is drawn strictly below the
    // line before it, so a field that wraps never overlaps its own next
    // line or the next field's first line.
    const drawWrappedField = (text: string) => {
      const lines = splitTextForWrap(doc, text, maxWidthMm, fontRegistration);
      for (const line of lines) {
        drawText(line, x, y, { align });
        y += 4.5;
      }
    };
    drawWrappedField(identity.name);
    if (identity.address) drawWrappedField(identity.address);
    if (identity.phone) drawWrappedField(identity.phone);
    if (identity.email) drawWrappedField(identity.email);
    if (identity.ice) drawWrappedField(`${cat.iceLabel}: ${identity.ice}`);
    if (identity.taxId) drawWrappedField(`${cat.taxIdLabel}: ${identity.taxId}`);
    return y;
  };

  // Company sits at the reading-start corner (14mm from the left for `fr`,
  // mirrored to 14mm from the right for `ar`); client is the second column,
  // mirrored the same way (Task 8 remediation — item 3).
  const companyX = isRtl ? pageWidth - margin : margin;
  const clientX = isRtl ? pageWidth - 110 : 110;
  const companyColumnWidthMm = Math.abs(clientX - companyX) - IDENTITY_COLUMN_GAP_MM;
  const clientColumnWidthMm = Math.abs(readingEndX - clientX) - IDENTITY_COLUMN_GAP_MM;
  const companyBottom = identityBlock(cat.companySection, company, companyX, startAlign, companyColumnWidthMm);
  const clientBottom = identityBlock(cat.clientSection, client, clientX, startAlign, clientColumnWidthMm);

  const financialRows: (string | number)[][] = [
    rtlRow([cat.materialCostLabel, fmtMad(totals.materialCost)], isRtl),
    rtlRow([cat.edgeCostLabel, fmtMad(totals.edgeCost)], isRtl),
    rtlRow([cat.laborCostLabel, fmtMad(totals.laborCost)], isRtl),
    rtlRow([cat.deliveryCostLabel, fmtMad(totals.deliveryCost)], isRtl),
    // Item 4: the pre-tax (subtotal + delivery) base is read verbatim from
    // computeQuotationTotals's own `preTaxBase` — never independently
    // recomputed as `subtotal + deliveryCost` here.
    rtlRow([cat.subtotalLabel, fmtMad(totals.preTaxBase)], isRtl),
    rtlRow([cat.discountLabel, `- ${fmtMad(totals.discount)}`], isRtl),
    rtlRow(
      [input.tax.mode === 'percentage' ? cat.taxLabel(input.tax.ratePercent ?? 0) : cat.taxNoneLabel, fmtMad(totals.tax)],
      isRtl
    ),
  ];

  const tableStartY = Math.max(companyBottom, clientBottom) + 6;
  doc.setFont(BASE_FONT, 'bold');
  doc.setFontSize(9.5);
  drawText(cat.itemsTitle, startX, tableStartY - 2, { align: startAlign });

  const tableMargin = { top: contentTop, bottom: QUOTATION_PDF_LAYOUT.pageHeightMm - QUOTATION_PDF_LAYOUT.contentBottomMm, left: margin, right: margin };

  autoTable(doc, {
    startY: tableStartY,
    margin: tableMargin,
    head: [rtlRow([cat.itemLabel, cat.amountColumn], isRtl)],
    body: financialRows,
    theme: 'plain',
    headStyles: {
      font: BASE_FONT,
      fontSize: 8,
      fontStyle: 'bold',
      textColor: [0, 0, 0],
      cellPadding: 1.5,
      lineColor: [0, 0, 0],
      lineWidth: { top: 0.2, bottom: 0.2, left: 0, right: 0 },
    },
    styles: { font: BASE_FONT, fontSize: 8, cellPadding: 1.4, textColor: [0, 0, 0] },
    columnStyles: rtlColumnStyles({ 0: { halign: 'left' }, 1: { halign: 'right' } }, 2, isRtl),
    ...cellHooks,
  });

  let finalY = ((doc as unknown) as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  const totalBandY = finalY + 6;
  doc.setFillColor(245, 247, 250);
  doc.setDrawColor(30, 58, 95);
  doc.setLineWidth(0.4);
  doc.rect(margin, totalBandY, pageWidth - 2 * margin, 10, 'FD');
  doc.setFont(BASE_FONT, 'bold');
  doc.setFontSize(10);
  doc.setTextColor(30, 58, 95);
  drawText(cat.totalLabel, isRtl ? pageWidth - margin - 4 : margin + 4, totalBandY + 6.5, { align: isRtl ? 'right' : 'left' });
  drawText(fmtMad(totals.total), isRtl ? margin + 4 : pageWidth - margin - 4, totalBandY + 6.5, { align: isRtl ? 'left' : 'right' });

  const cursor: Cursor = { y: totalBandY + 18 };

  // ─── Panels/pieces detail table (item 1) — only when actually provided;
  // never a fabricated row when the request carries none. ─────────────────

  const drawDetailTable = (title: string, head: string[], body: (string | number)[][], columnStyles: ColumnStyles) => {
    ensureRoom(doc, cursor, 14);
    doc.setFont(BASE_FONT, 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(0, 0, 0);
    drawText(title, startX, cursor.y, { align: startAlign });
    autoTable(doc, {
      startY: cursor.y + 3,
      margin: tableMargin,
      head: [rtlRow(head, isRtl)],
      body: body.map((row) => rtlRow(row, isRtl)),
      theme: 'plain',
      headStyles: {
        font: BASE_FONT,
        fontSize: 7.5,
        fontStyle: 'bold',
        textColor: [0, 0, 0],
        cellPadding: 1.2,
        lineColor: [0, 0, 0],
        lineWidth: { top: 0.2, bottom: 0.2, left: 0, right: 0 },
      },
      styles: { font: BASE_FONT, fontSize: 7, cellPadding: 1.1, textColor: [0, 0, 0] },
      columnStyles: rtlColumnStyles(columnStyles, head.length, isRtl),
      ...cellHooks,
    });
    finalY = ((doc as unknown) as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
    cursor.y = finalY + 8;
  };

  if (panels.length > 0) {
    drawDetailTable(
      cat.panelsTitle,
      [cat.panelsColumnRef, cat.panelsColumnMaterial, cat.panelsColumnDimension, cat.panelsColumnQuantity],
      panels.map((panel: QuotationPanelLine) => [
        panel.ref,
        // A known internal material key (mdf/verre/...) is localized; an
        // artisan's own free-typed material name is left exactly as typed
        // (see quotation-catalog.ts's own doc comment on why).
        localizeQuotationMaterial(panel.material, locale),
        `${panel.heightCm} × ${panel.widthCm}`,
        panel.quantity,
      ]),
      { 0: { halign: 'left' }, 1: { halign: 'left' }, 2: { halign: 'center' }, 3: { halign: 'right' } }
    );
  }

  if (pieces.length > 0) {
    // An honest edge-band aggregate/length column — a dash, never a
    // fabricated "0m", when this specific piece line carries no edge detail
    // at all (see src/lib/quotation-items.ts's own doc comment).
    const hasAnyEdgeDetail = pieces.some((p: QuotationPieceLine) => p.edgeLengthM !== undefined);
    const head = [cat.piecesColumnNumber, cat.piecesColumnName, cat.piecesColumnDimension, cat.piecesColumnQuantity];
    const columnStyles: ColumnStyles = {
      0: { halign: 'left' },
      1: { halign: 'left' },
      2: { halign: 'center' },
      3: { halign: 'right' },
    };
    if (hasAnyEdgeDetail) {
      head.push(cat.piecesColumnEdge);
      columnStyles[4] = { halign: 'right' };
    }
    drawDetailTable(
      cat.piecesTitle,
      head,
      pieces.map((piece: QuotationPieceLine) => {
        const row: (string | number)[] = [piece.pieceNumber, piece.name, `${piece.heightCm} × ${piece.widthCm}`, piece.quantity];
        if (hasAnyEdgeDetail) row.push(piece.edgeLengthM !== undefined ? piece.edgeLengthM.toFixed(2) : '—');
        return row;
      }),
      columnStyles
    );
  }

  if (input.includeAmountInWords) {
    ensureRoom(doc, cursor, 10);
    doc.setFont(BASE_FONT, 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(0, 0, 0);
    drawText(cat.amountInWordsLabel, startX, cursor.y, { align: startAlign });
    cursor.y += 5;
    doc.setFont(BASE_FONT, 'normal');
    const words = amountInWords(totals.total, locale);
    const lines = splitTextForWrap(doc, words, pageWidth - 2 * margin, fontRegistration);
    for (const line of lines) {
      ensureRoom(doc, cursor, 4.5);
      drawText(line, startX, cursor.y, { align: startAlign });
      cursor.y += 4.5;
    }
    cursor.y += 3;
  }

  if (notes) {
    ensureRoom(doc, cursor, 10);
    doc.setFont(BASE_FONT, 'bold');
    doc.setFontSize(8.5);
    drawText(cat.notesLabel, startX, cursor.y, { align: startAlign });
    cursor.y += 5;
    doc.setFont(BASE_FONT, 'normal');
    const lines = splitTextForWrap(doc, notes, pageWidth - 2 * margin, fontRegistration);
    for (const line of lines) {
      ensureRoom(doc, cursor, 4.5);
      drawText(line, startX, cursor.y, { align: startAlign });
      cursor.y += 4.5;
    }
  }

  // ─── Final pass: repeated header/footer/page number on every page (item 2).
  // Nothing above ever draws into the reserved footer band (y >=
  // contentBottomMm), so stamping it here afterwards can never overlap
  // earlier content — and this is the only place that needs to know the
  // final page count. ───────────────────────────────────────────────────
  stampHeadersAndFooters(doc, drawText, cat, quoteNumber, startX, startAlign, isRtl);

  return doc.output('arraybuffer');
}

function stampHeadersAndFooters(
  doc: jsPDF,
  drawText: (text: string, x: number, y: number, options?: TextOptionsLight) => void,
  cat: QuotationCatalog,
  quoteNumber: string,
  startX: number,
  startAlign: Halign,
  isRtl: boolean
): void {
  const { pageWidthMm: pageWidth, marginMm: margin, footerYMm: footerY, continuationSeparatorYMm: continuationSeparatorY } = QUOTATION_PDF_LAYOUT;
  const endX = isRtl ? margin : pageWidth - margin;
  const endAlign: Halign = isRtl ? 'left' : 'right';
  const totalPages = doc.getNumberOfPages();

  for (let page = 1; page <= totalPages; page += 1) {
    doc.setPage(page);

    if (page > 1) {
      doc.setFont(BASE_FONT, 'bold');
      doc.setFontSize(9);
      doc.setTextColor(30, 58, 95);
      drawText(cat.documentTitle, startX, 16, { align: startAlign });
      doc.setFont(BASE_FONT, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(0, 0, 0);
      drawText(`${cat.quoteNumberLabel}: ${quoteNumber}`, startX, 21, { align: startAlign });
      doc.setDrawColor(210, 214, 220);
      doc.setLineWidth(0.2);
      doc.line(margin, continuationSeparatorY, pageWidth - margin, continuationSeparatorY);
    }

    doc.setFont(BASE_FONT, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    drawText(cat.footerNote, startX, footerY, { align: startAlign });
    drawText(cat.pageIndicator(page, totalPages), endX, footerY, { align: endAlign });
  }
}
