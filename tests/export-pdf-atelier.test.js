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

test('ar locale with a business: the page indicator and the signature are both in the PDF', async (t) => {
  const POST = routeWith(t, { name: 'Menuiserie Benali' });
  const res = await POST(makeRequest(baseBody({ locale: 'ar' })));
  assert.equal(res.status, 200);
  const raw = await pdfTextOf(res);
  assert.match(raw, /Amiri/);
  assert.ok(raw.includes('qatlia.ma'), 'the Latin tail of the signature is drawn');
  assert.ok(raw.includes('QatliA'));
  assert.equal((raw.match(/qatlia\.ma/g) || []).length, 2, 'one signature per page');
});

// y (in points, from the bottom of the page) of the first text run drawn with `text`.
function textYOf(raw, text) {
  const match = new RegExp(String.raw`([\d.]+) ([\d.]+) Td\s*\(${text}\) Tj`).exec(raw);
  assert.ok(match, `"${text}" must be drawn`);
  return Number(match[2]);
}

const TALL_GRAIN_SHEET = { width: 100, height: 300, kerf: 0.3, margin: 0, hasGrain: true, grainOrientation: 'horizontal' };
const SMALL_PIECE_RESULT = {
  sheetsUsed: 1,
  wastePercentage: 1,
  totalAreaUsed: 5,
  totalAreaAvailable: 5.78,
  offcuts: [],
  placedPieces: [{ pieceNumber: 1, name: 'P', sheetIndex: 0, width: 50, height: 60, rotated: false, x: 0, y: 0 }],
};

test('with a business, the horizontal grain label on a height-limited sheet stays clear of the footer', async (t) => {
  const POST = routeWith(t, { name: 'Menuiserie Benali' });
  const res = await POST(makeRequest(baseBody({ sheet: TALL_GRAIN_SHEET, result: SMALL_PIECE_RESULT })));
  assert.equal(res.status, 200);
  const raw = await pdfTextOf(res);
  const labelY = textYOf(raw, 'Sens du ramage');
  const footerY = textYOf(raw, 'Page 2 / 2');
  // 14 pt (about 5 mm) of baseline-to-baseline clearance above the footer line.
  assert.ok(labelY - footerY >= 14, `grain label (y=${labelY}) too close to the footer (y=${footerY})`);
});

test('without a business the grain label position is unchanged (it sits at the bottom edge)', async (t) => {
  const POST = routeWith(t, null);
  const res = await POST(makeRequest(baseBody({ sheet: TALL_GRAIN_SHEET, result: SMALL_PIECE_RESULT })));
  const raw = await pdfTextOf(res);
  assert.ok(Math.abs(textYOf(raw, 'Sens du ramage') - 1.4217) < 0.01);
});

test('with a business, the footer follows the real size of each page, including portrait pages that overflow the first section', async (t) => {
  const { jsPDF } = require('jspdf');
  const placedPieces = Array.from({ length: 70 }, (_, i) => ({
    pieceNumber: i + 1,
    name: `P${i + 1}`,
    sheetIndex: 0,
    width: 10 + i,
    height: 20,
    rotated: false,
    x: 0,
    y: 0,
  }));
  const body = baseBody({ result: { ...SMALL_PIECE_RESULT, placedPieces } });
  const POST = routeWith(t, { name: 'Menuiserie Benali' });
  const res = await POST(makeRequest(body));
  assert.equal(res.status, 200);
  const raw = await pdfTextOf(res);

  const mediaBoxes = [...raw.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => ({ w: Number(m[1]), h: Number(m[2]) }));
  const total = mediaBoxes.length;
  assert.ok(total >= 3, `the 70 pieces must overflow the first section (got ${total} pages)`);
  assert.ok(mediaBoxes[1].h > mediaBoxes[1].w, 'page 2 is a portrait overflow page');

  const measure = new jsPDF({ unit: 'pt' });
  measure.setFont('helvetica', 'normal');
  measure.setFontSize(7);
  const signature = 'Réalisé avec QatliA · qatlia.ma';

  for (let page = 1; page <= total; page++) {
    const label = `Page ${page} / ${total}`;
    const match = new RegExp(String.raw`([\d.]+) ([\d.]+) Td\s*\(${label}\) Tj`).exec(raw);
    assert.ok(match, `footer of page ${page} must be drawn`);
    const box = mediaBoxes[page - 1];
    const x = Number(match[1]);
    const y = Number(match[2]);
    // Baseline 6 mm above the bottom edge of THIS page.
    assert.ok(Math.abs(y - (6 * 72) / 25.4) < 0.5, `page ${page}: footer baseline y=${y}pt is not 6 mm above the bottom`);
    // Whole line centred on THIS page's width.
    const lineWidth = [label, ' · ', signature].reduce((sum, text) => sum + measure.getTextWidth(text), 0);
    assert.ok(Math.abs(x - (box.w / 2 - lineWidth / 2)) < 1, `page ${page}: footer x=${x}pt is not centred on a ${box.w}pt wide page`);
  }
});
