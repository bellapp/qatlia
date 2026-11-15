const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

// The screen's wiring lives in the page files, so it is read from the source.

const atelierSource = () => fs.readFileSync(path.resolve('src/app/(site)/atelier/page.tsx'), 'utf8');
const historySource = () => fs.readFileSync(path.resolve('src/app/(site)/history/page.tsx'), 'utf8');

test('an emptied name shows no message, since the plan may already be saved', () => {
  assert.match(atelierSource(), /setNameSaveState\(outcome === 'pending' && !name \? 'idle' : outcome\)/);
});

test('a save of the whole project reads the name committed now and the line follows what it saved', () => {
  const page = atelierSource();
  const persist = page.slice(page.indexOf('const persistProject = async'), page.indexOf('const recordPdfGenerated'));
  assert.match(persist, /const committedName = projectNameRef\.current\.trim\(\);/);
  assert.match(persist, /projectName: committedName \|\| undefined,/);
  assert.match(persist, /name: committedName \|\| automaticProjectName,/);
  assert.doesNotMatch(persist, /projectName\.trim\(\)/);
  assert.match(persist, /lastPersistedNameRef\.current = committedName;/);
  // The reference follows every place the committed name is set.
  assert.equal(page.match(/commitName\(/g).length, 3);
  assert.equal(page.match(/setProjectName\(/g).length, 1);
});

test('renaming a card in the history also renames the project it reopens', () => {
  assert.match(
    historySource(),
    /p\.id === proj\.id \? \{ \.\.\.p, name, options_json: \{ \.\.\.p\.options_json, projectName: name \} \} : p/
  );
});

// Exporting the PDF of a device-only project marks its own entry.

test('the PDF of a local project is recorded on its own entry', () => {
  const { LOCAL_HISTORY_KEY, markLocalHistoryPdf } = history();
  const list = [
    { id: 'optimize_1', name: 'Cuisine', options_json: { projectName: 'Cuisine', pieces: [] } },
    { id: 'optimize_2', name: 'Autre', options_json: {} },
  ];
  const storage = memoryStorage({ [LOCAL_HISTORY_KEY]: JSON.stringify(list) });
  assert.equal(withStorage(storage, () => markLocalHistoryPdf('optimize_1', '2026-11-14T10:00:00.000Z')), true);
  const saved = JSON.parse(storage.map.get(LOCAL_HISTORY_KEY));
  assert.equal(saved.length, 2);
  assert.equal(saved[0].options_json.pdfGeneratedAt, '2026-11-14T10:00:00.000Z');
  assert.equal(saved[0].options_json.projectName, 'Cuisine');
  assert.deepEqual(saved[1], list[1]);
});

test('a PDF marker for a missing local entry or an unwritable history reports false', () => {
  const { LOCAL_HISTORY_KEY, markLocalHistoryPdf } = history();
  const raw = JSON.stringify([{ id: 'optimize_1', name: 'Cuisine', options_json: {} }]);
  const storage = memoryStorage({ [LOCAL_HISTORY_KEY]: raw });
  assert.equal(withStorage(storage, () => markLocalHistoryPdf('missing', '2026-11-14T10:00:00.000Z')), false);
  assert.equal(storage.map.get(LOCAL_HISTORY_KEY), raw);
  const broken = { getItem: () => raw, setItem: () => { throw new Error('quota'); } };
  assert.equal(withStorage(broken, () => markLocalHistoryPdf('optimize_1', '2026-11-14T10:00:00.000Z')), false);
});

test('the PDF of a project reopened from this device updates its entry instead of saving a new one', () => {
  const page = atelierSource();
  const record = page.slice(page.indexOf('const recordPdfGenerated'), page.indexOf('const askSignInKeepingWork'));
  assert.match(record, /if \(!lastSavedProjectId && localProjectId && markLocalHistoryPdf\(localProjectId, generatedAt\)\) return;\s*await persistProject\(result, 'pdf'/);
});

// A name left while a save is running must not be reported as saved.

test('a save that ran while the name changed writes the new name to the record it created', () => {
  const page = atelierSource();
  const persist = page.slice(page.indexOf('const persistProject = async'), page.indexOf('const recordPdfGenerated'));
  assert.match(persist, /if \(currentName === committedName\) \{\s*setNameSaveState\(committedName \? 'saved' : 'idle'\);\s*return;\s*\}/);
  assert.match(persist, /saveProjectName\(\s*\{ cloudId: savedCloudId, localId: savedLocalId \},\s*currentName,/);
  assert.match(persist, /if \(outcome === 'saved'\) lastPersistedNameRef\.current = currentName;/);
});

test('a name commit only records the name it saved when no newer save owns the line', () => {
  const page = atelierSource();
  assert.match(page, /if \(attempt !== nameSaveAttemptRef\.current\) return;\s*if \(outcome === 'saved'\) lastPersistedNameRef\.current = name;/);
});

test('the "optimized" chip is not shown on a plan reopened as saved', () => {
  assert.match(atelierSource(), /\{result && !restoredAt && \(\s*<span className="ms-auto inline-flex/);
});

test('a project renamed before the name was kept in its data reopens under the card name', () => {
  const page = historySource();
  const load = page.slice(page.indexOf('const handleLoadProject'), page.indexOf('const getMaterialBadge'));
  assert.match(load, /UUID_PATTERN\.test\(project\.id\)\s*&& project\.name\.trim\(\)\s*&& typeof storedName === 'string'\s*&& storedName\.trim\(\)\s*&& storedName\.trim\(\) !== project\.name\.trim\(\)/);
  assert.match(load, /\{ \.\.\.project\.options_json, projectName: project\.name\.trim\(\) \}/);
  assert.match(load, /JSON\.stringify\(restoredOptions\)/);
});

test('the rename route validates the name with the same rule as a save', () => {
  const route = fs.readFileSync(path.resolve('src/app/api/projects/[id]/route.ts'), 'utf8');
  assert.match(route, /const name = sanitizeProjectName\(body\?\.name\);/);
  assert.doesNotMatch(route, /RenameSchema/);
});
