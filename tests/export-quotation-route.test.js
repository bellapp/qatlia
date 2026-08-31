const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule } = require('./helpers/stub-module');

// Task 8 — /api/export-quotation: auth, per-user rate limit, ownership-safe
// projectId merge, logo validation, forged-total rejection, and stable
// non-leaking error codes.

const UUID = '11111111-2222-4333-8444-555555555555';
const PROJECT_ID = '22222222-3333-4444-8888-555555555555';
const OTHER_PROJECT_ID = '33333333-3333-4444-8888-555555555555';

const state = {
  user: null,
  projects: new Map(), // id -> { user_id, options_json }
  updateCalls: [],
  selectCalls: [],
  // Test-injectable hook, called synchronously right after each select is
  // recorded (before the row is read) — lets a test simulate a concurrent
  // write landing between the route's own two selects (see the "concurrent
  // update" tests below).
  onSelect: null,
};

function resetState() {
  state.user = null;
  state.projects = new Map();
  state.updateCalls = [];
  state.selectCalls = [];
  state.onSelect = null;
}

function projectsTable() {
  return {
    select: () => ({
      eq: (_col1, id) => ({
        eq: (_col2, userId) => ({
          maybeSingle: async () => {
            state.selectCalls.push({ id, userId });
            if (state.onSelect) state.onSelect(id, userId, state.selectCalls.length);
            const row = state.projects.get(id);
            if (!row || row.user_id !== userId) return { data: null, error: null };
            return { data: { id, user_id: row.user_id, options_json: row.options_json }, error: null };
          },
        }),
      }),
    }),
    update: (patch) => ({
      eq: (_col1, id) => ({
        eq: async (_col2, userId) => {
          state.updateCalls.push({ id, userId, patch });
          const row = state.projects.get(id);
          if (row && row.user_id === userId) row.options_json = patch.options_json;
          return { data: null, error: null };
        },
      }),
    }),
  };
}

stubModule('@/lib/supabase/server', {
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
  }),
});
stubModule('@supabase/supabase-js', {
  createClient: () => ({
    from: (table) => {
      if (table === 'projects') return projectsTable();
      throw new Error(`unexpected table: ${table}`);
    },
  }),
});

const ENV_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NODE_ENV'];
const CONFIGURED = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://real.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sbsvc_real',
};

function withEnv(overrides, fn) {
  const saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) process.env[key] = value;
  }
  const restore = () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  };
  const result = fn();
  return result && typeof result.then === 'function' ? result.finally(restore) : (restore(), result);
}

function costingInput() {
  return {
    material: { sheets: [{ areaM2: 2, quantity: 1, pricing: { mode: 'per_m2', value: 120 } }], basis: 'measured' },
    edge: { segments: [{ lengthM: 1.6, pricePerMeter: 8 }], basis: 'measured' },
    labor: { pricing: { mode: 'fixed', value: 0 } },
  };
}

function baseBody(overrides = {}) {
  return {
    costingInput: costingInput(),
    tax: { mode: 'none' },
    discount: { mode: 'none' },
    company: { name: 'Atelier Karim' },
    client: { name: 'Client X' },
    quoteNumber: 'DEV-1',
    issueDate: '2026-08-31',
    locale: 'fr',
    includeAmountInWords: false,
    ...overrides,
  };
}

function jsonRequest(body) {
  return new Request('https://qatlia.example/api/export-quotation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function freshRoute() {
  // loadTsModule re-executes the source from scratch on every call (the top
  // file itself is never added to require.cache — only its transitive
  // `require()`d dependencies are) — so each call already gets its own
  // fresh module-scoped rate-limiter instance.
  return loadTsModule('src/app/api/export-quotation/route.ts');
}

// ─── Auth ───────────────────────────────────────────────────────────────

test('requires an authenticated user', async () => {
  resetState();
  await withEnv(CONFIGURED, async () => {
    const { POST } = freshRoute();
    const res = await POST(jsonRequest(baseBody()));
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error, 'AUTH_REQUIRED');
  });
});

// ─── Input validation ───────────────────────────────────────────────────

