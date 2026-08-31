const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { loadTsModule } = require('./helpers/load-ts-module');

// Task 6 slice 3. Every numeric claim QatlIA shows a customer must either be
// reproducible from a checked-in fixture or not be made at all. These tests
// are the audit: they fail if an unsupported yield/waste/money figure comes
// back into the product copy, and if the published methodology stops matching
// what the benchmark runner actually measures.

const BENCHMARK_DOC = 'docs/optimizer-benchmark.md';
const FIXTURES_DOC = 'tests/fixtures/benchmarks/README.md';
const SAVED_RUNS_DOC = 'saved_runs/README.md';

/**
 * Digits customer-facing copy might write a number in: Western 0-9,
 * Arabic-Indic ٠-٩, Persian ۰-۹. A fabricated "٨٠٪" is exactly as unsupported
 * as a fabricated "80%" and must be caught the same way.
 */
const PERCENT_DIGIT_CLASS = '[0-9\\u0660-\\u0669\\u06F0-\\u06F9]';
const PERCENT_NUMBER_SOURCE = `${PERCENT_DIGIT_CLASS}+(?:[.,\\u066B]${PERCENT_DIGIT_CLASS}+)?`;
const PERCENT_SIGN_SOURCE = '(?:%|\\u066A)';

/**
 * Any yield/waste percentage claim, in any digit script and either percent
 * sign — QatlIA has never measured a single percentage that generalizes
 * across jobs, so no number followed by a percent sign belongs in customer
 * copy. Every use below constructs a fresh `RegExp` rather than sharing one
 * `g`-flagged instance across `.test()` calls, so there is no `lastIndex`
 * state to leak between unrelated strings.
 */
function hasUnsupportedPercentClaim(text) {
  return new RegExp(`${PERCENT_NUMBER_SOURCE}\\s*${PERCENT_SIGN_SOURCE}`).test(text);
}

/**
 * Strips CSS/SVG position geometry that happens to contain a percent sign —
 * not a customer-facing claim — before a literal is checked for a real
 * percentage claim. Narrow and explicit by design: only two things are ever
 * stripped, and both are tied to a concrete, verified non-claim origin:
 *   - the argument list of a `radial-gradient()`/`linear-gradient()`/
 *     `conic-gradient()` CSS function (Tailwind arbitrary-value background
 *     positions such as `circle_at_50%`, `transparent_45%` live only here);
 *   - an exact SVG gradient-stop offset of "0%" or "100%".
 * Anything else containing a percent sign — including prose sitting right
 * next to a gradient in the same literal — still gets checked.
 */
function stripGeometryTokens(literal) {
  if (literal === '0%' || literal === '100%') return '';
  return literal.replace(/(?:radial|linear|conic)-gradient\([\s\S]*?\)\]/g, '');
}

/**
 * Exact non-claim literals that would otherwise trip the percent-claim scan,
 * pinned by their full current text so this allowlist cannot silently grow
 * to cover something new: if the literal changes even slightly, the pin
 * stops matching and the scan is back to catching it.
 */
const NON_CLAIM_PERCENT_LITERALS = new Set([
  // Range-validation error describing the valid domain of a rate input
  // (0-100%) — a constraint on what callers may pass in, not a claim about a
  // measured result.
  'computeQuotationTotals: tax.ratePercent cannot exceed a documented sane cap of 100 (100%)',
]);

/** Strips `//` and `/* *‍/` comments so string-literal scanning does not trip over prose inside JSDoc. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Money-saved wording: an "economy" figure QatlIA has no measurement for. */
const MONEY_SAVED_CLAIM = /économie|économis|savings|you save|gagnez|\bgain de\b|توفير|وفّر|ربح/i;

function read(relativePath) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8');
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function flatten(node, prefix = '', target = {}) {
  for (const [key, value] of Object.entries(node)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') flatten(value, dotted, target);
    else target[dotted] = value;
  }
  return target;
}

function loadCatalogs() {
  return loadTsModule('src/i18n/index.ts').catalogs;
}

function benchmarkMarkdown() {
  return execFileSync(process.execPath, [path.resolve('scripts/benchmark-optimizer.mjs'), '--format=markdown'], {
    encoding: 'utf8',
    cwd: path.resolve('.'),
  });
}

function benchmarkReport() {
  return JSON.parse(
    execFileSync(process.execPath, [path.resolve('scripts/benchmark-optimizer.mjs')], {
      encoding: 'utf8',
      cwd: path.resolve('.'),
    })
  );
}

