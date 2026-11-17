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
  // Every sheet comes back, an old project's single scan as one.
  assert.match(page, /const restoredSheets = readScanSheets\(parsed\);\s*setScanSheets\(restoredSheets\.map/);
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

test('the atelier wires the scan path: restored, reset by a new scan, sent after a signed-in save only', () => {
  const page = atelierSource();
  // The keeper holds sheet 1's image: restored from the project, reset by a new first sheet.
  assert.match(page, /scanKeeper\.restore\(restoredSheets\[0\]\?\.path\);/);
  assert.match(page, /if \(sheetIndex === 0\) scanKeeper\.newScan\(scanImage\);/);
  const scansForSave = page.slice(page.indexOf('const scansForSave = async'), page.indexOf('const persistProject = async'));
  assert.match(scansForSave, /const path = index === 0 \? scanKeeper\.knownPath\(\) \?\? undefined : sheet\.path;/);
  const persist = page.slice(page.indexOf('const persistProject = async'), page.indexOf('const recordPdfGenerated'));
  // The save carries the path already known; the image itself never holds it up.
  assert.match(persist, /buildPersistedProjectPayload\(\{[\s\S]*?scans: await scansForSave\(\),[\s\S]*?\}\)/);
  // Only a signed-in save reaches the cloud, and so the image.
  assert.match(persist, /if \(user\) \{\s*const saved = await saveProjectToCloud\(payload, scanKeeper, \(url, init\) => fetch\(url, init\)\);/);
  assert.equal(persist.match(/saveProjectToCloud\(/g).length, 1);
  assert.doesNotMatch(persist, /scanKeeper\.keep\(\)|\/api\/scans/);
});

// R16: the project save never waits for the image; the image follows with a
// PATCH on the project the save created.

/** A fetch for the save: POST /api/projects answers ids in turn, uploads wait for `gate`. */
function saveFetch({ uploadAnswer = () => jsonResponse(200, { success: true, scanPath: PATH }), gate = Promise.resolve() } = {}) {
  let n = 0;
  return recordingFetch(async (call) => {
    if (call.input === '/api/projects') return jsonResponse(200, { success: true, projectId: `${PROJECT_ID.slice(0, -1)}${++n}` });
    if (call.input === '/api/scans') { await gate; return uploadAnswer(call); }
    if (call.init && call.init.method === 'PATCH') return jsonResponse(200, { success: true });
    throw new Error(`unexpected ${call.input}`);
  });
}

const savePayload = (extra = {}) => ({ name: 'Cuisine', pieces: [], ...extra });

test('the project is saved at once, before the image is sent, then the image is attached to it', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetchImpl = saveFetch({ gate });
  const k = keeper(fetchImpl);
  k.newScan(ORIGINAL);
  const saved = await scanUpload().saveProjectToCloud(savePayload(), k, fetchImpl);
  // The save answered while the upload is still waiting.
  assert.equal(saved.ok, true);
  assert.equal(saved.projectId, `${PROJECT_ID.slice(0, -1)}1`);
  assert.equal(fetchImpl.calls[0].input, '/api/projects');
  assert.equal('scanPath' in fetchImpl.calls[0].body, false);
  assert.equal(fetchImpl.calls.some((c) => c.init && c.init.method === 'PATCH'), false);
  release();
  assert.equal(await saved.scanAttached, true);
  assert.deepEqual(fetchImpl.calls.map((c) => c.input), ['/api/projects', '/api/scans', `/api/projects/${saved.projectId}`]);
  const attach = fetchImpl.calls[2];
  assert.equal(attach.init.method, 'PATCH');
  assert.deepEqual(attach.body, { scanPath: PATH });
});

test('two saves during one upload send the image once, and each attaches it to its own project', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetchImpl = saveFetch({ gate });
  const k = keeper(fetchImpl);
  k.newScan(ORIGINAL);
  const first = await scanUpload().saveProjectToCloud(savePayload(), k, fetchImpl);
  const second = await scanUpload().saveProjectToCloud(savePayload(), k, fetchImpl);
  assert.notEqual(first.projectId, second.projectId);
  release();
  assert.deepEqual(await Promise.all([first.scanAttached, second.scanAttached]), [true, true]);
  assert.equal(fetchImpl.calls.filter((c) => c.input === '/api/scans').length, 1);
  const patched = fetchImpl.calls.filter((c) => c.init && c.init.method === 'PATCH').map((c) => c.input).sort();
  assert.deepEqual(patched, [`/api/projects/${first.projectId}`, `/api/projects/${second.projectId}`].sort());
});

test('a refused upload sends no PATCH and the save stands with its thumbnail', async () => {
  await quietly(async () => {
    for (const uploadAnswer of [() => jsonResponse(503, { error: 'SCAN_STORAGE_UNAVAILABLE' }), () => jsonResponse(400, { error: 'INVALID_IMAGE' }), () => { throw new Error('offline'); }]) {
      const fetchImpl = saveFetch({ uploadAnswer });
      const k = keeper(fetchImpl);
      k.newScan(ORIGINAL);
      const saved = await scanUpload().saveProjectToCloud(savePayload(), k, fetchImpl);
      assert.equal(saved.ok, true);
      assert.equal(await saved.scanAttached, false);
      assert.equal(fetchImpl.calls.filter((c) => c.init && c.init.method === 'PATCH').length, 0);
    }
  });
});

test('a failed PATCH is only logged, and nothing is attached when the save carried the path or kept no scan', async () => {
  await quietly(async () => {
    for (const patchAnswer of [() => { throw new Error('offline'); }, () => jsonResponse(400, { error: 'INVALID_SCAN_PATH' })]) {
      const failingPatch = recordingFetch(async (call) => {
        if (call.input === '/api/projects') return jsonResponse(200, { success: true, projectId: PROJECT_ID });
        if (call.input === '/api/scans') return jsonResponse(200, { success: true, scanPath: PATH });
        return patchAnswer();
      });
      const k = keeper(failingPatch);
      k.newScan(ORIGINAL);
      const saved = await scanUpload().saveProjectToCloud(savePayload(), k, failingPatch);
      assert.equal(await saved.scanAttached, false);
    }
  });
  const known = saveFetch();
  const restored = keeper(known);
  restored.restore(PATH);
  const carried = await scanUpload().saveProjectToCloud(savePayload({ scans: [{ path: PATH }] }), restored, known);
  assert.equal(await carried.scanAttached, false);
  const none = keeper(known);
  const plain = await scanUpload().saveProjectToCloud(savePayload(), none, known);
  assert.equal(await plain.scanAttached, false);
  assert.deepEqual(known.calls.map((c) => c.input), ['/api/projects', '/api/projects']);
});

test('a refused project save attaches nothing, and a newer scan is never attached to the older project', async () => {
  const refused = recordingFetch(() => jsonResponse(500, { error: 'SERVER_ERROR' }));
  const k = keeper(refused);
  k.newScan(ORIGINAL);
  const saved = await scanUpload().saveProjectToCloud(savePayload(), k, refused);
  assert.equal(saved.ok, false);
  assert.equal(saved.projectId, null);
  assert.equal(await saved.scanAttached, false);
  assert.equal(refused.calls.length, 1);

  let answer;
  const pending = new Promise((resolve) => { answer = resolve; });
  const slowSave = recordingFetch(async (call) => {
    if (call.input === '/api/projects') { await pending; return jsonResponse(200, { success: true, projectId: PROJECT_ID }); }
    return jsonResponse(200, { success: true, scanPath: PATH });
  });
  const k2 = keeper(slowSave);
  k2.newScan(ORIGINAL);
  const running = scanUpload().saveProjectToCloud(savePayload(), k2, slowSave);
  k2.newScan('data:image/jpeg;base64,/9j/SECOND');
  answer();
  assert.equal(await (await running).scanAttached, false);
  assert.deepEqual(slowSave.calls.map((c) => c.input), ['/api/projects']);
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

test('a kept image whose link cannot be had falls back to the thumbnail, saying the link failed', async () => {
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
      assert.deepEqual(view, { src: REDUCED, reduced: true, reducedReason: 'link-failed' });
    }
  });
});