test('rejects an invalid body with a stable error code, never a raw exception message', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv(CONFIGURED, async () => {
    const { POST } = freshRoute();
    const res = await POST(jsonRequest({ costingInput: costingInput() }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'INVALID_INPUT');
    assert.equal(typeof body.message, 'undefined');
  });
});

test('rejects a request smuggling extra top-level fields (e.g. a forged total) via the strict schema', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv(CONFIGURED, async () => {
    const { POST } = freshRoute();
    const res = await POST(jsonRequest({ ...baseBody(), total: 999999, costBreakdown: { subtotal: 999999 } }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'INVALID_INPUT');
  });
});

test('a residual invalid combination the calculator itself rejects fails safely with a stable code, not a raw message', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv(CONFIGURED, async () => {
    const { POST } = freshRoute();
    // Schema bounds discount.value generically; only computeQuotationTotals
    // itself knows a *percentage* discount cannot exceed 100.
    const res = await POST(jsonRequest(baseBody({ discount: { mode: 'percentage', value: 150 } })));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'QUOTATION_COMPUTATION_FAILED');
    assert.equal(JSON.stringify(body).includes('RangeError'), false, 'no raw internal exception text may leak');
  });
});

// ─── The server always recomputes totals; it never trusts client figures ──

test('never renders a client-forged costBreakdown/total — totals always come from computeQuotationDocumentTotals', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv(CONFIGURED, async () => {
    const { computeQuotationDocumentTotals } = loadTsModule('src/lib/quotation.ts');
    const { POST } = freshRoute();
    const body = baseBody({ tax: { mode: 'percentage', ratePercent: 20 }, deliveryCost: 30 });
    const res = await POST(jsonRequest(body));
    assert.equal(res.status, 200);

    const expected = computeQuotationDocumentTotals(body.costingInput, body.tax, body.discount, body.deliveryCost);
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('latin1');
    const expectedTotalLabel = expected.total.toFixed(2).replace('.', ',');
    assert.ok(text.includes(expectedTotalLabel), `expected the exact recomputed total (${expectedTotalLabel}) in the PDF bytes`);
  });
});

// ─── Rate limit: after auth, before the expensive render ─────────────────

test('a burst past the per-user rate limit is refused with Retry-After', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv(CONFIGURED, async () => {
    const { QUOTATION_RATE_LIMIT } = loadTsModule('src/lib/rate-limit.ts');
    const { POST } = freshRoute();

    const responses = [];
    for (let i = 0; i < QUOTATION_RATE_LIMIT.limit + 1; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      responses.push(await POST(jsonRequest(baseBody())));
    }

    const denied = responses[responses.length - 1];
    assert.deepEqual(
      responses.slice(0, -1).map((res) => res.status),
      Array(QUOTATION_RATE_LIMIT.limit).fill(200)
    );
    assert.equal(denied.status, 429);
    assert.ok(Number(denied.headers.get('Retry-After')) > 0);
    const body = await denied.json();
    assert.equal(body.error, 'RATE_LIMITED');
  });
});

// ─── projectId ownership: 404-safe, no existence leak ─────────────────────

test('generates without a projectId and performs no DB write', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv(CONFIGURED, async () => {
    const { POST } = freshRoute();
    const res = await POST(jsonRequest(baseBody()));
    assert.equal(res.status, 200);
    assert.equal(state.updateCalls.length, 0);
    assert.equal(res.headers.get('X-Quotation-Project-Saved'), null);
  });
});

test('a projectId that does not exist is rejected with the same 404 code as one owned by another user', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  state.projects.set(OTHER_PROJECT_ID, { user_id: 'someone-else', options_json: { options: {}, pieces: [], result: {} } });
  await withEnv(CONFIGURED, async () => {
    const { POST } = freshRoute();

    const missing = await POST(jsonRequest(baseBody({ projectId: PROJECT_ID })));
    const notOwned = await POST(jsonRequest(baseBody({ projectId: OTHER_PROJECT_ID })));

    assert.equal(missing.status, 404);
    assert.equal(notOwned.status, 404);
    const missingBody = await missing.json();
    const notOwnedBody = await notOwned.json();
    assert.deepEqual(missingBody, notOwnedBody, 'identical response for "missing" and "not yours" — no existence leak');
    assert.equal(state.updateCalls.length, 0, 'ownership must be verified before any write');
  });
});

