const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Typing a name in the atelier and leaving the field saves it: on the server
// for a saved project, on this device for a local-only one, and nowhere yet
// when no plan exists (the name then goes with the next save).

const PROJECT_ID = '22222222-3333-4444-8888-555555555555';

const rename = () => loadTsModule('src/lib/projects/rename.ts');
const history = () => loadTsModule('src/lib/history.ts');
const okFetch = (calls) => async (url, init) => { calls.push([url, JSON.parse(init.body)]); return { ok: true }; };

test('a saved project is renamed on the server', async () => {
  const calls = [];
  const outcome = await rename().saveProjectName({ cloudId: PROJECT_ID, localId: null }, ' Cuisine ', { fetch: okFetch(calls), renameLocal: () => false });
  assert.equal(outcome, 'saved');
  assert.deepEqual(calls, [[`/api/projects/${PROJECT_ID}`, { name: 'Cuisine' }]]);
});

test('a refused or unreachable rename is reported as failed', async () => {
  const refused = await rename().saveProjectName({ cloudId: PROJECT_ID, localId: null }, 'Cuisine', { fetch: async () => ({ ok: false }), renameLocal: () => false });
  const offline = await rename().saveProjectName({ cloudId: PROJECT_ID, localId: null }, 'Cuisine', { fetch: async () => { throw new Error('offline'); }, renameLocal: () => false });
  assert.deepEqual([refused, offline], ['failed', 'failed']);
});

test('a project kept on this device only is renamed there', async () => {
  const renamed = [];
  const outcome = await rename().saveProjectName({ cloudId: null, localId: 'optimize_1' }, 'Cuisine', { fetch: async () => { throw new Error('unused'); }, renameLocal: (id, name) => { renamed.push([id, name]); return true; } });
  assert.equal(outcome, 'saved');
  assert.deepEqual(renamed, [['optimize_1', 'Cuisine']]);
});

test('a local rename that cannot be written is reported as failed', async () => {
  const outcome = await rename().saveProjectName({ cloudId: null, localId: 'optimize_1' }, 'Cuisine', { fetch: async () => { throw new Error('unused'); }, renameLocal: () => false });
  assert.equal(outcome, 'failed');
});

test('with no saved plan yet, or an emptied name, nothing is sent', async () => {
  const calls = [];
  const deps = { fetch: okFetch(calls), renameLocal: () => true };
  assert.equal(await rename().saveProjectName({ cloudId: null, localId: null }, 'Cuisine', deps), 'pending');
  assert.equal(await rename().saveProjectName({ cloudId: PROJECT_ID, localId: null }, '   ', deps), 'pending');
  assert.deepEqual(calls, []);
});

// renameLocalHistoryItem works on the localStorage history (stubbed here).

function withStorage(storage, run) {
  const had = Object.prototype.hasOwnProperty.call(global, 'window');
  const previous = global.window;
  global.window = { localStorage: storage };
  try { return run(); } finally { if (had) global.window = previous; else delete global.window; }
}

function memoryStorage(initial) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, map };
}

test('renaming a local entry updates its name and its saved project name', () => {
  const { LOCAL_HISTORY_KEY, renameLocalHistoryItem } = history();
  const list = [
    { id: 'optimize_1', name: 'Ancien', options_json: { projectName: 'Ancien', pieces: [] } },
    { id: 'optimize_2', name: 'Autre', options_json: { projectName: 'Autre' } },
  ];
  const storage = memoryStorage({ [LOCAL_HISTORY_KEY]: JSON.stringify(list) });
  assert.equal(withStorage(storage, () => renameLocalHistoryItem('optimize_1', 'Cuisine')), true);
  const saved = JSON.parse(storage.map.get(LOCAL_HISTORY_KEY));
  assert.equal(saved[0].name, 'Cuisine');
  assert.equal(saved[0].options_json.projectName, 'Cuisine');
  assert.deepEqual(saved[0].options_json.pieces, []);
  assert.deepEqual(saved[1], list[1]);
});

test('renaming a local entry that does not exist changes nothing and says so', () => {
  const { LOCAL_HISTORY_KEY, renameLocalHistoryItem } = history();
  const raw = JSON.stringify([{ id: 'optimize_1', name: 'Ancien', options_json: {} }]);
  const storage = memoryStorage({ [LOCAL_HISTORY_KEY]: raw });
  assert.equal(withStorage(storage, () => renameLocalHistoryItem('missing', 'Cuisine')), false);
  assert.equal(storage.map.get(LOCAL_HISTORY_KEY), raw);
});

test('a local history that cannot be written reports false', () => {
  const { LOCAL_HISTORY_KEY, renameLocalHistoryItem } = history();
  const raw = JSON.stringify([{ id: 'optimize_1', name: 'Ancien', options_json: {} }]);
  const storage = { getItem: () => raw, setItem: () => { throw new Error('quota'); } };
  assert.equal(withStorage(storage, () => renameLocalHistoryItem('optimize_1', 'Cuisine')), false);
  assert.ok(LOCAL_HISTORY_KEY);
});
