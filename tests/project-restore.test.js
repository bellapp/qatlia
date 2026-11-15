const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// Reopening a project from the history puts its saved plan back on screen
// without running the optimizer again, so the saved result is checked first:
// an old save that kept only a summary, or a damaged one, must not reach the
// plan drawing.

const restore = () => loadTsModule('src/lib/projects/restore.ts');
const packing = () => loadTsModule('src/lib/cutting/binpacking.ts');

function savedResult() {
  const { optimizeCutting2D, DEFAULT_STOCK_SHEET, OPTIONS_DEFAULTS } = packing();
  const pieces = [{ id: 'a', name: 'Côté', height: 70, width: 40, quantity: 3 }];
  return JSON.parse(JSON.stringify(optimizeCutting2D(pieces, [DEFAULT_STOCK_SHEET], OPTIONS_DEFAULTS)));
}

test('a saved result comes back unchanged', () => {
  const saved = savedResult();
  assert.deepEqual(restore().pickRestorableResult(saved), saved);
});

test('a summary-only result from an old save is not a plan', () => {
  assert.equal(restore().pickRestorableResult({ sheetsUsed: 1, wastePercentage: 12 }), null);
});

test('anything that is not a result is refused', () => {
  for (const value of [null, undefined, 'x', 42, [], {}]) assert.equal(restore().pickRestorableResult(value), null);
});

test('a placed piece without finite coordinates refuses the whole result', () => {
  const saved = savedResult();
  saved.placedPieces[0].x = null;
  assert.equal(restore().pickRestorableResult(saved), null);
});

test('missing offcuts and unplaced pieces are read as none', () => {
  const saved = savedResult();
  delete saved.offcuts;
  delete saved.unplacedPieces;
  const result = restore().pickRestorableResult(saved);
  assert.deepEqual(result.offcuts, []);
  assert.deepEqual(result.unplacedPieces, []);
});

test('a sheet that is not an object refuses the result', () => {
  const saved = savedResult();
  saved.sheets = [null];
  assert.equal(restore().pickRestorableResult(saved), null);
});

test('fewer sheets than sheetsUsed refuses the result', () => {
  const saved = savedResult();
  saved.sheetsUsed = saved.sheets.length + 1;
  assert.equal(restore().pickRestorableResult(saved), null);
});

test('a piece placed on a sheet beyond sheetsUsed refuses the result', () => {
  const saved = savedResult();
  saved.placedPieces[0].sheetIndex = saved.sheetsUsed;
  assert.equal(restore().pickRestorableResult(saved), null);
});

test('the cost breakdown is returned by reference', () => {
  const saved = savedResult();
  assert.ok(saved.costBreakdown, 'a real result carries a cost breakdown');
  const result = restore().pickRestorableResult(saved);
  assert.equal(result.costBreakdown, saved.costBreakdown);
});

const atelierSource = () => fs.readFileSync(path.resolve('src/app/(site)/atelier/page.tsx'), 'utf8');
const historySource = () => fs.readFileSync(path.resolve('src/app/(site)/history/page.tsx'), 'utf8');