test('a valid owned projectId merges quotation metadata without clobbering options/pieces/result', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  const existingOptionsJson = {
    options: { kerfWidth: 3 },
    pieces: [{ name: 'Panneau', height: 10, width: 20, quantity: 1 }],
    sheet: { width: 208, height: 278 },
    result: { sheetsUsed: 1 },
    displayUnit: 'cm',
  };
  state.projects.set(PROJECT_ID, { user_id: UUID, options_json: existingOptionsJson });

  await withEnv(CONFIGURED, async () => {
    const { POST } = freshRoute();
    const res = await POST(
      jsonRequest(baseBody({ projectId: PROJECT_ID, notes: 'Livraison sous 5 jours' }))
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('X-Quotation-Project-Saved'), 'true');

    assert.equal(state.updateCalls.length, 1);
    const saved = state.updateCalls[0].patch.options_json;
    assert.deepEqual(saved.options, existingOptionsJson.options, 'options must survive untouched');
    assert.deepEqual(saved.pieces, existingOptionsJson.pieces, 'pieces must survive untouched');
    assert.deepEqual(saved.result, existingOptionsJson.result, 'result must survive untouched');
    assert.equal(saved.displayUnit, 'cm', 'unrelated metadata must survive untouched');
    assert.ok(saved.quotation, 'a quotation key must be merged in');
    assert.equal(saved.quotation.company.name, 'Atelier Karim');
    assert.equal(saved.quotation.client.name, 'Client X');
    assert.equal(saved.quotation.notes, 'Livraison sous 5 jours');
    assert.equal(JSON.stringify(saved).includes('logoDataUrl') || JSON.stringify(saved).includes('base64'), false, 'the raw logo must never be persisted');
  });
});

// ─── Logo validation ───────────────────────────────────────────────────

test('rejects an invalid logo (SVG/mismatched magic bytes) before generating anything, with a stable code', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv(CONFIGURED, async () => {
    const { POST } = freshRoute();
    const res = await POST(jsonRequest(baseBody({ logoDataUrl: `data:image/png;base64,${'a'.repeat(200)}` })));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'LOGO_INVALID');
  });
});

test('accepts a well-formed small PNG logo and still returns 200', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  const TINY_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  await withEnv(CONFIGURED, async () => {
    const { POST } = freshRoute();
    const res = await POST(jsonRequest(baseBody({ logoDataUrl: `data:image/png;base64,${TINY_PNG_BASE64}` })));
    assert.equal(res.status, 200);
  });
});

// ─── PDF content: FR/AR, amount words, notes, filename ────────────────────

test('renders company, client, quote number and notes into the FR PDF', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv(CONFIGURED, async () => {
    const { POST } = freshRoute();
    const res = await POST(jsonRequest(baseBody({ notes: 'Merci de votre confiance' })));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'application/pdf');
    const disposition = res.headers.get('Content-Disposition');
    assert.match(disposition, /attachment; filename="[\x20-\x7E]+\.pdf"/);
    assert.match(disposition, /filename\*=UTF-8''/);

    const text = Buffer.from(await res.arrayBuffer()).toString('latin1');
    assert.ok(text.includes('DEV-1'));
    assert.ok(text.includes('ATELIER KARIM') || text.includes('Atelier Karim'));
  });
});

test('includes amount-in-words only when includeAmountInWords is true', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv(CONFIGURED, async () => {
    const { amountInWordsFr } = loadTsModule('src/lib/quotation.ts');
    const { computeQuotationDocumentTotals } = loadTsModule('src/lib/quotation.ts');
    const { POST } = freshRoute();

    const body = baseBody({ includeAmountInWords: true });
    const res = await POST(jsonRequest(body));
    assert.equal(res.status, 200);
    const totals = computeQuotationDocumentTotals(body.costingInput, body.tax, body.discount, 0);
    const words = amountInWordsFr(totals.total);
    const text = Buffer.from(await res.arrayBuffer()).toString('latin1');
    // jsPDF's own text pipeline may re-wrap the phrase across lines; check
    // for a substantial, order-preserving fragment rather than the exact
    // whole string.
    assert.ok(text.includes(words.split(' ').slice(0, 3).join(' ')), `expected amount-in-words fragment in: ${text.slice(0, 400)}`);
  });
});