test('no link is asked for without a kept image or a server id, and an image in memory needs none', async () => {
  const { resolveScanView, scanViewNeedsFetch } = scanUpload();
  const fetchImpl = recordingFetch();
  // Nothing kept: the thumbnail is all there is.
  assert.deepEqual(await resolveScanView({ projectId: PROJECT_ID, hasFullScan: false, thumb: REDUCED }, fetchImpl), { src: REDUCED, reduced: true, reducedReason: 'not-kept' });
  // Kept, but no server id to ask a link for: the full image cannot be loaded here.
  assert.deepEqual(await resolveScanView({ projectId: null, hasFullScan: true, thumb: REDUCED }, fetchImpl), { src: REDUCED, reduced: true, reducedReason: 'link-failed' });
  assert.deepEqual(await resolveScanView({ projectId: 'optimize_1699999999999', hasFullScan: true, thumb: REDUCED }, fetchImpl), { src: REDUCED, reduced: true, reducedReason: 'link-failed' });
  assert.deepEqual(await resolveScanView({ localImage: ORIGINAL, projectId: PROJECT_ID, hasFullScan: true, thumb: REDUCED }, fetchImpl), { src: ORIGINAL, reduced: false });
  assert.equal(await resolveScanView({ projectId: null, hasFullScan: false, thumb: null }, fetchImpl), null);
  assert.equal(fetchImpl.calls.length, 0);
  assert.equal(scanViewNeedsFetch({ projectId: PROJECT_ID, hasFullScan: true, thumb: REDUCED }), true);
  assert.equal(scanViewNeedsFetch({ localImage: ORIGINAL, projectId: PROJECT_ID, hasFullScan: true, thumb: REDUCED }), false);
});

