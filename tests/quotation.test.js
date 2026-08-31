const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Task 8 — src/lib/quotation.ts is the domain module for client quotations:
// strict types/schema for company/client/quote metadata, the FR/AR
// amount-in-words helpers, and the pure payload/totals builders the route
// and UI both go through. It never recomputes material/edge/labor itself —
// every total comes from src/lib/costing.ts.

function loadQuotation() {
  return loadTsModule('src/lib/quotation.ts');
}

function costingInput(subtotalParts = {}) {
  return {
    material: { sheets: [{ areaM2: 2, quantity: 1, pricing: { mode: 'per_m2', value: 120 } }], basis: 'measured' },
    edge: { segments: [{ lengthM: 1.6, pricePerMeter: 8 }], basis: 'measured' },
    labor: { pricing: { mode: 'fixed', value: 0 } },
    ...subtotalParts,
  };
}

// ─── computeQuotationDocumentTotals — never rederives cost independently ──

test('computeQuotationDocumentTotals forwards costingInput through computeCostBreakdown and computeQuotationTotals verbatim', () => {
  const { computeQuotationDocumentTotals } = loadQuotation();
  const { computeCostBreakdown, computeQuotationTotals } = loadTsModule('src/lib/costing.ts');

  const input = costingInput();
  const tax = { mode: 'percentage', ratePercent: 20 };
  const discount = { mode: 'none' };

  const totals = computeQuotationDocumentTotals(input, tax, discount, 50);
  const expected = computeQuotationTotals({ costBreakdown: computeCostBreakdown(input), tax, discount, deliveryCost: 50 });

  assert.deepEqual(totals, expected);
});

test('computeQuotationDocumentTotals defaults deliveryCost to 0', () => {
  const { computeQuotationDocumentTotals } = loadQuotation();
  const totals = computeQuotationDocumentTotals(costingInput(), { mode: 'none' }, { mode: 'none' });
  assert.equal(totals.deliveryCost, 0);
});

// ─── CompanyIdentitySchema / ClientIdentitySchema ──────────────────────────

test('CompanyIdentitySchema requires a non-empty name but leaves the rest optional', () => {
  const { CompanyIdentitySchema } = loadQuotation();
  assert.equal(CompanyIdentitySchema.safeParse({ name: 'Atelier Karim' }).success, true);
  assert.equal(CompanyIdentitySchema.safeParse({ name: '' }).success, false);
  assert.equal(CompanyIdentitySchema.safeParse({}).success, false);
});

test('CompanyIdentitySchema accepts optional Moroccan business identifiers (ICE/IF) without requiring them', () => {
  const { CompanyIdentitySchema } = loadQuotation();
  const result = CompanyIdentitySchema.safeParse({
    name: 'Atelier Karim',
    address: '12 Rue Ibn Sina, Casablanca',
    phone: '+212 6 00 00 00 00',
    email: 'contact@atelier.ma',
    ice: '001234567000089',
    taxId: '12345678',
  });
  assert.equal(result.success, true);
  assert.equal(result.data.ice, '001234567000089');
  assert.equal(result.data.taxId, '12345678');
});

test('CompanyIdentitySchema rejects an absurdly long free-text field', () => {
  const { CompanyIdentitySchema } = loadQuotation();
  const result = CompanyIdentitySchema.safeParse({ name: 'A'.repeat(10_000) });
  assert.equal(result.success, false);
});

test('ClientIdentitySchema requires a non-empty name', () => {
  const { ClientIdentitySchema } = loadQuotation();
  assert.equal(ClientIdentitySchema.safeParse({ name: 'Client X' }).success, true);
  assert.equal(ClientIdentitySchema.safeParse({ name: '' }).success, false);
});

// ─── QuotationRequestSchema ────────────────────────────────────────────────

function baseRequest(overrides = {}) {
  return {
    costingInput: costingInput(),
    tax: { mode: 'none' },
    discount: { mode: 'none' },
    company: { name: 'Atelier Karim' },
    client: { name: 'Client X' },
    quoteNumber: 'DEV-20260831-001',
    issueDate: '2026-08-31',
    locale: 'fr',
    includeAmountInWords: false,
    ...overrides,
  };
}

test('QuotationRequestSchema accepts a minimal valid request and defaults deliveryCost to 0', () => {
  const { QuotationRequestSchema } = loadQuotation();
  const result = QuotationRequestSchema.safeParse(baseRequest());
  assert.equal(result.success, true);
  assert.equal(result.data.deliveryCost, 0);
  assert.equal(result.data.projectId, undefined);
});