test('VAT off is explicit: tax.mode none renders zero tax and never a fabricated 20% line', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv(CONFIGURED, async () => {
    const { POST } = freshRoute();
    const res = await POST(jsonRequest(baseBody({ tax: { mode: 'none' } })));
    assert.equal(res.status, 200);
    const text = Buffer.from(await res.arrayBuffer()).toString('latin1');
    assert.ok(!/TVA 20%/.test(text), 'no default 20% VAT may ever be fabricated');
  });
});

// ─── Every route error code has localized copy (mirrors the checkout/vision
// coverage pattern in tests/i18n-secondary-catalog.test.js) ────────────────

test('every /api/export-quotation error code has localized copy in every locale', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { QUOTATION_ERROR_KEYS, quotationErrorKey } = loadTsModule('src/i18n/domain.ts');
  const { LOCALES, translate } = loadTsModule('src/i18n/index.ts');

  const routeSource = fs.readFileSync(
    path.resolve(__dirname, '..', 'src/app/api/export-quotation/route.ts'),
    'utf8'
  );
  const codes = [...routeSource.matchAll(/error: '([A-Z_]+)'/g)].map((match) => match[1]);
  assert.ok(codes.length >= 5, 'the route should still return several machine-readable error codes');

  for (const code of new Set(codes)) {
    assert.ok(QUOTATION_ERROR_KEYS[code], `no localized copy for quotation error code "${code}"`);
    for (const locale of LOCALES) {
      const key = QUOTATION_ERROR_KEYS[code];
      assert.notEqual(translate(locale, key), key, `${locale} has no copy for "${key}"`);
    }
  }
  assert.equal(quotationErrorKey('SOMETHING_NEW'), 'quotation.errors.generic');
  assert.equal(quotationErrorKey(undefined), 'quotation.errors.generic');
});

// ─── Item 8: Content-Length/byte cap + rate limit before req.json/validation ─

function rawRequest(bodyText) {
  return new Request('https://qatlia.example/api/export-quotation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: bodyText,
  });
}

test('an oversized body is rejected 413 before it is ever parsed', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv(CONFIGURED, async () => {
    const { POST } = freshRoute();
    // Deliberately malformed/oversized past any schema bound — the point is
    // that the byte cap rejects it before JSON.parse or zod ever see it.
    const huge = '{"notes":"' + 'x'.repeat(4_000_000) + '"}';
    const res = await POST(rawRequest(huge));
    assert.equal(res.status, 413);
    const body = await res.json();
    assert.equal(body.error, 'PAYLOAD_TOO_LARGE');
    assert.equal(typeof body.message, 'undefined');
  });
});

test('oversized/invalid requests still consume the rate limit, so a flood of them cannot bypass it', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv(CONFIGURED, async () => {
    const { QUOTATION_RATE_LIMIT } = loadTsModule('src/lib/rate-limit.ts');
    const { POST } = freshRoute();

    const huge = '{"notes":"' + 'x'.repeat(4_000_000) + '"}';
    const responses = [];
    for (let i = 0; i < QUOTATION_RATE_LIMIT.limit; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      responses.push(await POST(rawRequest(huge)));
    }
    assert.deepEqual(responses.map((r) => r.status), Array(QUOTATION_RATE_LIMIT.limit).fill(413));

    // The limit is now exhausted purely by oversized requests — even a
    // perfectly valid one must be denied.
    const nextValid = await POST(jsonRequest(baseBody()));
    assert.equal(nextValid.status, 429);
  });
});

// ─── Item 6: filename whitelist — a hostile quoteNumber must never break the
// Content-Disposition header's quoted filename parameter ───────────────────

