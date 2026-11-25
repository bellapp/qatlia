const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// Owner request, 2026-11-25: print the plan with or without the chants. The
// choice sits under the plan, is kept on the device, and only changes the
// drawing: the price of the chants never moves with it.

const ROOT = path.resolve(__dirname, '..');
const load = (rel) => loadTsModule(path.join(ROOT, rel));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function withStorage(storage, fn) {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  try {
    return fn();
  } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before);
    else delete globalThis.localStorage;
  }
}
function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) };
}

test('the chants show until the artisan says otherwise, and the choice is kept', () => {
  const { readShowEdges, saveShowEdges } = load('src/lib/show-edges.ts');
  withStorage(memoryStorage(), () => {
    assert.equal(readShowEdges(), true);
    saveShowEdges(false);
    assert.equal(readShowEdges(), false);
    saveShowEdges(true);
    assert.equal(readShowEdges(), true);
  });
});

test('a blocked or absent storage never breaks the plan', () => {
  const { readShowEdges, saveShowEdges } = load('src/lib/show-edges.ts');
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  withStorage(blocked, () => {
    assert.equal(readShowEdges(), true);
    assert.doesNotThrow(() => saveShowEdges(false));
  });
  withStorage(undefined, () => assert.equal(readShowEdges(), true));
});

const piece = (extra = {}) => ({ pieceNumber: 1, name: 'A', sheetIndex: 0, width: 87, height: 30, rotated: false, x: 0, y: 0, ...extra });
const costingInput = {
  material: { sheets: [{ areaM2: 5.7, quantity: 1, pricing: { mode: 'per_sheet', value: 500 } }], basis: 'measured' },
  edge: { segments: [{ lengthM: 3, pricePerMeter: 8, edgeId: 'white' }], basis: 'measured' },
  labor: { pricing: { mode: 'fixed', value: 0 } },
};
async function pdfOf(extra, placedPieces = [piece({ edges: { bottom: true } })]) {
  const { POST } = load('src/app/api/export-pdf/route.ts');
  const res = await POST(new Request('http://localhost/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectName: 'Projet', material: 'mdf', sheet: { width: 206, height: 279 },
      result: {
        sheetsUsed: Math.max(...placedPieces.map((p) => p.sheetIndex)) + 1,
        wastePercentage: 1, totalAreaUsed: 1, totalAreaAvailable: 5, offcuts: [], placedPieces, costingInput,
      },
      ...extra,
    }),
  }));
  assert.equal(res.status, 200);
  return Buffer.from(await res.arrayBuffer()).toString('latin1');
}
const BLUE = /0\.11\d* 0\.3\d* 0\.8\d* RG/;
const pageCount = (pdf) => (pdf.match(/\/Type\s*\/Page\b/g) ?? []).length;

test('the PDF prints the chants by default and leaves them out when asked', async () => {
  for (const extra of [{}, { showEdges: true }]) {
    const pdf = await pdfOf(extra);
    assert.match(pdf, BLUE);
    assert.ok(pdf.includes('(Chant)'));
  }
  const without = await pdfOf({ showEdges: false });
  assert.doesNotMatch(without, BLUE);
  assert.equal(without.includes('(Chant)'), false);
});

test('without the chants, the price still counts them', async () => {
  const money = (pdf) => pdf.match(/\((?:[^()\\]|\\.)*524[,.]00(?:[^()\\]|\\.)*\)/g)?.length ?? 0;
  const withEdges = await pdfOf({ showEdges: true });
  const without = await pdfOf({ showEdges: false });
  assert.ok(money(withEdges) > 0, 'the fixture prints 500 + 3 x 8 = 524,00');
  assert.equal(money(without), money(withEdges));
});

test('without the chants, two panels cut alike are one drawing again', async () => {
  const panels = [piece({ edges: { top: true } }), piece({ sheetIndex: 1, edges: { bottom: true } })];
  assert.equal(pageCount(await pdfOf({ showEdges: false }, panels)), pageCount(await pdfOf({ showEdges: true }, panels)) - 1);
});

test('the payload carries the choice, on by default', () => {
  const { buildPdfPayload } = load('src/lib/pdf-payload.ts');
  const sheet = { width: 206, height: 279 };
  assert.equal(buildPdfPayload('P', sheet, [], {}).showEdges, true);
  assert.equal(buildPdfPayload('P', sheet, [], {}, 'cm', 'fr', 'MAD', false).showEdges, false);
});

test('the switch sits under the plan, drives the screen and the PDF, in every language', () => {
  const atelier = read('src/app/(site)/atelier/page.tsx');
  assert.match(atelier, /data-testid="cut-plan-edge-toggle"/);
  assert.match(atelier, /t\('atelier\.plan\.edgeToggle'\)/);
  assert.match(atelier, /showEdges \? edgeLines\(p\)/);
  assert.match(atelier, /buildPdfPayload\([^)]*, showEdges\)/);
  // Any banded panel: the switch must stay reachable once it is off, and from a panel without chants.
  assert.match(atelier, /hasEdgeLines\(result\.placedPieces\)/);
  assert.match(read('src/app/(site)/history/page.tsx'), /showEdges: readShowEdges\(\)/);
  for (const locale of ['fr', 'en', 'ar']) {
    assert.equal(typeof load(`src/i18n/messages/${locale}.ts`)[locale].atelier.plan.edgeToggle, 'string', locale);
  }
});
