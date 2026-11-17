const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// The full image of every sheet of a project (spec 2026-11-17, PR 3): each
// sheet keeps its 1600 px image, all are attached by position in ONE PATCH
// (each PATCH rewrites options_json, so several would lose each other's
// paths), and the signed link names its sheet.

const scanUpload = () => loadTsModule('src/lib/projects/scan-upload.ts');
const sheets = () => loadTsModule('src/lib/projects/scan-sheets.ts');

const UUID = '0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8';
const path = (n) => `${UUID}/1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5${n}.jpg`;
const PROJECT_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const THUMB = 'data:image/jpeg;base64,/9j/THUMB';
const image = (n) => `data:image/jpeg;base64,/9j/SHEET${n}`;

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** POST /api/projects answers an id; each upload answers the next path in turn. */
function saveFetch() {
  const calls = [];
  let uploads = 0;
  const fn = async (input, init) => {
    const call = { input, init, body: init && init.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    if (input === '/api/projects') return jsonResponse(200, { success: true, projectId: PROJECT_ID });
    if (input === '/api/scans') return jsonResponse(200, { success: true, scanPath: path(++uploads) });
    if (init && init.method === 'PATCH') return jsonResponse(200, { success: true });
    throw new Error(`unexpected ${input}`);
  };
  fn.calls = calls;
  return fn;
}

const keeperFor = (fetchImpl) => scanUpload().createScanKeeper({ fetch: fetchImpl, downscale: async (src) => src });

test('the images of several new sheets are sent, then attached in one PATCH, by position', async () => {
  const fetchImpl = saveFetch();
  const keepers = [keeperFor(fetchImpl), keeperFor(fetchImpl), keeperFor(fetchImpl)];
  keepers[0].restore(path(9)); // a reopened sheet: already kept
  keepers[1].newScan(image(2));
  keepers[2].newScan(image(3));
  const saved = await scanUpload().saveProjectToCloud({ scans: [{ path: path(9) }, {}, {}] }, keepers, fetchImpl);
  assert.equal(await saved.scanAttached, true);
  const patches = fetchImpl.calls.filter((c) => c.init && c.init.method === 'PATCH');
  assert.equal(patches.length, 1, 'one PATCH for every sheet');
  assert.equal(patches[0].input, `/api/projects/${PROJECT_ID}`);
  assert.deepEqual(patches[0].body, { scanPaths: [null, path(1), path(2)] });
  assert.equal(fetchImpl.calls.filter((c) => c.input === '/api/scans').length, 2, 'the kept sheet is not sent again');
  assert.deepEqual(keepers.map((k) => k.knownPath()), [path(9), path(1), path(2)], 'the next save carries them');
});

test('nothing is attached when every sheet already carried its path or kept no image', async () => {
  const fetchImpl = saveFetch();
  const keepers = [keeperFor(fetchImpl), keeperFor(fetchImpl)];
  keepers[0].restore(path(1));
  keepers[1].restore(undefined);
  const saved = await scanUpload().saveProjectToCloud({ scans: [{ path: path(1) }, {}] }, keepers, fetchImpl);
  assert.equal(await saved.scanAttached, false);
  assert.deepEqual(fetchImpl.calls.map((c) => c.input), ['/api/projects']);
});

test('a sheet replaced while the save was running is not attached to it', async () => {
  const fetchImpl = saveFetch();
  const k = keeperFor(fetchImpl);
  k.newScan(image(1));
  const running = scanUpload().saveProjectToCloud({ scans: [{}] }, [k], fetchImpl);
  k.newScan(image(2));
  const saved = await running;
  assert.equal(await saved.scanAttached, false);
  assert.equal(fetchImpl.calls.some((c) => c.init && c.init.method === 'PATCH'), false);
});

test('the signed link names its sheet, and a link is reused per project and sheet', async () => {
  const calls = [];
  const fetchImpl = async (input) => {
    calls.push(input);
    return jsonResponse(200, { url: `https://storage.example/${calls.length}` });
  };
  const { resolveScanView, createScanLinkCache, scanViewNeedsFetch } = scanUpload();
  const cache = createScanLinkCache();
  const first = await resolveScanView({ projectId: PROJECT_ID, hasFullScan: true, thumb: THUMB }, fetchImpl, cache);
  const third = await resolveScanView({ projectId: PROJECT_ID, hasFullScan: true, thumb: THUMB, sheet: 3 }, fetchImpl, cache);
  assert.deepEqual(calls, [`/api/projects/${PROJECT_ID}/scan`, `/api/projects/${PROJECT_ID}/scan?n=3`]);
  assert.notEqual(first.src, third.src);
  assert.equal(scanViewNeedsFetch({ projectId: PROJECT_ID, hasFullScan: true, sheet: 3 }, cache), false);
  assert.equal(scanViewNeedsFetch({ projectId: PROJECT_ID, hasFullScan: true, sheet: 2 }, cache), true);
  await resolveScanView({ projectId: PROJECT_ID, hasFullScan: true, thumb: THUMB, sheet: 3 }, fetchImpl, cache);
  assert.equal(calls.length, 2, 'reused, not fetched again');
});

test('the kept paths are merged into the sheets by position, an old single scan becoming a list', () => {
  const { withScanPaths } = sheets();
  assert.deepEqual(
    withScanPaths({ scans: [{ thumb: THUMB }, { thumb: THUMB, path: path(7) }, {}], quotation: { a: 1 } }, [path(1), null, path(3)]),
    { scans: [{ thumb: THUMB, path: path(1) }, { thumb: THUMB, path: path(7) }, { path: path(3) }], quotation: { a: 1 } }
  );
  assert.deepEqual(
    withScanPaths({ scanThumb: THUMB, scanPath: path(7), pdfGeneratedAt: 'x' }, [null, path(2)]),
    { scans: [{ thumb: THUMB, path: path(7) }, { path: path(2) }], pdfGeneratedAt: 'x' }
  );
});

const { renderComponent } = require('./helpers/render-component');
const viewer = (props, locale = 'fr') =>
  renderComponent('src/components/ScanViewer.tsx', 'ScanViewer', { src: THUMB, reduced: false, alt: 'Cuisine', onClose: () => {}, ...props }, locale);

test('the viewer of a project with several sheets names the sheet and steps through them', () => {
  const html = viewer({ position: { index: 1, count: 3 }, onStep: () => {} });
  assert.match(html, /Fiche 1 sur 3/);
  assert.match(html, /<button[^>]*disabled=""[^>]*aria-label="Fiche précédente"/, 'no sheet before the first');
  assert.match(html, /aria-label="Fiche suivante"/);
  assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*aria-label="Fiche suivante"/);
  assert.match(viewer({ position: { index: 2, count: 2 }, onStep: () => {} }, 'en'), /Page 2 of 2/);
});

test('the viewer of a single scan has no arrows', () => {
  const html = viewer({});
  assert.match(html, /Image scannée/);
  assert.doesNotMatch(html, /scan-viewer-next|scan-viewer-previous/);
  assert.doesNotMatch(viewer({ position: { index: 1, count: 1 }, onStep: () => {} }), /scan-viewer-next/);
});