test('the atelier puts the saved plan and the scan back on screen', () => {
  const page = atelierSource();
  assert.match(page, /const restoredResult = pickRestorableResult\(parsed\.result\);/);
  assert.match(page, /if \(restoredResult\) \{\s*setResult\(restoredResult\);\s*setActiveSheetIndex\(0\);/);
  assert.match(page, /setPreviewImage\(restoredThumb\)/);
});

test('the history writes the save date and the atelier reads it, then clears it like the other keys', () => {
  assert.match(historySource(), /sessionStorage\.setItem\('qatlia_restored_project_meta'/);
  const page = atelierSource();
  assert.match(page, /sessionStorage\.getItem\('qatlia_restored_project_meta'\)/);
  // Removed after the timeout in the success branch, at once in the catch branch.
  assert.equal(page.match(/sessionStorage\.removeItem\('qatlia_restored_project_meta'\)/g).length, 2);
});

test('a successful optimization takes the "reopened as saved" notice away', () => {
  assert.match(atelierSource(), /setResult\(optResult\);\s*setRestoredAt\(null\);/);
});

test('the save date left by the history is read back only when it is a date', () => {
  const { readRestoredProjectDate } = restore();
  assert.equal(readRestoredProjectDate(JSON.stringify({ createdAt: '2026-11-14T09:30:00.000Z' })), '2026-11-14T09:30:00.000Z');
  for (const raw of [null, '', 'not json', '[]', '{}', JSON.stringify({ createdAt: 42 }), JSON.stringify({ createdAt: 'yesterday' })]) {
    assert.equal(readRestoredProjectDate(raw), null);
  }
});

test('a reopened bar plan puts the atelier in bar mode, not only the viewer', () => {
  assert.match(
    atelierSource(),
    /if \(restoredResult\) \{[^}]*if \(restoredResult\.cutMode === '1d' \|\| restoredResult\.cutMode === '2d'\) setCutMode\(restoredResult\.cutMode\);/
  );
});

// The scan image kept with a saved project (lot 3). Only the reduced 1600 px
// version is ever sent, once per scan, and a failure never stops the save.

const scanUpload = () => loadTsModule('src/lib/projects/scan-upload.ts');
const REDUCED = 'data:image/jpeg;base64,/9j/REDUCED';
const ORIGINAL = 'data:image/jpeg;base64,/9j/PHONE-ORIGINAL';
const PATH = '0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8/1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b.jpg';
const PROJECT_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** A fetch that records each call and answers with `answer(call)`. */
function recordingFetch(answer = () => jsonResponse(200, { success: true, scanPath: PATH })) {
  const calls = [];
  const fn = async (input, init) => {
    const call = { input, init, body: init && init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return answer(call);
  };
  fn.calls = calls;
  return fn;
}

/** Runs `fn` with console.warn silenced (the refusals below are logged). */
async function quietly(fn) {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = originalWarn;
  }
}

/** The atelier's downscale: here every image comes back as REDUCED. */
const reducing = async () => REDUCED;
const failing = async () => null;

function keeper(fetchImpl, downscale = reducing) {
  return scanUpload().createScanKeeper({ fetch: fetchImpl, downscale });
}

test('a new scan is sent once, reduced, and its path goes into the save', async () => {
  const fetchImpl = recordingFetch();
  const k = keeper(fetchImpl, async (image, side, quality) => {
    assert.equal(image, ORIGINAL);
    assert.equal(side, 1600);
    assert.equal(quality, 0.8);
    return REDUCED;
  });
  k.newScan(ORIGINAL);
  assert.equal(await k.keep(), PATH);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(fetchImpl.calls[0].input, '/api/scans');
  assert.equal(fetchImpl.calls[0].init.method, 'POST');
  assert.deepEqual(fetchImpl.calls[0].body, { image: REDUCED });
  assert.equal(k.knownPath(), PATH);
});

test('a re-optimization of the same scan reuses its path and never sends it twice', async () => {
  const fetchImpl = recordingFetch();
  const k = keeper(fetchImpl);
  k.newScan(ORIGINAL);
  assert.equal(await k.keep(), PATH);
  assert.equal(await k.keep(), PATH);
  assert.equal(fetchImpl.calls.length, 1);
});

test('two saves at once (a run, then its PDF) share a single upload', async () => {
  const fetchImpl = recordingFetch();
  const k = keeper(fetchImpl);
  k.newScan(ORIGINAL);
  assert.deepEqual(await Promise.all([k.keep(), k.keep()]), [PATH, PATH]);
  assert.equal(fetchImpl.calls.length, 1);
});

test('a new scan forgets the path of the previous one, so the next save sends the new image', async () => {
  let n = 0;
  const fetchImpl = recordingFetch(() => jsonResponse(200, { success: true, scanPath: `${PATH}#${++n}` }));
  const k = keeper(fetchImpl);
  k.restore(PATH);
  k.newScan(ORIGINAL);
  assert.equal(k.knownPath(), null);
  assert.equal(await k.keep(), `${PATH}#1`);
  k.newScan('data:image/jpeg;base64,/9j/SECOND');
  assert.equal(k.knownPath(), null);
  assert.equal(await k.keep(), `${PATH}#2`);
  assert.equal(fetchImpl.calls.length, 2);
});

test('an upload that ends after a newer scan does not give the newer scan its path', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetchImpl = recordingFetch(async () => { await gate; return jsonResponse(200, { success: true, scanPath: PATH }); });
  const k = keeper(fetchImpl);
  k.newScan(ORIGINAL);
  const first = k.keep();
  k.newScan('data:image/jpeg;base64,/9j/SECOND');
  release();
  assert.equal(await first, PATH, 'the save that sent it still carries it');
  assert.equal(k.knownPath(), null, 'the newer scan is still to be sent');
});

test('a reopened project keeps its saved path and sends nothing, not even its thumbnail', async () => {
  const fetchImpl = recordingFetch();
  const k = keeper(fetchImpl);
  k.restore(PATH);
  assert.equal(k.freshImage(), null);
  assert.equal(await k.keep(), PATH);
  // A reopened project that kept only its thumbnail has nothing to send.
  k.restore(undefined);
  assert.equal(await k.keep(), null);
  for (const saved of [42, '', null, {}]) {
    k.restore(saved);
    assert.equal(k.knownPath(), null);
  }
  assert.equal(fetchImpl.calls.length, 0);
});

test('the phone original is never sent: no upload when the downscale fails', async () => {
  const fetchImpl = recordingFetch();
  const k = keeper(fetchImpl, failing);
  k.newScan(ORIGINAL);
  assert.equal(await k.keep(), null);
  assert.equal(fetchImpl.calls.length, 0);
});

test('an image longer than the server accepts is not sent for nothing', async () => {
  const { SCAN_IMAGE_MAX_CHARS } = loadTsModule('src/lib/projects/scan-image.ts');
  const fetchImpl = recordingFetch();
  const big = 'data:image/jpeg;base64,' + 'A'.repeat(SCAN_IMAGE_MAX_CHARS);
  const k = keeper(fetchImpl, async () => big);
  k.newScan(ORIGINAL);
  assert.equal(await k.keep(), null);
  assert.equal(fetchImpl.calls.length, 0);
});

test('every refusal from /api/scans, and a network error, leaves the save with no path and no error', async () => {
  const answers = [
    () => jsonResponse(400, { error: 'INVALID_IMAGE' }),
    () => jsonResponse(401, { error: 'AUTH_REQUIRED' }),
    () => jsonResponse(429, { error: 'RATE_LIMITED' }),
    () => jsonResponse(503, { error: 'SCAN_STORAGE_UNAVAILABLE' }),
    () => jsonResponse(200, { success: true }),
    () => { throw new Error('offline'); },
    () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('not json'); } }),
  ];
  await quietly(async () => {
    for (const answer of answers) {
      const fetchImpl = recordingFetch(answer);
      const k = keeper(fetchImpl);
      k.newScan(ORIGINAL);
      assert.equal(await k.keep(), null);
      assert.equal(k.knownPath(), null);
      // The next save tries again (the storage may be ready by then).
      await k.keep();
      assert.equal(fetchImpl.calls.length, 2);
    }
  });
});

