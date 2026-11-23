const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { stubModule, restoreStubs } = require('./helpers/stub-module');

// The cut-plan PDF carries the artisan's business (« Mon entreprise ») when
// the account has one saved, and is exactly today's PDF when it has not.

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;
// Same magic bytes, body no longer decodes to a real image.
const BROKEN_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA==';

function baseBody(overrides = {}) {
  return {
    projectName: 'Projet Test',
    material: 'mdf',
    sheet: { width: 208, height: 278, kerf: 0.3, margin: 0 },
    result: {
      sheetsUsed: 1,
      wastePercentage: 12.5,
      totalAreaUsed: 5,
      totalAreaAvailable: 5.78,
      offcuts: [],
      placedPieces: [
        { pieceNumber: 1, name: 'Panneau', sheetIndex: 0, width: 120, height: 60, rotated: false, x: 0, y: 0 },
      ],
    },
    ...overrides,
  };
}

function makeRequest(body) {
  return new Request('http://localhost/api/export-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function pdfTextOf(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('latin1');
}

/** Loads the route with `atelierForCurrentRequest` answering `atelier` (or rejecting). */
function routeWith(t, atelier, { reject = false } = {}) {
  t.after(restoreStubs);
  stubModule('@/lib/atelier-server', {
    atelierForCurrentRequest: async () => {
      if (reject) throw new Error('boom');
      return atelier;
    },
  });
  return loadTsModule('src/app/api/export-pdf/route.ts').POST;
}

test("without a business the PDF is today's: QatliA header, page number in it, no footer, QatliA_ file name", async (t) => {
  const POST = routeWith(t, null);
  const res = await POST(makeRequest(baseBody()));
  assert.equal(res.status, 200);
  const text = await pdfTextOf(res);
  assert.ok(text.includes('QatliA'));
  assert.ok(text.includes('Page 1 / 2'), 'page number stays in the header');
  assert.ok(!text.includes('Réalisé avec QatliA'));
  assert.ok(res.headers.get('Content-Disposition').includes('filename="QatliA_PROJET_TEST.pdf"'));
});

test('with a business: name, phone, footer and company file name', async (t) => {
  const POST = routeWith(t, { name: 'Menuiserie Benali', phone: '0612345678' });
  const res = await POST(makeRequest(baseBody()));
  assert.equal(res.status, 200);
  const text = await pdfTextOf(res);
  assert.ok(text.includes('Menuiserie Benali'));
  assert.ok(text.includes('0612345678'));
  assert.ok(text.includes('Réalisé avec QatliA'));
  assert.ok(text.includes('qatlia.ma'));
  assert.ok(text.includes('PROJET TEST'), 'central project title is kept');
  assert.ok(res.headers.get('Content-Disposition').includes('filename="Menuiserie_Benali_PROJET_TEST.pdf"'));
});

test('with a business and no phone, no phone line is drawn and the name still is', async (t) => {
  const POST = routeWith(t, { name: 'Menuiserie Benali' });
  const res = await POST(makeRequest(baseBody()));
  assert.equal(res.status, 200);
  assert.ok((await pdfTextOf(res)).includes('Menuiserie Benali'));
});

test('en locale with a business: footer reads Made with QatliA', async (t) => {
  const POST = routeWith(t, { name: 'Benali Woodwork' });
  const res = await POST(makeRequest(baseBody({ locale: 'en' })));
  assert.equal(res.status, 200);
  const text = await pdfTextOf(res);
  assert.ok(text.includes('Made with QatliA'));
  assert.ok(!text.includes('Réalisé avec QatliA'));
});

test('an Arabic business name in a fr export embeds the Amiri font', async (t) => {
  const POST = routeWith(t, { name: 'نجارة بنعلي' });
  const res = await POST(makeRequest(baseBody({ locale: 'fr' })));
  assert.equal(res.status, 200);
  const raw = await pdfTextOf(res);
  assert.match(raw, /Amiri/, "the embedded font's PostScript name must appear in the PDF");
  // File name: an Arabic-only company falls back to QatliA in the ascii name.
  assert.ok(res.headers.get('Content-Disposition').includes('filename="QatliA_PROJET_TEST.pdf"'));
});

test('without an Arabic business name a fr export does not embed Amiri', async (t) => {
  const POST = routeWith(t, { name: 'Menuiserie Benali' });
  const res = await POST(makeRequest(baseBody({ locale: 'fr' })));
  assert.doesNotMatch(await pdfTextOf(res), /Amiri/);
});

test('a valid PNG logo is embedded as an image; no logo means no image', async (t) => {
  const POST = routeWith(t, { name: 'Menuiserie Benali', logoDataUrl: PNG_DATA_URL });
  const withLogo = await POST(makeRequest(baseBody()));
  assert.equal(withLogo.status, 200);
  assert.match(await pdfTextOf(withLogo), /\/Subtype\s*\/Image/);

  const POST2 = routeWith(t, { name: 'Menuiserie Benali' });
  const without = await POST2(makeRequest(baseBody()));
  assert.equal(without.status, 200);
  assert.doesNotMatch(await pdfTextOf(without), /\/Subtype\s*\/Image/);
});

test('a logo with invalid bytes is ignored: 200 and no image', async (t) => {
  const POST = routeWith(t, { name: 'Menuiserie Benali', logoDataUrl: BROKEN_PNG_DATA_URL });
  const res = await POST(makeRequest(baseBody()));
  assert.equal(res.status, 200);
  const text = await pdfTextOf(res);
  assert.doesNotMatch(text, /\/Subtype\s*\/Image/);
  assert.ok(text.includes('Menuiserie Benali'));
});

test('a 120-character business name is shortened, never breaks the export', async (t) => {
  const longName = 'Menuiserie '.repeat(11) + 'Benali';
  const POST = routeWith(t, { name: longName, phone: '0612345678' });
  const res = await POST(makeRequest(baseBody()));
  assert.equal(res.status, 200);
  const text = await pdfTextOf(res);
  assert.ok(text.includes('PROJET TEST'), 'the project name is still there');
  assert.ok(!text.includes(longName), 'the full 120-character name does not fit and must be cut');
  assert.ok(text.includes('Menuiserie Menuiserie'), 'the start of the name is kept');
});

test('a rejecting atelierForCurrentRequest is "no business": 200 and today\'s header', async (t) => {
  const POST = routeWith(t, null, { reject: true });
  const res = await POST(makeRequest(baseBody()));
  assert.equal(res.status, 200);
  const text = await pdfTextOf(res);
  assert.ok(text.includes('QatliA'));
  assert.ok(!text.includes('Réalisé avec QatliA'));
  assert.ok(res.headers.get('Content-Disposition').includes('filename="QatliA_PROJET_TEST.pdf"'));
});

test('with a business, every page carries the footer', async (t) => {
  const POST = routeWith(t, { name: 'Menuiserie Benali' });
  const res = await POST(makeRequest(baseBody()));
  const text = await pdfTextOf(res);
  assert.equal((text.match(/Réalisé avec QatliA/g) || []).length, 2, 'one footer per page (portrait + schema page)');
  assert.match(text, /%PDF-1\./);
});