test('QuotationRequestSchema rejects a percentage tax without an explicit rate', () => {
  const { QuotationRequestSchema } = loadQuotation();
  const result = QuotationRequestSchema.safeParse(baseRequest({ tax: { mode: 'percentage' } }));
  assert.equal(result.success, false);
});

test('QuotationRequestSchema rejects a tax ratePercent above 100', () => {
  const { QuotationRequestSchema } = loadQuotation();
  const result = QuotationRequestSchema.safeParse(baseRequest({ tax: { mode: 'percentage', ratePercent: 150 } }));
  assert.equal(result.success, false);
});

test('QuotationRequestSchema rejects a percentage discount without an explicit value', () => {
  const { QuotationRequestSchema } = loadQuotation();
  const result = QuotationRequestSchema.safeParse(baseRequest({ discount: { mode: 'percentage' } }));
  assert.equal(result.success, false);
});

test('QuotationRequestSchema rejects a negative deliveryCost', () => {
  const { QuotationRequestSchema } = loadQuotation();
  const result = QuotationRequestSchema.safeParse(baseRequest({ deliveryCost: -1 }));
  assert.equal(result.success, false);
});

test('QuotationRequestSchema accepts an optional valid projectId UUID', () => {
  const { QuotationRequestSchema } = loadQuotation();
  const result = QuotationRequestSchema.safeParse(
    baseRequest({ projectId: '11111111-2222-4333-8444-555555555555' })
  );
  assert.equal(result.success, true);
});

test('QuotationRequestSchema rejects a non-UUID projectId rather than silently ignoring it', () => {
  const { QuotationRequestSchema } = loadQuotation();
  const result = QuotationRequestSchema.safeParse(baseRequest({ projectId: 'not-a-uuid' }));
  assert.equal(result.success, false);
});

test('QuotationRequestSchema only accepts fr/ar for the PDF output locale, never en', () => {
  const { QuotationRequestSchema } = loadQuotation();
  assert.equal(QuotationRequestSchema.safeParse(baseRequest({ locale: 'fr' })).success, true);
  assert.equal(QuotationRequestSchema.safeParse(baseRequest({ locale: 'ar' })).success, true);
  assert.equal(QuotationRequestSchema.safeParse(baseRequest({ locale: 'en' })).success, false);
});

test('QuotationRequestSchema rejects an oversized notes field', () => {
  const { QuotationRequestSchema } = loadQuotation();
  const result = QuotationRequestSchema.safeParse(baseRequest({ notes: 'x'.repeat(100_000) }));
  assert.equal(result.success, false);
});

test('QuotationRequestSchema rejects a malformed issueDate', () => {
  const { QuotationRequestSchema } = loadQuotation();
  assert.equal(QuotationRequestSchema.safeParse(baseRequest({ issueDate: '31/08/2026' })).success, false);
  assert.equal(QuotationRequestSchema.safeParse(baseRequest({ issueDate: 'not-a-date' })).success, false);
});

test('QuotationRequestSchema accepts an optional expiryDate and rejects a malformed one', () => {
  const { QuotationRequestSchema } = loadQuotation();
  assert.equal(QuotationRequestSchema.safeParse(baseRequest({ expiryDate: '2026-09-30' })).success, true);
  assert.equal(QuotationRequestSchema.safeParse(baseRequest({ expiryDate: 'soon' })).success, false);
});

test('QuotationRequestSchema rejects an oversized costingInput array (bounded like the PDF export schema)', () => {
  const { QuotationRequestSchema } = loadQuotation();
  const hugeSheets = Array.from({ length: 6000 }, () => ({
    areaM2: 1,
    quantity: 1,
    pricing: { mode: 'per_m2', value: 1 },
  }));
  const result = QuotationRequestSchema.safeParse(
    baseRequest({ costingInput: costingInput({ material: { sheets: hugeSheets, basis: 'measured' } }) })
  );
  assert.equal(result.success, false);
});