test('the upload to /api/scans sits in a try, so its failure cannot stop the save', () => {
  const source = fs.readFileSync(path.resolve('src/lib/projects/scan-upload.ts'), 'utf8');
  const upload = source.slice(source.indexOf('export async function uploadScanImage'));
  const tryAt = upload.indexOf('try {');
  const fetchAt = upload.indexOf("'/api/scans'");
  const catchAt = upload.indexOf('} catch');
  assert.ok(tryAt >= 0 && tryAt < fetchAt && fetchAt < catchAt, 'the fetch is inside the try');
  // Pure client module: the size cap comes from the import-safe scan-image module.
  assert.match(source, /import \{ SCAN_IMAGE_MAX_CHARS \} from '@\/lib\/projects\/scan-image';/);
});

test('the atelier wires the scan path: restored, reset by a new scan, kept by a signed-in save only', () => {
  const page = atelierSource();
  assert.match(page, /scanKeeper\.restore\(parsed\.scanPath\);/);
  assert.match(page, /setPreviewImage\(scanImage\);\s*scanKeeper\.newScan\(scanImage\);/);
  const persist = page.slice(page.indexOf('const persistProject = async'), page.indexOf('const recordPdfGenerated'));
  // Only a signed-in save sends the image; its path goes into the payload.
  assert.match(persist, /if \(user\) \{\s*savedScanPath = await scanKeeper\.keep\(\);/);
  assert.match(persist, /buildPersistedProjectPayload\(\{[\s\S]*?scanPath: savedScanPath,[\s\S]*?\}\)/);
  assert.equal(persist.match(/scanKeeper\.keep\(\)/g).length, 1);
  assert.doesNotMatch(persist, /\/api\/scans/);
});

// Seeing the scan: the full image through a short signed link when one was
// kept, else the thumbnail, marked as reduced.

test('a project with a kept image shows it through its signed link', async () => {
  const url = 'https://x.supabase.co/storage/v1/object/sign/scans/a.jpg?token=t';
  const fetchImpl = recordingFetch(() => jsonResponse(200, { success: true, url }));
  const view = await scanUpload().resolveScanView({ projectId: PROJECT_ID, hasFullScan: true, thumb: REDUCED }, fetchImpl);
  assert.deepEqual(view, { src: url, reduced: false });
  assert.equal(fetchImpl.calls[0].input, `/api/projects/${PROJECT_ID}/scan`);
});

test('both requests can be given up, so a hung server never keeps the scan buttons waiting', async () => {
  const fetchImpl = recordingFetch(() => jsonResponse(200, { success: true, scanPath: PATH, url: 'https://x.supabase.co/a.jpg' }));
  const k = keeper(fetchImpl);
  k.newScan(ORIGINAL);
  await k.keep();
  await scanUpload().fetchScanUrl(PROJECT_ID, fetchImpl);
  assert.equal(fetchImpl.calls.length, 2);
  for (const call of fetchImpl.calls) assert.ok(call.init.signal instanceof AbortSignal, `${call.input} carries an abort signal`);
});

test('a link that cannot be had falls back to the thumbnail, marked reduced', async () => {
  const answers = [
    () => jsonResponse(404, { error: 'NOT_FOUND' }),
    () => jsonResponse(503, { error: 'SCAN_UNAVAILABLE' }),
    () => jsonResponse(401, { error: 'AUTH_REQUIRED' }),
    () => jsonResponse(200, { success: true, url: 'javascript:alert(1)' }),
    () => jsonResponse(200, { success: true }),
    () => { throw new Error('offline'); },
  ];
  await quietly(async () => {
    for (const answer of answers) {
      const view = await scanUpload().resolveScanView({ projectId: PROJECT_ID, hasFullScan: true, thumb: REDUCED }, recordingFetch(answer));
      assert.deepEqual(view, { src: REDUCED, reduced: true });
    }
  });
});

test('no link is asked for without a kept image or a server id, and an image in memory needs none', async () => {
  const { resolveScanView, scanViewNeedsFetch } = scanUpload();
  const fetchImpl = recordingFetch();
  assert.deepEqual(await resolveScanView({ projectId: PROJECT_ID, hasFullScan: false, thumb: REDUCED }, fetchImpl), { src: REDUCED, reduced: true });
  assert.deepEqual(await resolveScanView({ projectId: null, hasFullScan: true, thumb: REDUCED }, fetchImpl), { src: REDUCED, reduced: true });
  assert.deepEqual(await resolveScanView({ projectId: 'optimize_1699999999999', hasFullScan: true, thumb: REDUCED }, fetchImpl), { src: REDUCED, reduced: true });
  assert.deepEqual(await resolveScanView({ localImage: ORIGINAL, projectId: PROJECT_ID, hasFullScan: true, thumb: REDUCED }, fetchImpl), { src: ORIGINAL, reduced: false });
  assert.equal(await resolveScanView({ projectId: null, hasFullScan: false, thumb: null }, fetchImpl), null);
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(scanViewNeedsFetch({ projectId: PROJECT_ID, hasFullScan: true, thumb: REDUCED }), true);
  assert.equal(scanViewNeedsFetch({ localImage: ORIGINAL, projectId: PROJECT_ID, hasFullScan: true, thumb: REDUCED }), false);
});

test('the atelier scan preview is a button that opens the viewer', () => {
  const page = atelierSource();
  assert.match(page, /data-testid="atelier-scan-preview"/);
  assert.match(page, /aria-label=\{t\('scanViewer\.openAria', \{ name: [^}]+\}\)\}/);
  assert.match(page, /<ScanViewer\b/);
  assert.match(page, /localImage: scanKeeper\.freshImage\(\),/);
  assert.match(page, /hasFullScan: scanKeeper\.knownPath\(\) !== null,/);
});