test('the atelier scan preview is a button that opens the viewer', () => {
  const page = atelierSource();
  const sheets = fs.readFileSync(path.resolve('src/components/ScanSheets.tsx'), 'utf8');
  assert.match(page, /<ScanSheets\b[\s\S]*?onOpen=\{openScanViewer\}/);
  assert.match(sheets, /data-testid=\{index === 0 \? 'atelier-scan-preview'/);
  assert.match(sheets, /aria-label=\{`\$\{t\('atelier\.scan\.sheetOpenAria', \{ index: number \}\)\}/);
  assert.match(page, /<ScanViewer\b/);
  // Sheet 1's full image is the keeper's, the others the image read on this page.
  assert.match(page, /localImage: first \? scanKeeper\.freshImage\(\) : sheet\.image \?\? null,/);
  assert.match(page, /hasFullScan: first \? scanKeeper\.knownPath\(\) !== null : false,/);
});

// Lot 3 fix wave.

test('waiting for the scan to be attached never rejects and never waits past its cap', async () => {
  const { settledWithin } = scanUpload();
  let resolveIt;
  const pending = new Promise((resolve) => { resolveIt = resolve; });
  const waited = settledWithin(pending, 1000);
  resolveIt(true);
  const start = Date.now();
  await waited;
  assert.ok(Date.now() - start < 500, 'settles as soon as the attach does');
  const t0 = Date.now();
  await settledWithin(new Promise(() => {}), 30);
  assert.ok(Date.now() - t0 >= 25, 'a hung attach is given up at the cap');
  await settledWithin(Promise.reject(new Error('never')), 1000);
});

test('the atelier lets a running scan attach finish before its PDF marker or a rename writes the same row', () => {
  const page = atelierSource();
  const persist = page.slice(page.indexOf('const persistProject = async'), page.indexOf('const recordPdfGenerated'));
  assert.match(persist, /scanAttachRef\.current = saved\.scanAttached;/);
  const record = page.slice(page.indexOf('const recordPdfGenerated'), page.indexOf('const askSignInKeepingWork'));
  assert.match(record, /if \(lastSavedProjectId\) \{\s*await settledWithin\(scanAttachRef\.current\);/);
  // Both name writes wait too: the one when the field is left, the one after a save.
  assert.equal(page.match(/await settledWithin\(scanAttachRef\.current\);\s*const outcome = await saveProjectName\(/g).length, 2);
});

test('a signed link is reused for about four minutes, then asked for again', async () => {
  const { resolveScanView, createScanLinkCache, scanViewNeedsFetch } = scanUpload();
  let now = 1_000_000;
  const cache = createScanLinkCache(() => now);
  let n = 0;
  const fetchImpl = recordingFetch(() => jsonResponse(200, { success: true, url: `https://x.supabase.co/a.jpg?token=${++n}` }));
  const input = { projectId: PROJECT_ID, hasFullScan: true, thumb: REDUCED };
  assert.equal((await resolveScanView(input, fetchImpl, cache)).src, 'https://x.supabase.co/a.jpg?token=1');
  now += 4 * 60_000 - 1;
  assert.equal((await resolveScanView(input, fetchImpl, cache)).src, 'https://x.supabase.co/a.jpg?token=1');
  assert.equal(fetchImpl.calls.length, 1, 'the image is not downloaded again under a new link');
  assert.equal(scanViewNeedsFetch(input, cache), false);
  now += 2;
  assert.equal(scanViewNeedsFetch(input, cache), true);
  assert.equal((await resolveScanView(input, fetchImpl, cache)).src, 'https://x.supabase.co/a.jpg?token=2');
  assert.equal(fetchImpl.calls.length, 2);
  // Another project has its own link.
  await resolveScanView({ ...input, projectId: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6e' }, fetchImpl, cache);
  assert.equal(fetchImpl.calls.length, 3);
});

test('a link that failed is not remembered', async () => {
  const { resolveScanView, createScanLinkCache } = scanUpload();
  const cache = createScanLinkCache(() => 0);
  let fail = true;
  const fetchImpl = recordingFetch(() => (fail ? jsonResponse(503, { error: 'SCAN_UNAVAILABLE' }) : jsonResponse(200, { success: true, url: 'https://x.supabase.co/a.jpg' })));
  await quietly(() => resolveScanView({ projectId: PROJECT_ID, hasFullScan: true, thumb: REDUCED }, fetchImpl, cache));
  fail = false;
  assert.equal((await resolveScanView({ projectId: PROJECT_ID, hasFullScan: true, thumb: REDUCED }, fetchImpl, cache)).src, 'https://x.supabase.co/a.jpg');
  assert.equal(fetchImpl.calls.length, 2);
});

test('a kept image with no thumbnail whose link failed still opens, with the link-failed note alone', async () => {
  const view = await quietly(() => scanUpload().resolveScanView({ projectId: PROJECT_ID, hasFullScan: true, thumb: null }, recordingFetch(() => jsonResponse(503, {}))));
  assert.deepEqual(view, { src: null, reduced: true, reducedReason: 'link-failed' });
});

test('the PDF file is handed over before the history marker, which may wait for the scan attach', () => {
  const page = atelierSource();
  const download = page.slice(page.indexOf("fetch('/api/export-pdf'"));
  const click = download.indexOf('a.click();');
  const marker = download.indexOf('await recordPdfGenerated(generatedAt);');
  assert.ok(click > 0 && marker > 0, 'download and marker are both in the PDF handler');
  assert.ok(click < marker, 'the file is downloaded before the marker is recorded');
});