test('QuotationRequestSchema rejects a logoDataUrl that is not a data: URL for png/jpeg', () => {
  const { QuotationRequestSchema } = loadQuotation();
  assert.equal(
    QuotationRequestSchema.safeParse(baseRequest({ logoDataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' })).success,
    false
  );
  assert.equal(QuotationRequestSchema.safeParse(baseRequest({ logoDataUrl: 'not-a-data-url' })).success, false);
});

test('QuotationRequestSchema accepts a well-formed small png logoDataUrl', () => {
  const { QuotationRequestSchema } = loadQuotation();
  const result = QuotationRequestSchema.safeParse(baseRequest({ logoDataUrl: `data:image/png;base64,${'A'.repeat(200)}` }));
  assert.equal(result.success, true);
});

// ─── panels/pieces — bounded, optional detail lines for the FR/AR line-item
// table (Task 8 remediation — item 1). Never trusted for totals: they only
// ever feed the human-readable detail table, `costingInput` alone still
// drives every rendered money figure. ────────────────────────────────────

function panelLine(overrides = {}) {
  return { ref: 'P1', material: 'MDF', widthCm: 280, heightCm: 207, quantity: 1, ...overrides };
}

function pieceLine(overrides = {}) {
  return { pieceNumber: 1, name: 'Panneau latéral', widthCm: 120, heightCm: 60, quantity: 2, ...overrides };
}

test('QuotationRequestSchema defaults panels/pieces to empty arrays when omitted', () => {
  const { QuotationRequestSchema } = loadQuotation();
  const result = QuotationRequestSchema.safeParse(baseRequest());
  assert.equal(result.success, true);
  assert.deepEqual(result.data.panels, []);
  assert.deepEqual(result.data.pieces, []);
});

test('QuotationRequestSchema accepts well-formed panels and pieces', () => {
  const { QuotationRequestSchema } = loadQuotation();
  const result = QuotationRequestSchema.safeParse(
    baseRequest({
      panels: [panelLine()],
      pieces: [pieceLine({ edgeBandedSides: ['top', 'left'], edgeLengthM: 1.8 })],
    })
  );
  assert.equal(result.success, true, JSON.stringify(result.success ? null : result.error.format()));
  assert.equal(result.data.panels[0].ref, 'P1');
  assert.equal(result.data.pieces[0].edgeLengthM, 1.8);
});

test('QuotationRequestSchema rejects a panel/piece with a non-positive dimension', () => {
  const { QuotationRequestSchema } = loadQuotation();
  assert.equal(
    QuotationRequestSchema.safeParse(baseRequest({ panels: [panelLine({ widthCm: 0 })] })).success,
    false
  );
  assert.equal(
    QuotationRequestSchema.safeParse(baseRequest({ pieces: [pieceLine({ heightCm: -5 })] })).success,
    false
  );
});

test('QuotationRequestSchema rejects an oversized panels/pieces array', () => {
  const { QuotationRequestSchema } = loadQuotation();
  const tooManyPanels = Array.from({ length: 51 }, (_, i) => panelLine({ ref: `P${i}` }));
  const tooManyPieces = Array.from({ length: 501 }, (_, i) => pieceLine({ pieceNumber: i }));
  assert.equal(QuotationRequestSchema.safeParse(baseRequest({ panels: tooManyPanels })).success, false);
  assert.equal(QuotationRequestSchema.safeParse(baseRequest({ pieces: tooManyPieces })).success, false);
});

test('QuotationRequestSchema rejects an oversized panel/piece free-text field', () => {
  const { QuotationRequestSchema } = loadQuotation();
  assert.equal(
    QuotationRequestSchema.safeParse(baseRequest({ panels: [panelLine({ material: 'x'.repeat(1000) })] })).success,
    false
  );
  assert.equal(
    QuotationRequestSchema.safeParse(baseRequest({ pieces: [pieceLine({ name: 'x'.repeat(1000) })] })).success,
    false
  );
});

test('QuotationRequestSchema rejects an unknown edgeBandedSides value and a strict-extra key on a piece', () => {
  const { QuotationRequestSchema } = loadQuotation();
  assert.equal(
    QuotationRequestSchema.safeParse(baseRequest({ pieces: [pieceLine({ edgeBandedSides: ['diagonal'] })] })).success,
    false
  );
  assert.equal(
    QuotationRequestSchema.safeParse(baseRequest({ pieces: [{ ...pieceLine(), forgedTotal: 1 }] })).success,
    false
  );
});

// ─── buildQuotationRequestPayload — pure UI-facing helper ──────────────────

test('buildQuotationRequestPayload is a pure identity builder that produces a schema-valid payload', () => {
  const { buildQuotationRequestPayload, QuotationRequestSchema } = loadQuotation();
  const input = {
    costingInput: costingInput(),
    tax: { mode: 'none' },
    discount: { mode: 'none' },
    deliveryCost: 0,
    company: { name: 'Atelier Karim' },
    client: { name: 'Client X' },
    quoteNumber: 'DEV-1',
    issueDate: '2026-08-31',
    locale: 'fr',
    includeAmountInWords: false,
  };
  const payload = buildQuotationRequestPayload(input);
  assert.deepEqual(payload.costingInput, input.costingInput);
  assert.equal(payload.quoteNumber, 'DEV-1');
  assert.equal(QuotationRequestSchema.safeParse(payload).success, true);
});

test('buildQuotationRequestPayload carries projectId through only when supplied', () => {
  const { buildQuotationRequestPayload } = loadQuotation();
  const base = {
    costingInput: costingInput(),
    tax: { mode: 'none' },
    discount: { mode: 'none' },
    deliveryCost: 0,
    company: { name: 'Atelier Karim' },
    client: { name: 'Client X' },
    quoteNumber: 'DEV-1',
    issueDate: '2026-08-31',
    locale: 'fr',
    includeAmountInWords: false,
  };
  assert.equal(buildQuotationRequestPayload(base).projectId, undefined);
  assert.equal(
    buildQuotationRequestPayload({ ...base, projectId: '11111111-2222-4333-8444-555555555555' }).projectId,
    '11111111-2222-4333-8444-555555555555'
  );
});

// ─── suggestQuoteNumber — deterministic default ────────────────────────────

test('suggestQuoteNumber is a deterministic pure function of the given date', () => {
  const { suggestQuoteNumber } = loadQuotation();
  const date = new Date('2026-08-31T10:00:00.000Z');
  assert.equal(suggestQuoteNumber(date), suggestQuoteNumber(new Date('2026-08-31T23:59:00.000Z')));
  assert.match(suggestQuoteNumber(date), /2026.?0?8.?31/);
});

// ─── amountInWords — FR ─────────────────────────────────────────────────

test('amountInWordsFr renders whole-number boundary values correctly', () => {
  const { amountInWordsFr } = loadQuotation();
  const cases = [
    [0, 'zéro dirham'],
    [1, 'un dirham'],
    [2, 'deux dirhams'],
    [10, 'dix dirhams'],
    [16, 'seize dirhams'],
    [17, 'dix-sept dirhams'],
    [20, 'vingt dirhams'],
    [21, 'vingt et un dirhams'],
    [22, 'vingt-deux dirhams'],
    [30, 'trente dirhams'],
    [69, 'soixante-neuf dirhams'],
    [70, 'soixante-dix dirhams'],
    [71, 'soixante et onze dirhams'],
    [72, 'soixante-douze dirhams'],
    [79, 'soixante-dix-neuf dirhams'],
    [80, 'quatre-vingts dirhams'],
    [81, 'quatre-vingt-un dirhams'],
    [89, 'quatre-vingt-neuf dirhams'],
    [90, 'quatre-vingt-dix dirhams'],
    [91, 'quatre-vingt-onze dirhams'],
    [99, 'quatre-vingt-dix-neuf dirhams'],
    [100, 'cent dirhams'],
    [101, 'cent un dirhams'],
    [200, 'deux cents dirhams'],
    [201, 'deux cent un dirhams'],
    [999, 'neuf cent quatre-vingt-dix-neuf dirhams'],
    [1000, 'mille dirhams'],
    [1001, 'mille un dirhams'],
    [2000, 'deux mille dirhams'],
    [21000, 'vingt et un mille dirhams'],
    [100000, 'cent mille dirhams'],
    [1000000, 'un million de dirhams'],
    [2000000, 'deux millions de dirhams'],
    [3000000, 'trois millions de dirhams'],
    [2500000, 'deux millions cinq cent mille dirhams'],
  ];
  for (const [amount, expected] of cases) {
    assert.equal(amountInWordsFr(amount), expected, `amountInWordsFr(${amount})`);
  }
});

// "million"/"millions" is a true noun in French (unlike "cent"/"mille"), so it
// takes "de" before the noun it counts — but only when it is the *last* word
// before that noun (no intervening "mille"/units group). 2 500 000 keeps no
// "de" ("deux millions cinq cent mille dirhams") because "millions" is
// followed by "cinq cent mille", not directly by "dirhams".
test('amountInWordsFr inserts "de" between a bare million count and its noun, but never when thousands/units follow', () => {
  const { amountInWordsFr } = loadQuotation();
  assert.equal(amountInWordsFr(1000000), 'un million de dirhams');
  assert.equal(amountInWordsFr(1000000.5), 'un million de dirhams et cinquante centimes');
  assert.equal(amountInWordsFr(1200000), 'un million deux cent mille dirhams');
  assert.equal(amountInWordsFr(1000001), 'un million un dirhams');
});

test('amountInWordsFr renders centimes with "et"', () => {
  const { amountInWordsFr } = loadQuotation();
  assert.equal(amountInWordsFr(1500.5), 'mille cinq cents dirhams et cinquante centimes');
  assert.equal(amountInWordsFr(10.01), 'dix dirhams et un centime');
  assert.equal(amountInWordsFr(10.0), 'dix dirhams');
});

test('amountInWordsFr is deterministic across repeat calls', () => {
  const { amountInWordsFr } = loadQuotation();
  assert.equal(amountInWordsFr(123456.78), amountInWordsFr(123456.78));
});

test('amountInWordsFr rejects negative amounts and amounts past the documented bound', () => {
  const { amountInWordsFr, AMOUNT_IN_WORDS_MAX_MAD } = loadQuotation();
  assert.throws(() => amountInWordsFr(-1), RangeError);
  assert.throws(() => amountInWordsFr(AMOUNT_IN_WORDS_MAX_MAD + 1), RangeError);
  assert.doesNotThrow(() => amountInWordsFr(AMOUNT_IN_WORDS_MAX_MAD));
});

// ─── amountInWords — AR ─────────────────────────────────────────────────

test('amountInWordsAr renders representative boundary values correctly', () => {
  const { amountInWordsAr } = loadQuotation();
  const cases = [
    [0, 'صفر درهم'],
    [1, 'واحد درهم'],
    [2, 'اثنان درهمان'],
    [3, 'ثلاثة دراهم'],
    [10, 'عشرة دراهم'],
    [11, 'أحد عشر درهم'],
    [20, 'عشرون درهم'],
    [21, 'واحد وعشرون درهم'],
    [100, 'مائة درهم'],
    [200, 'مئتان درهم'],
    [1000, 'ألف درهم'],
    [2000, 'ألفان درهم'],
    [3000, 'ثلاثة آلاف درهم'],
    [11000, 'أحد عشر ألف درهم'],
    [1000000, 'مليون درهم'],
  ];
  for (const [amount, expected] of cases) {
    assert.equal(amountInWordsAr(amount), expected, `amountInWordsAr(${amount})`);
  }
});

// Standard Arabic counted-noun agreement patterns zero with >=11: singular,
// not plural (see arCountedForm's own doc comment in src/lib/quotation.ts).
test('amountInWordsAr uses the singular noun for zero, consistently with >=11 (not the plural)', () => {
  const { amountInWordsAr } = loadQuotation();
  assert.equal(amountInWordsAr(0), 'صفر درهم');
});

test('amountInWordsAr renders centimes joined with "و"', () => {
  const { amountInWordsAr } = loadQuotation();
  assert.equal(amountInWordsAr(10.5), 'عشرة دراهم وخمسون سنتيم');
  assert.equal(amountInWordsAr(10.0), 'عشرة دراهم');
});

test('amountInWordsAr is deterministic across repeat calls', () => {
  const { amountInWordsAr } = loadQuotation();
  assert.equal(amountInWordsAr(123456.78), amountInWordsAr(123456.78));
});

test('amountInWordsAr rejects negative amounts and amounts past the documented bound', () => {
  const { amountInWordsAr, AMOUNT_IN_WORDS_MAX_MAD } = loadQuotation();
  assert.throws(() => amountInWordsAr(-1), RangeError);
  assert.throws(() => amountInWordsAr(AMOUNT_IN_WORDS_MAX_MAD + 1), RangeError);
});

test('amountInWords dispatches to the correct locale-specific renderer', () => {
  const { amountInWords, amountInWordsFr, amountInWordsAr } = loadQuotation();
  assert.equal(amountInWords(1234.5, 'fr'), amountInWordsFr(1234.5));
  assert.equal(amountInWords(1234.5, 'ar'), amountInWordsAr(1234.5));
});

// ─── QUOTATION_TEXT_LIMITS — the single source of truth the UI's maxLength
// attributes must read from, so they can never silently drift from the
// schema bounds (Task 8 remediation — item 2/11) ──────────────────────────

test('QUOTATION_TEXT_LIMITS matches the actual schema bounds', () => {
  const { QUOTATION_TEXT_LIMITS, CompanyIdentitySchema, QuotationRequestSchema } = loadQuotation();
  assert.equal(
    CompanyIdentitySchema.safeParse({ name: 'x'.repeat(QUOTATION_TEXT_LIMITS.shortText) }).success,
    true
  );
  assert.equal(
    CompanyIdentitySchema.safeParse({ name: 'x'.repeat(QUOTATION_TEXT_LIMITS.shortText + 1) }).success,
    false
  );
  assert.equal(
    CompanyIdentitySchema.safeParse({ name: 'x', address: 'a'.repeat(QUOTATION_TEXT_LIMITS.addressText + 1) }).success,
    false
  );
  assert.equal(
    QuotationRequestSchema.safeParse(baseRequest({ notes: 'n'.repeat(QUOTATION_TEXT_LIMITS.notesText + 1) })).success,
    false
  );
});

// ─── sanitizeQuoteNumberForFilename — whitelisted, bounded, safe for both
// the plain ASCII Content-Disposition filename and the client-side download
// attribute (Task 8 remediation — item 6) ──────────────────────────────────

test('sanitizeQuoteNumberForFilename keeps only [A-Za-z0-9._-]', () => {
  const { sanitizeQuoteNumberForFilename } = loadQuotation();
  assert.equal(sanitizeQuoteNumberForFilename('DEV-2026-08-31_001'), 'DEV-2026-08-31_001');
  assert.equal(sanitizeQuoteNumberForFilename('Devis N° 12 (client)'), 'DevisN12client');
});

test('sanitizeQuoteNumberForFilename strips header-injection-shaped characters (quotes, semicolons, CRLF)', () => {
  const { sanitizeQuoteNumberForFilename } = loadQuotation();
  const hostile = 'x"; filename*=UTF-8\'\'evil\r\nX-Injected: 1';
  const result = sanitizeQuoteNumberForFilename(hostile);
  assert.match(result, /^[A-Za-z0-9._-]*$/);
  assert.doesNotMatch(result, /[";\r\n]/);
});

test('sanitizeQuoteNumberForFilename caps length at 64', () => {
  const { sanitizeQuoteNumberForFilename } = loadQuotation();
  const result = sanitizeQuoteNumberForFilename('A'.repeat(200));
  assert.equal(result.length, 64);
});

test('sanitizeQuoteNumberForFilename falls back to DEVIS when nothing whitelisted survives', () => {
  const { sanitizeQuoteNumberForFilename } = loadQuotation();
  assert.equal(sanitizeQuoteNumberForFilename('日本語 عربي'), 'DEVIS');
  assert.equal(sanitizeQuoteNumberForFilename(''), 'DEVIS');
  assert.equal(sanitizeQuoteNumberForFilename('   '), 'DEVIS');
});

test('encodeRfc5987Filename percent-encodes the RFC 5987 attr-char exceptions encodeURIComponent leaves bare', () => {
  const { encodeRfc5987Filename } = loadQuotation();
  // encodeURIComponent alone never escapes ! ' ( ) * — RFC 5987's ext-value
  // grammar (attr-char) excludes all of them, so a strict encoder must.
  const encoded = encodeRfc5987Filename("QatlIA_Devis_a'b(c)*d!.pdf");
  assert.doesNotMatch(encoded, /['()*!]/, `expected no bare RFC5987-unsafe char in: ${encoded}`);
  assert.equal(decodeURIComponent(encoded.replace(/%2A/gi, '*')), "QatlIA_Devis_a'b(c)*d!.pdf");
});

test('encodeRfc5987Filename percent-encodes CR/LF (no header-splitting via filename*)', () => {
  const { encodeRfc5987Filename } = loadQuotation();
  const encoded = encodeRfc5987Filename('evil\r\nX-Injected: 1');
  assert.doesNotMatch(encoded, /[\r\n]/);
});

// ─── Western digits stay LTR: no Arabic-Indic digits ever appear ──────────

test('amountInWordsAr never emits Arabic-Indic digits (Western digits stay LTR per house convention)', () => {
  const { amountInWordsAr } = loadQuotation();
  for (const amount of [0, 5, 42, 1999.99, 1000000]) {
    assert.doesNotMatch(amountInWordsAr(amount), /[٠-٩]/, `amountInWordsAr(${amount}) must not contain Arabic-Indic digits`);
  }
});
