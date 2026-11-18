const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Editing a saved panel from the browser: on the device list while signed out
// (or while the account store is unreachable), through the API otherwise.

const values = new Map();
global.window = {
  localStorage: {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  },
};

const presets = () => loadTsModule('src/lib/panel-presets.ts');

function deviceList(list) {
  values.clear();
  values.set('qatlia-panel-presets', JSON.stringify(list));
}

const WHITE = { id: 'p-1', name: 'MDF blanc', height: 244, width: 122, material: 'mdf', color: 'Blanc' };
const OAK = { id: 'p-2', name: 'Chêne', height: 280, width: 207, material: 'contreplaques', hasGrain: true, grainOrientation: 'horizontal' };
const attributes = ({ id: _id, ...rest }) => (void _id, rest);

test('a panel of the device list is edited in place, as a whole', () => {
  deviceList([WHITE, OAK]);
  const edit = { name: 'MDF 19 mm', height: 250, width: 125, material: 'mdf', pricePerSheet: 335 };

  const result = presets().updateDevicePreset('p-1', edit);

  assert.deepEqual(result, { ok: true, preset: { id: 'p-1', ...edit, builtIn: false } });
  const stored = JSON.parse(values.get('qatlia-panel-presets'));
  assert.deepEqual(stored.map((p) => p.id), ['p-1', 'p-2'], 'same place in the list');
  assert.equal('color' in stored[0], false, 'the colour taken off is gone');
});

test('an edit that makes a device panel the same as another is refused with its name', () => {
  deviceList([WHITE, OAK]);

  assert.deepEqual(presets().updateDevicePreset('p-1', { ...attributes(OAK), name: 'Copie' }), { ok: false, error: 'DUPLICATE', existingName: 'Chêne' });
  assert.deepEqual(JSON.parse(values.get('qatlia-panel-presets')), [WHITE, OAK]);
});

test('a device panel renamed only is not a duplicate of itself', () => {
  deviceList([WHITE, OAK]);

  const result = presets().updateDevicePreset('p-1', { ...attributes(WHITE), name: 'Blanc atelier', color: 'blanc' });

  assert.equal(result.ok, true);
  assert.equal(result.preset.name, 'Blanc atelier');
});

test('an unknown device panel is not created by an edit', () => {
  deviceList([WHITE]);

  assert.deepEqual(presets().updateDevicePreset('p-9', attributes(OAK)), { ok: false, error: 'FAILED' });
  assert.deepEqual(JSON.parse(values.get('qatlia-panel-presets')), [WHITE]);
});

/** Replaces fetch for one call, recording what was sent. */
function answer(status, body) {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    if (body instanceof Error) throw body;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return calls;
}

test('an account panel is edited through the API, as a whole', async () => {
  const edited = { id: 'cloud-1', ...attributes(OAK) };
  const calls = answer(200, { success: true, preset: edited });

  assert.deepEqual(await presets().updateAccountPreset('cloud-1', attributes(OAK)), { ok: true, preset: edited });
  assert.equal(calls[0].url, '/api/panel-presets/cloud-1');
  assert.equal(calls[0].init.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].init.body), attributes(OAK));
});

test('the account refusing a duplicate gives the name of the other panel', async () => {
  answer(409, { error: 'DUPLICATE_PRESET', existingName: 'Chêne atelier' });

  assert.deepEqual(await presets().updateAccountPreset('cloud-1', attributes(OAK)), { ok: false, error: 'DUPLICATE', existingName: 'Chêne atelier' });
});

test('an account that cannot be reached, or answers anything else, is a failure', async () => {
  for (const [status, body] of [[503, { error: 'PRESETS_UNAVAILABLE' }], [404, { error: 'NOT_FOUND' }], [500, null], [0, new Error('offline')]]) {
    answer(status, body);
    assert.deepEqual(await presets().updateAccountPreset('cloud-1', attributes(OAK)), { ok: false, error: 'FAILED' }, String(status));
  }
});

// The panel catalogue on a device without an account (owner request,
// 2026-11-18): copied once into the device list, never again after.

const catalog = () => loadTsModule('src/lib/panel-catalog.ts');

test('a device list gets the catalogue once, priced in the currency shown', () => {
  deviceList([WHITE]);

  assert.equal(presets().copyCatalogToDeviceOnce('MAD'), true);
  const stored = JSON.parse(values.get('qatlia-panel-presets'));
  assert.equal(stored.length, 1 + catalog().PANEL_CATALOG.length);
  assert.equal(stored[0].id, 'p-1', 'the artisan’s own panels first, untouched');
  assert.equal(stored[1].name, '031 Blanc lisse 18 mm');
  assert.equal(stored[1].pricePerSheet, 530);
  assert.ok(stored.slice(1).every((p) => p.id.startsWith('p-') && !p.builtIn), 'panels of the artisan, ready to change');
});

test('a device list that had the catalogue never gets it back', () => {
  deviceList([]);
  presets().copyCatalogToDeviceOnce('MAD');
  values.set('qatlia-panel-presets', '[]');

  assert.equal(presets().copyCatalogToDeviceOnce('MAD'), false);
  assert.equal(values.get('qatlia-panel-presets'), '[]');
});

test('the device copy skips what is there and stays within the device cap', () => {
  const many = Array.from({ length: 35 }, (_, i) => ({ id: `p-${i}`, name: `P${i}`, height: 100 + i, width: 50, material: 'mdf' }));
  deviceList(many);

  presets().copyCatalogToDeviceOnce('EUR');

  const stored = JSON.parse(values.get('qatlia-panel-presets'));
  assert.equal(stored.length, 40);
  assert.equal(stored[35].pricePerSheet, 49.07, 'euros for a euro visitor');
});