test('no locale catalog carries an unmeasured percentage claim, in any digit script', () => {
  const catalogs = loadCatalogs();

  for (const [locale, catalog] of Object.entries(catalogs)) {
    for (const [key, value] of Object.entries(flatten(catalog))) {
      assert.equal(
        hasUnsupportedPercentClaim(String(value)),
        false,
        `${locale}.${key} still advertises an unmeasured percentage: ${value}`
      );
    }
  }
});

test('the percentage-claim detector actually catches Western, Arabic-Indic and Persian digit claims', () => {
  // Proves the detector would catch a fabrication rather than merely
  // inspecting the current (already-clean) catalogs above.
  assert.equal(hasUnsupportedPercentClaim('Save 80% on every job'), true);
  assert.equal(hasUnsupportedPercentClaim('وفّر ٨٠٪ من الوقت'), true, 'Arabic-Indic digits must be caught');
  assert.equal(hasUnsupportedPercentClaim('صرفه‌جویی ۸۰٪'), true, 'Persian digits must be caught');
  assert.equal(hasUnsupportedPercentClaim('This plan uses 4 sheets'), false, 'a sheet count with no percent sign must not be flagged');

  // Calling the detector many times in a row, on different strings, must not
  // leak `lastIndex` state from a previous call (the classic bug with a
  // shared `g`-flagged RegExp reused across `.test()` calls).
  const strings = ['80% off', 'nothing here', '٨٠٪ off', 'still nothing', '۸۰٪ off'];
  assert.deepEqual(
    strings.map(hasUnsupportedPercentClaim),
    [true, false, true, false, true],
    'repeated calls must not skip a match due to stale regex lastIndex state'
  );
});

test('no locale catalog promises money saved', () => {
  const catalogs = loadCatalogs();

  for (const [locale, catalog] of Object.entries(catalogs)) {
    for (const [key, value] of Object.entries(flatten(catalog))) {
      assert.equal(MONEY_SAVED_CLAIM.test(value), false, `${locale}.${key} promises money saved: ${value}`);
    }
  }
});

test('the money-claim detector also catches Arabic saving/gain wording without blocking a plain MAD price', () => {
  assert.equal(MONEY_SAVED_CLAIM.test('وفّر 500 درهم اليوم'), true, 'an Arabic "save X MAD" claim must be caught');
  assert.equal(MONEY_SAVED_CLAIM.test('توفير مضمون على كل ورشة'), true, 'an Arabic "guaranteed saving" claim must be caught');
  assert.equal(MONEY_SAVED_CLAIM.test('ربح إضافي مع كل تصميم'), true, 'an Arabic "extra profit" claim must be caught');
  assert.equal(MONEY_SAVED_CLAIM.test('الأوفر (199 DH)'), false, 'the "best value" pricing-tier badge must not be flagged');
  assert.equal(MONEY_SAVED_CLAIM.test('الدفع غير متوفر مؤقتاً'), false, '"temporarily unavailable" must not be flagged');
  assert.equal(MONEY_SAVED_CLAIM.test('199 DH / شهرياً'), false, 'a plain MAD price must not be flagged');
});

test('the landing hero no longer renders a hard-coded waste figure', () => {
  const catalogs = loadCatalogs();
  const source = read('src/app/landing-page.tsx');

  for (const [locale, catalog] of Object.entries(catalogs)) {
    assert.equal('wasteFigure' in catalog.hero, false, `${locale} still defines hero.wasteFigure`);
    assert.equal(
      catalog.hero.subtitle.includes('{waste}'),
      false,
      `${locale} hero subtitle still interpolates a waste figure`
    );
  }

  assert.equal(source.includes('wasteFigure'), false, 'The landing page must no longer render hero.wasteFigure');
  assert.equal(source.includes('{waste}'), false, 'The landing page must no longer split the subtitle on a waste placeholder');
});

test('the landing stats tiles keep FR/EN/AR parity and only claim what is verifiable', () => {
  const catalogs = loadCatalogs();
  const frKeys = Object.keys(flatten(catalogs.fr.stats)).sort();

  assert.ok(frKeys.length > 0, 'The stats section must still exist');
  for (const [locale, catalog] of Object.entries(catalogs)) {
    assert.deepEqual(Object.keys(flatten(catalog.stats)).sort(), frKeys, `${locale} stats keys drifted from French`);
    for (const [key, value] of Object.entries(flatten(catalog.stats))) {
      assert.ok(String(value).trim().length > 0, `${locale} stats.${key} is empty`);
    }
  }
});