test('a hostile quoteNumber never breaks the Content-Disposition header — the ASCII filename stays whitelist-only', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv(CONFIGURED, async () => {
    const { POST } = freshRoute();
    const hostile = 'DEV "1"; filename*=UTF-8\'\'evil (x)*\r\nX-Injected: 1';
    const res = await POST(jsonRequest(baseBody({ quoteNumber: hostile })));
    assert.equal(res.status, 200);

    const disposition = res.headers.get('Content-Disposition');
    assert.doesNotMatch(disposition, /[\r\n]/, 'no raw CR/LF may reach the header value');
    const asciiMatch = disposition.match(/filename="([^"]*)"/);
    assert.ok(asciiMatch, `expected a quoted ascii filename in: ${disposition}`);
    assert.match(asciiMatch[1], /^[A-Za-z0-9._-]+\.pdf$/, `ascii filename must be whitelist-only, got: ${asciiMatch[1]}`);
    // The hostile payload may still appear *inert*, percent-encoded, inside
    // the filename* value (e.g. "...%0D%0AX-Injected%3A...") — that is safe
    // and expected. What must never appear is the payload un-encoded, which
    // would actually inject a new header line.
    assert.doesNotMatch(disposition, /\r\nX-Injected:/, 'no header-injection payload may survive un-encoded into the response header');
  });
});

// ─── Item 5: amount-in-words past the documented bound is a stable 400 ────

test('includeAmountInWords with a total past AMOUNT_IN_WORDS_MAX_MAD is a stable 400, never a 500', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv(CONFIGURED, async () => {
    const { POST } = freshRoute();
    const hugeCostingInput = {
      material: { sheets: [{ areaM2: 1000, quantity: 200, pricing: { mode: 'per_m2', value: 1000 } }], basis: 'measured' },
      edge: { segments: [], basis: 'measured' },
      labor: { pricing: { mode: 'fixed', value: 0 } },
    };
    const res = await POST(
      jsonRequest(baseBody({ costingInput: hugeCostingInput, includeAmountInWords: true }))
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'AMOUNT_IN_WORDS_TOO_LARGE');
    assert.equal(JSON.stringify(body).includes('RangeError'), false);
  });
});

test('the same huge total without includeAmountInWords still succeeds (the bound is scoped to amount-in-words only)', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv(CONFIGURED, async () => {
    const { POST } = freshRoute();
    const hugeCostingInput = {
      material: { sheets: [{ areaM2: 1000, quantity: 200, pricing: { mode: 'per_m2', value: 1000 } }], basis: 'measured' },
      edge: { segments: [], basis: 'measured' },
      labor: { pricing: { mode: 'fixed', value: 0 } },
    };
    const res = await POST(
      jsonRequest(baseBody({ costingInput: hugeCostingInput, includeAmountInWords: false }))
    );
    assert.equal(res.status, 200);
  });
});

// ─── Item 9: the logo is embedded from validated decoded bytes, never the
// raw client-submitted data URL string ──────────────────────────────────

test('addImage is called with the validated decoded Uint8Array bytes, not the raw data URL string', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  const TINY_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const dataUrl = `data:image/png;base64,${TINY_PNG_BASE64}`;

  const { jsPDF } = require('jspdf');
  const { validateLogoDataUrl } = loadTsModule('src/lib/exports/quotation-logo.ts');
  const expectedBytes = validateLogoDataUrl(dataUrl);
  assert.equal(expectedBytes.ok, true);

  // jsPDF instances get their own *own-property* `addImage` (copied from
  // `jsPDF.API` at construction time via its plugin-mixin architecture), so
  // patching `jsPDF.prototype.addImage` has no effect on instances created
  // afterwards — `jsPDF.API.addImage` is the actual source every new
  // instance copies from and is what must be patched here.
  const calls = [];
  const original = jsPDF.API.addImage;
  jsPDF.API.addImage = function spy(...args) {
    calls.push(args);
    return original.apply(this, args);
  };
  try {
    await withEnv(CONFIGURED, async () => {
      const { POST } = freshRoute();
      const res = await POST(jsonRequest(baseBody({ logoDataUrl: dataUrl })));
      assert.equal(res.status, 200);
    });
  } finally {
    jsPDF.API.addImage = original;
  }

  assert.equal(calls.length, 1, 'expected exactly one addImage call for the one logo');
  const [imageArg] = calls[0];
  assert.equal(typeof imageArg, 'object', 'the image argument must not be the raw data URL string');
  assert.ok(imageArg instanceof Uint8Array, 'addImage must receive the validated decoded bytes');
  assert.deepEqual(Array.from(imageArg), Array.from(expectedBytes.bytes));
});

