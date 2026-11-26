const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');
const { createFakeSupabase } = require('./helpers/fake-supabase');

// One saved project as the back office shows it in full (spec 2026-11-25).
// options_json is written by the browser and may be anything.

const { readProjectDetail, getClientProject, SCAN_LINK_SECONDS } = loadTsModule('src/lib/admin/project-detail.ts');

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROJECT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FILE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd.jpg';

const base = {
  id: PROJECT,
  user_id: USER,
  name: 'Cuisine Ahmed',
  material: 'mdf',
  sheet_width: '280.00',
  sheet_height: '207.00',
  created_at: '2026-11-12T14:32:00Z',
};

const fullOptions = {
  scans: [{ thumb: 'data:image/jpeg;base64,AAA', path: `${USER}/${FILE}` }, { thumb: 'data:image/jpeg;base64,BBB' }],
  pdfGeneratedAt: '2026-11-12T15:00:00Z',
  quotation: { clientName: 'Client de l’artisan', total: 1200 },
  sheet: { width: 280, height: 207, kerf: 0.4, margin: 1, label: 'MDF blanc' },
  options: { kerfWidth: 0.4, optimizationPriority: 'waste' },
  pieces: [
    { name: 'Côté', width: 180, height: 50, quantity: '2', scanIndex: 1, edges: { top: true, left: true } },
    { name: 'Étagère', width: 96, height: 48, quantity: 4, scanIndex: 2, grain: 'vertical' },
    { name: 'Socle', width: 90, height: 10, quantity: 1 },
  ],
  result: {
    sheetsUsed: 2,
    wastePercentage: 14.2,
    sheets: [
      { index: 0, width: 280, height: 207, wasteRate: 0.1, label: 'MDF blanc', pieces: [{ x: 0, y: 0, width: 180, height: 50, name: 'Côté × 2', rotated: false }] },
      { index: 1, width: 280, height: 207, wasteRate: 0.3, pieces: [{ x: '10', y: 5, width: 96, height: 48, rotated: true }, { x: 'nope' }] },
    ],
    unplacedPieces: [{ name: 'Plateau', width: 300, height: 90, unplacedReasonCode: 'oversize', unplacedReason: 'Trop grande.' }],
  },
};

test('readProjectDetail lit pièces, fiches, résultat, panneaux et réglages', () => {
  const d = readProjectDetail({ ...base, options_json: fullOptions });
  assert.equal(d.name, 'Cuisine Ahmed');
  assert.equal(d.pdfGeneratedAt, '2026-11-12T15:00:00Z');
  assert.deepEqual(
    d.pieces.map((p) => [p.name, p.width, p.height, p.quantity, p.scanIndex]),
    [
      ['Côté', 180, 50, 2, 1],
      ['Étagère', 96, 48, 4, 2],
      ['Socle', 90, 10, 1, null],
    ]
  );
  assert.equal(d.pieces[0].edges, 'haut, gauche');
  assert.equal(d.pieces[1].grain, 'vertical');
  assert.deepEqual(d.scans, [
    { thumb: 'data:image/jpeg;base64,AAA', path: `${USER}/${FILE}` },
    { thumb: 'data:image/jpeg;base64,BBB', path: null },
  ]);
  assert.deepEqual(d.sheet, { width: 280, height: 207, kerf: 0.4, margin: 1, label: 'MDF blanc' });
  assert.deepEqual(d.options, { kerf: 0.4, priority: 'waste' });
  assert.equal(d.result.sheetsUsed, 2);
  assert.equal(d.result.wastePercentage, 14.2);
  assert.equal(d.result.sheets.length, 2);
  assert.equal(d.result.sheets[0].label, 'MDF blanc');
  // A placed piece without a readable position is left out, the rest is kept.
  assert.deepEqual(d.result.sheets[1].pieces, [{ x: 10, y: 5, width: 96, height: 48, name: null, rotated: true }]);
  assert.deepEqual(d.result.unplaced, [{ name: 'Plateau', width: 300, height: 90, reason: 'Trop grande.' }]);
});

test('readProjectDetail ne transporte jamais le contenu du devis', () => {
  const d = readProjectDetail({ ...base, options_json: fullOptions });
  assert.equal(d.hasQuotation, true);
  assert.doesNotMatch(JSON.stringify(d), /Client de l’artisan|1200/);
});

test('readProjectDetail tient sur un options_json malformé', () => {
  for (const options_json of [null, 'x', 42, [], { result: 3, pieces: 'x', scans: 'x' }, { result: { sheets: 'x', unplacedPieces: {} } }]) {
    const d = readProjectDetail({ ...base, options_json });
    assert.deepEqual(d.pieces, []);
    assert.deepEqual(d.scans, []);
    assert.equal(d.hasQuotation, false);
    if (d.result) {
      assert.deepEqual(d.result.sheets, []);
      assert.deepEqual(d.result.unplaced, []);
    }
  }
  assert.equal(readProjectDetail({ ...base, options_json: null }).result, null);
  assert.equal(readProjectDetail({ ...base, name: '  ', options_json: null }).name, 'Sans nom');
});

function dbWith(row) {
  const fake = createFakeSupabase();
  fake.state.tables = { projects: row };
  return fake;
}

test('getClientProject : identifiants invalides ou projet absent → not_found', async () => {
  const { client } = dbWith(null);
  assert.deepEqual(await getClientProject(client, USER, 'pas-un-uuid'), { status: 'not_found' });
  assert.deepEqual(await getClientProject(client, 'x', PROJECT), { status: 'not_found' });
  assert.deepEqual(await getClientProject(client, USER, PROJECT), { status: 'not_found' });
});

test('getClientProject lit le projet par id ET client', async () => {
  const { client, state } = dbWith({ ...base, options_json: fullOptions });
  const res = await getClientProject(client, USER, PROJECT);
  assert.equal(res.status, 'ok');
  const call = state.fromCalls.find((c) => c.table === 'projects');
  const eqs = call.ops.filter(([op]) => op === 'eq').map(([, args]) => args);
  assert.deepEqual(eqs, [
    ['id', PROJECT],
    ['user_id', USER],
  ]);
});

test('getClientProject signe seulement les photos du client, pour 5 minutes', async () => {
  const foreign = { ...fullOptions, scans: [{ path: `${OTHER}/${FILE}` }, { path: `${USER}/${FILE}` }] };
  const { client, state } = dbWith({ ...base, options_json: foreign });
  const res = await getClientProject(client, USER, PROJECT);
  assert.equal(SCAN_LINK_SECONDS, 300);
  assert.equal(res.scanUrls[0], null);
  assert.equal(res.scanUrls[1], `https://signed.test/scans/${USER}/${FILE}?ttl=300`);
  const signed = state.rpcCalls.filter((c) => c.name === 'storage.createSignedUrl');
  assert.deepEqual(
    signed.map((c) => c.args.path),
    [`${USER}/${FILE}`]
  );
});

test('getClientProject : signature refusée → pas de lien, la page tient', async () => {
  const { client, state } = dbWith({ ...base, options_json: fullOptions });
  state.storageError = { message: 'boom' };
  const res = await getClientProject(client, USER, PROJECT);
  assert.equal(res.status, 'ok');
  assert.deepEqual(res.scanUrls, [null, null]);
});

test('getClientProject : erreur de lecture → error', async () => {
  const { client, state } = dbWith(null);
  state.tableErrors.projects = { message: 'down' };
  assert.deepEqual(await getClientProject(client, USER, PROJECT), { status: 'error' });
});