// Real single/double-quoted JS string literals can never contain a raw
// (unescaped) newline — only backtick template literals can span lines. The
// previous version of this scan allowed all three quote kinds to span lines,
// which let a `'`/`"` "literal" balloon across unrelated code (comments,
// JSX, other strings) whenever the file had an odd number of stray quote
// characters before the real one, and would have silently hidden a genuine
// fabricated claim inside that garbled span.
const STRING_LITERAL = /`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g;

test('no customer-facing source file hard-codes a percentage claim in a string literal, in any digit script', () => {
  const offenders = [];

  for (const file of walk(path.resolve('src'))) {
    const source = stripComments(fs.readFileSync(file, 'utf8'));
    for (const match of source.matchAll(STRING_LITERAL)) {
      const literal = match[0].slice(1, -1);
      if (NON_CLAIM_PERCENT_LITERALS.has(literal)) continue;
      if (hasUnsupportedPercentClaim(stripGeometryTokens(literal))) {
        offenders.push(`${path.relative(path.resolve('.'), file)}: ${match[0]}`);
      }
    }
  }

  assert.deepEqual(offenders, [], `Unsupported percentage claims still in customer-facing source:\n${offenders.join('\n')}`);
});

test('the string-literal scanner does not balloon a quoted literal across a raw newline', () => {
  const source = "const a = 'it' + \"is fine\";\nconst claim = 'save 80%';";
  const literals = [...source.matchAll(STRING_LITERAL)].map((match) => match[0]);
  assert.deepEqual(literals, ["'it'", '"is fine"', "'save 80%'"]);
});

test('the geometry allowlist is narrow: it does not swallow a fabricated claim planted next to CSS', () => {
  assert.equal(hasUnsupportedPercentClaim(stripGeometryTokens('0%')), false);
  assert.equal(hasUnsupportedPercentClaim(stripGeometryTokens('100%')), false);
  assert.equal(
    hasUnsupportedPercentClaim(stripGeometryTokens('bg-[radial-gradient(800px_circle_at_50%_50%,transparent_70%)]')),
    false,
    'a Tailwind radial-gradient position string must not be flagged'
  );
  assert.equal(
    hasUnsupportedPercentClaim(stripGeometryTokens('80% off, guaranteed')),
    true,
    'prose next to a percent sign must not be waved through'
  );
  assert.equal(
    hasUnsupportedPercentClaim(
      stripGeometryTokens('bg-[radial-gradient(800px_circle_at_50%_50%,transparent_70%)] save 80% today')
    ),
    true,
    'a fabricated claim planted next to a CSS gradient must still be caught'
  );
});

test('the landing page links to no methodology route that does not exist', () => {
  const source = read('src/app/landing-page.tsx');
  const hrefs = [...source.matchAll(/href="(\/[^"]*)"/g)].map((match) => match[1]);
  const appDir = path.resolve('src/app');

  for (const href of hrefs) {
    const segments = href.split('/').filter(Boolean);
    const routeFile = path.join(appDir, ...segments, 'page.tsx');
    assert.ok(
      fs.existsSync(routeFile),
      `Landing page links to ${href}, but ${path.relative(path.resolve('.'), routeFile)} does not exist`
    );
  }
  assert.equal(source.includes('href="/docs'), false, 'Markdown docs are not a web route; do not link to them from the UI');
});

test('the fixture README documents provenance and canonical parameters for both fixtures', () => {
  const doc = read(FIXTURES_DOC);

  assert.ok(doc.includes('standard-135'), 'Fixture README must document standard-135');
  assert.ok(doc.includes('standard-16'), 'Fixture README must document standard-16');
  assert.ok(doc.includes('saved_runs/test_runs.json#run_01_somfy_notes_mdf'), 'Fixture README must state where standard-135 came from');
  assert.match(doc, /278/, 'Fixture README must state the canonical sheet height');
  assert.match(doc, /208/, 'Fixture README must state the canonical sheet width');
  assert.match(doc, /0\.3/, 'Fixture README must state the canonical kerf');
  assert.match(doc, /linear_guillotine/, 'Fixture README must state the canonical objective');
  assert.match(doc, /npm run benchmark:optimizer/, 'Fixture README must state how to reproduce');
});

test('the benchmark doc publishes methodology, reproduction command and provenance', () => {
  const doc = read(BENCHMARK_DOC);

  assert.match(doc, /npm run benchmark:optimizer/, 'The doc must state the exact reproduction command');
  assert.match(doc, /## Methodology/i);
  assert.match(doc, /## Fixture provenance/i);
  assert.ok(doc.includes('saved_runs/test_runs.json#run_01_somfy_notes_mdf'));
  assert.ok(doc.includes('tests/fixtures/benchmarks/standard-135.json'));
  assert.ok(doc.includes('tests/fixtures/benchmarks/standard-16.json'));
  assert.match(doc, /lower bound/i, 'The doc must explain the area lower bound');
  assert.match(doc, /kerf/i, 'The doc must state what the lower bound excludes');
});

/**
 * Detects a sentence claiming the 51-piece fixture actually achieved a low
 * sheet count, in either word order a claim could be phrased in:
 *   - piece-first — "the 51-piece fixture achieved a result on 3 sheets"
 *   - sheet-first — "achieved a result on 3 sheets for the 51 pieces", or
 *     with a fractional sheet count such as "packed 3/3 sheets ... 51 pieces"
 * rather than merely mentioning the number 51 and the word "sheets" anywhere
 * in a document that also happens to say "not published" somewhere else
 * entirely. Each branch is scoped to a window right around "51... piece" so a
 * real claim a few sentences away from the disclaimer still gets caught, and
 * an unrelated "N sheets" mention elsewhere in the same document (e.g. a
 * different fixture's sheet size) does not.
 */
const RESULT_VERB_SOURCE = '(?:achiev\\w*|reach\\w*|uses?|used|pack(?:ed|s)?|fits?|met|requires?|needs?)';
const SHEETS_COUNT_SOURCE = '[0-3](?:\\s*/\\s*[0-3])?\\s*sheets?';
const PIECE_51_SOURCE = '51[- ]?piece\\w*';
const FABRICATED_51_PIECE_RESULT = new RegExp(
  // piece-first: "51-piece ... achieved/used/packed/reached ... <=3 sheets"
  `${PIECE_51_SOURCE}[\\s\\S]{0,150}?\\b${RESULT_VERB_SOURCE}\\b[\\s\\S]{0,80}?\\b${SHEETS_COUNT_SOURCE}\\b` +
    '|' +
    // sheet-first: "achieved/used/packed/reached ... <=3/3 sheets ... for/on ... 51 pieces"
    `\\b${RESULT_VERB_SOURCE}\\b[\\s\\S]{0,80}?\\b${SHEETS_COUNT_SOURCE}\\b[\\s\\S]{0,80}?\\b(?:for|on)\\b[\\s\\S]{0,40}?\\b${PIECE_51_SOURCE}\\b`,
  'i'
);

test('the benchmark doc and the fixture README state why the planned 51-piece fixture is not published', () => {
  for (const docPath of [BENCHMARK_DOC, FIXTURES_DOC]) {
    const doc = read(docPath);

    assert.match(doc, /51/, `${docPath} must address the planned 51-piece fixture`);
    assert.match(
      doc,
      /source data (is )?(not available|unavailable)/i,
      `${docPath} must say the 51-piece fixture is unpublished because its source data is unavailable`
    );
    assert.equal(
      FABRICATED_51_PIECE_RESULT.test(doc),
      false,
      `${docPath} must not assert that the 51-piece fixture achieved/reached/used/packed a sheet result, in either word order`
    );
  }
});

test('the fabricated-51-piece-result detector actually catches a planted claim, in both piece-first and sheet-first wording', () => {
  // Proves the detector above would fail a real fabrication, rather than
  // merely inspecting the current (already-honest) doc text.

  // piece-first: "51-piece ... <verb> ... <=3 sheets"
  assert.equal(
    FABRICATED_51_PIECE_RESULT.test('The 51-piece fixture achieved a result on 3 sheets.'),
    true,
    'must catch a piece-first "achieved" claim'
  );
  assert.equal(
    FABRICATED_51_PIECE_RESULT.test('Our 51-piece dry run packed everything onto 2 sheets.'),
    true,
    'must catch a piece-first "packed" claim'
  );

  // sheet-first: "<verb> ... <=3(/3) sheets ... for/on ... 51 pieces"
  assert.equal(
    FABRICATED_51_PIECE_RESULT.test('The optimizer achieved 3 sheets for the 51 pieces.'),
    true,
    'must catch a sheet-first "achieved ... for" claim'
  );
  assert.equal(
    FABRICATED_51_PIECE_RESULT.test('It packed 3/3 sheets used on the 51 pieces.'),
    true,
    'must catch a sheet-first claim with a fractional sheet count'
  );

  // Honest source-unavailable prose, from both docs, must still be allowed.
  assert.equal(
    FABRICATED_51_PIECE_RESULT.test(
      'The 51-piece fixture is not published here, because its source data is unavailable.'
    ),
    false,
    'must not flag the benchmark doc\'s honest not-published sentence'
  );
  assert.equal(
    FABRICATED_51_PIECE_RESULT.test(
      'The improvement plan sketched a third fixture, at 51 pieces. It is not published, because the source data is not available in this repository: no checked-in dataset expands to 51 pieces. The nearest saved run is a different job entirely (52 glass panels on 321 × 225 cm jumbo sheets), so it cannot stand in for it, and no piece may be invented or removed to reach 51.'
    ),
    false,
    "must not flag the fixture README's honest not-published paragraph, including its unrelated mention of another fixture's sheet size"
  );
});

test('the benchmark doc quotes no CutOptim result and no money figure', () => {
  const doc = read(BENCHMARK_DOC);

  assert.equal(MONEY_SAVED_CLAIM.test(doc), false, 'The benchmark doc must not carry a money-saved figure');
  assert.equal(/\bMAD\b/.test(doc), false, 'The benchmark doc must not quote MAD amounts');

  for (const line of doc.split('\n')) {
    if (!/cutoptim/i.test(line)) continue;
    assert.equal(
      /\d/.test(line.replace(/cutoptim/gi, '')),
      false,
      `The doc quotes a CutOptim figure that was not reproduced under identical settings: ${line}`
    );
  }
});

test('the benchmark doc embeds the runner output verbatim rather than hand-written numbers', () => {
  const doc = read(BENCHMARK_DOC);
  const measured = benchmarkMarkdown().trim();

  assert.ok(
    doc.includes(measured),
    'docs/optimizer-benchmark.md must embed the exact `npm run benchmark:optimizer -- --format=markdown` output'
  );
  assert.match(measured, /### Reading the results/, 'the generated block must carry the result-interpretation narrative itself, not a separate hand-written one');
});

test('a hand-edited figure in the embedded narrative would fail the byte-exact check', () => {
  // Proves the byte-exact embed check above actually catches prose drift,
  // rather than merely observing that today's doc happens to match.
  const measured = benchmarkMarkdown().trim();
  const tampered = measured.replace('4 sheets', '3 sheets');

  assert.notEqual(tampered, measured, 'sanity check: the mutation must actually change the text');

  const doc = read(BENCHMARK_DOC);
  const docWithTamperedBlock = doc.replace(measured, tampered);

  assert.equal(
    docWithTamperedBlock.includes(measured),
    false,
    'a hand-edited number inside the generated narrative must fail the byte-exact embed check'
  );
});

test('every measured figure quoted in prose matches the runner output', () => {
  const doc = read(BENCHMARK_DOC);
  const report = benchmarkReport();

  for (const entry of report.fixtures) {
    assert.ok(
      doc.includes(`${entry.result.sheetsUsed} sheets`),
      `The doc must state the measured sheet count for ${entry.id}`
    );
    assert.ok(
      doc.includes(`${entry.result.utilizationPercent} %`),
      `The doc must state the measured utilization for ${entry.id}`
    );
    assert.ok(doc.includes(`${entry.input.expandedPieces} pieces`), `The doc must state the piece count for ${entry.id}`);
  }
});

test('the saved-runs README is labelled historical and carries no fabricated figures', () => {
  const doc = read(SAVED_RUNS_DOC);

  assert.match(doc, /historical|historique/i, 'Saved runs must be labelled as a historical archive');
  assert.equal(/1\s*800\s*MAD/.test(doc), false, 'The fabricated 1 800 MAD saving must be gone');
  assert.equal(/4\s*290\s*MAD/.test(doc), false, 'The fabricated 4 290 MAD saving must be gone');
  assert.equal(MONEY_SAVED_CLAIM.test(doc), false, 'Saved runs must not advertise an estimated economy');
  assert.equal(/\b140\b/.test(doc), false, 'The unsupported 140-piece count must be gone (run_01 expands to 135)');
  assert.ok(doc.includes('135'), 'Saved runs must state the verifiable 135-piece expansion');
  assert.ok(
    doc.includes('docs/optimizer-benchmark.md'),
    'Saved runs must point at the reproducible benchmark instead of its own stale results'
  );
});