// ─── Item 10: concurrent update — the merge re-fetches immediately before
// writing, so a concurrent update landing in between is not silently
// clobbered by a stale snapshot ────────────────────────────────────────────

test('re-fetches the project immediately before merging/updating, so a concurrent write is not overwritten with a stale snapshot', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  const initial = { options: { kerfWidth: 3 }, pieces: [{ name: 'Initial' }], result: {}, displayUnit: 'cm' };
  const concurrentlyWritten = { options: { kerfWidth: 5 }, pieces: [{ name: 'ConcurrentlyUpdated' }], result: {}, displayUnit: 'mm' };
  state.projects.set(PROJECT_ID, { user_id: UUID, options_json: initial });

  state.onSelect = (id, _userId, callIndex) => {
    // Simulate another request's write landing between the route's own
    // early ownership check and its pre-update re-fetch.
    if (id === PROJECT_ID && callIndex === 1) {
      state.projects.set(PROJECT_ID, { user_id: UUID, options_json: concurrentlyWritten });
    }
  };

  await withEnv(CONFIGURED, async () => {
    const { POST } = freshRoute();
    const res = await POST(jsonRequest(baseBody({ projectId: PROJECT_ID })));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('X-Quotation-Project-Saved'), 'true');
  });

  assert.ok(state.selectCalls.length >= 2, 'expected at least two selects: the early ownership check and a fresh re-fetch before the update');
  assert.equal(state.updateCalls.length, 1);
  const saved = state.updateCalls[0].patch.options_json;
  assert.deepEqual(saved.options, concurrentlyWritten.options, 'the update must be based on the freshly re-fetched value, not the stale early lookup');
  assert.deepEqual(saved.pieces, concurrentlyWritten.pieces);
  assert.equal(saved.displayUnit, 'mm');
  assert.ok(saved.quotation, 'the quotation metadata must still be merged in');
});

// ─── Item 4: preTaxBase renders, never an independently recomputed figure ──

test('the rendered subtotal-including-delivery line comes from totals.preTaxBase, matching computeQuotationDocumentTotals exactly', async () => {
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv(CONFIGURED, async () => {
    const { computeQuotationDocumentTotals } = loadTsModule('src/lib/quotation.ts');
    const { POST } = freshRoute();
    const body = baseBody({ deliveryCost: 40 });
    const res = await POST(jsonRequest(body));
    assert.equal(res.status, 200);

    const expected = computeQuotationDocumentTotals(body.costingInput, body.tax, body.discount, body.deliveryCost);
    const text = Buffer.from(await res.arrayBuffer()).toString('latin1');
    const preTaxLabel = expected.preTaxBase.toFixed(2).replace('.', ',');
    assert.ok(text.includes(preTaxLabel), `expected the exact preTaxBase (${preTaxLabel}) in the PDF bytes`);
  });
});

test('renders an Arabic-locale PDF without throwing, as a real parseable multi-KB document', async () => {
  // Proper glyph-level extraction of the embedded-font Arabic content is
  // covered end-to-end in tests/quotation-artifact.test.js (pdfjs-dist +
  // @napi-rs/canvas, mirroring tests/pdf-artifact.test.js) — this route test
  // stays focused on the HTTP-level contract.
  resetState();
  state.user = { id: UUID, email: 'artisan@example.ma' };
  await withEnv(CONFIGURED, async () => {
    const { POST } = freshRoute();
    const res = await POST(jsonRequest(baseBody({ locale: 'ar', client: { name: 'الزبون' } })));
    assert.equal(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 3000, `expected a real embedded-font PDF, got ${buf.length} bytes`);
  });
});
