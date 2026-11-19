const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Downloading a photo a prospect sent to the bot (Meta Graph media API):
// look the media id up, then download the URL it gives, both with the bot's
// token. Only a small image of a known type comes back, as a data URL.

const { fetchMediaDataUrl, MAX_MEDIA_BYTES } = loadTsModule('src/lib/whatsapp/media.ts');

const CONFIG = { accessToken: 'tok_123', graphVersion: 'v23.0' };
const LOOKUP_URL = 'https://graph.facebook.com/v23.0/MEDIA1';
const FILE_URL = 'https://lookaside.example/x';
const BYTES = Buffer.from([1, 2, 3]);

function stubFetch({ lookup, download }) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), auth: init?.headers?.Authorization });
    if (String(url) === LOOKUP_URL) return lookup();
    return download();
  };
  return { impl, calls };
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const okLookup = (over = {}) => () => json(200, { url: FILE_URL, mime_type: 'image/jpeg', file_size: 3, ...over });
const okDownload = (bytes = BYTES) => () => new Response(bytes, { status: 200 });

test('looks the media up, downloads it with the token, returns a data URL', async () => {
  const { impl, calls } = stubFetch({ lookup: okLookup(), download: okDownload() });
  const result = await fetchMediaDataUrl(CONFIG, 'MEDIA1', impl);
  assert.deepEqual(result, {
    ok: true,
    mimeType: 'image/jpeg',
    bytes: 3,
    dataUrl: `data:image/jpeg;base64,${BYTES.toString('base64')}`,
  });
  assert.deepEqual(calls, [
    { url: LOOKUP_URL, auth: 'Bearer tok_123' },
    { url: FILE_URL, auth: 'Bearer tok_123' },
  ]);
});

for (const status of [400, 401, 403]) {
  test(`lookup refused (${status}) : lookup_refused, no download`, async () => {
    const { impl, calls } = stubFetch({ lookup: () => json(status, { error: { code: 10 } }), download: okDownload() });
    assert.deepEqual(await fetchMediaDataUrl(CONFIG, 'MEDIA1', impl), { ok: false, reason: 'lookup_refused', status });
    assert.equal(calls.length, 1);
  });
}

test('lookup server error or network failure : lookup_failed', async () => {
  const server = stubFetch({ lookup: () => json(500, {}), download: okDownload() });
  assert.deepEqual(await fetchMediaDataUrl(CONFIG, 'MEDIA1', server.impl), { ok: false, reason: 'lookup_failed', status: 500 });
  const network = stubFetch({
    lookup: () => {
      throw new TypeError('fetch failed');
    },
    download: okDownload(),
  });
  assert.deepEqual(await fetchMediaDataUrl(CONFIG, 'MEDIA1', network.impl), { ok: false, reason: 'lookup_failed' });
});

test('download failure : download_failed', async () => {
  const { impl } = stubFetch({ lookup: okLookup(), download: () => new Response('no', { status: 404 }) });
  assert.deepEqual(await fetchMediaDataUrl(CONFIG, 'MEDIA1', impl), { ok: false, reason: 'download_failed', status: 404 });
});

test('a file announced or downloaded above the limit : too_large', async () => {
  const announced = stubFetch({ lookup: okLookup({ file_size: MAX_MEDIA_BYTES + 1 }), download: okDownload() });
  assert.deepEqual(await fetchMediaDataUrl(CONFIG, 'MEDIA1', announced.impl), { ok: false, reason: 'too_large' });
  assert.equal(announced.calls.length, 1);
  const actual = stubFetch({ lookup: okLookup(), download: okDownload(Buffer.alloc(MAX_MEDIA_BYTES + 1)) });
  assert.deepEqual(await fetchMediaDataUrl(CONFIG, 'MEDIA1', actual.impl), { ok: false, reason: 'too_large' });
});

test('an image type the reader does not take : bad_type', async () => {
  const { impl, calls } = stubFetch({ lookup: okLookup({ mime_type: 'image/gif' }), download: okDownload() });
  assert.deepEqual(await fetchMediaDataUrl(CONFIG, 'MEDIA1', impl), { ok: false, reason: 'bad_type' });
  assert.equal(calls.length, 1);
});

test('the limit is 5 MB', () => {
  assert.equal(MAX_MEDIA_BYTES, 5 * 1024 * 1024);
});
