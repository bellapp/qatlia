const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// The bar invites leaving the atelier for another screen. What is on screen
// (pieces, panel, settings, plan) is kept in the tab while away, and put back
// on return. Keeping it must never make leaving the atelier fail.

const fs = require('node:fs');
const path = require('node:path');

const {
  ATELIER_DRAFT_KEY,
  writeAtelierDraft,
  readAtelierDraft,
  clearAtelierDraft,
  forgetAtelierDraft,
  buildAtelierDraft,
  draftToRestore,
} = loadTsModule('src/lib/atelier-draft.ts');

/** A storage that can refuse its next `failures` writes, as a full quota does. */
function fakeStore({ failures = 0 } = {}) {
  const values = new Map();
  let left = failures;
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => {
      if (left > 0) {
        left -= 1;
        throw new Error('QuotaExceededError');
      }
      values.set(key, String(value));
    },
    removeItem: (key) => { values.delete(key); },
  };
}

function draft(overrides = {}) {
  return {
    v: 1,
    project: {
      name: 'Caissons bas',
      sheet: { height: 244, width: 122, material: 'mdf' },
      pieces: [{ id: 'p1', height: 72, width: 58, quantity: 4 }],
      options: { kerfWidth: 3 },
      result: { sheets: [{ placements: [1, 2, 3] }] },
    },
    plannedPieces: [{ id: 'p1', height: 72, width: 58, quantity: 4 }],
    cutMode: '2d',
    projectId: 'cloud-1',
    localProjectId: null,
    restoredAt: '2026-11-17T09:00:00.000Z',
    ...overrides,
  };
}

test('a draft written is read back as it was', () => {
  const store = fakeStore();

  assert.equal(writeAtelierDraft(store, draft()), 'full');
  assert.deepEqual(readAtelierDraft(store), draft());
  assert.ok(store.values.has(ATELIER_DRAFT_KEY));
});

test('a damaged draft reads as no draft, and is removed', () => {
  for (const damaged of ['{not json', 'null', '[]', '"text"', JSON.stringify({ ...draft(), v: 2 }), JSON.stringify({ ...draft(), project: null }), JSON.stringify({ ...draft(), cutMode: '3d' }), JSON.stringify({ ...draft(), plannedPieces: 'all' })]) {
    const store = fakeStore();
    store.values.set(ATELIER_DRAFT_KEY, damaged);

    assert.equal(readAtelierDraft(store), null, damaged);
    assert.equal(store.values.has(ATELIER_DRAFT_KEY), false, `${damaged} is removed`);
  }
});

test('no draft reads as no draft', () => {
  assert.equal(readAtelierDraft(fakeStore()), null);
});

test('a draft too big for the tab is kept without its plan', () => {
  const store = fakeStore({ failures: 1 });

  assert.equal(writeAtelierDraft(store, draft()), 'without-plan');

  const kept = readAtelierDraft(store);
  assert.equal('result' in kept.project, false, 'the plan is left out');
  assert.equal(kept.plannedPieces, null);
  assert.deepEqual(kept.project.pieces, draft().project.pieces, 'the pieces are kept');
  assert.deepEqual(kept.project.sheet, draft().project.sheet, 'the panel is kept');
  assert.equal(kept.restoredAt, null, 'no plan left to call reopened');
});

test('a draft that cannot be kept at all is dropped without an error, and no older one comes back', () => {
  const store = fakeStore();
  writeAtelierDraft(store, draft({ projectId: 'older' }));
  const full = { ...store, setItem: () => { throw new Error('QuotaExceededError'); } };

  assert.equal(writeAtelierDraft(full, draft()), 'dropped');
  assert.equal(store.values.has(ATELIER_DRAFT_KEY), false);
  assert.equal(readAtelierDraft(store), null);
});

test('the input of the writer is left untouched when the plan is left out', () => {
  const input = draft();

  writeAtelierDraft(fakeStore({ failures: 1 }), input);

  assert.deepEqual(input, draft());
});

test('clearing removes the draft', () => {
  const store = fakeStore();
  writeAtelierDraft(store, draft());

  clearAtelierDraft(store);

  assert.equal(store.values.has(ATELIER_DRAFT_KEY), false);
});

test('a storage that refuses everything never makes the atelier fail', () => {
  const blocked = {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('SecurityError'); },
    removeItem: () => { throw new Error('SecurityError'); },
  };

  assert.equal(writeAtelierDraft(blocked, draft()), 'dropped');
  assert.equal(readAtelierDraft(blocked), null);
  assert.doesNotThrow(() => clearAtelierDraft(blocked));
});

// Sign-out. The menu that signs out sits in the atelier: clearing the draft
// alone would be undone a moment later, when the atelier closes and keeps it.

test('after a sign-out the draft is gone and the atelier closing does not keep it again', () => {
  const store = fakeStore();
  writeAtelierDraft(store, draft());

  forgetAtelierDraft(store);

  assert.equal(store.values.has(ATELIER_DRAFT_KEY), false);
  assert.equal(writeAtelierDraft(store, draft()), 'dropped', 'the atelier closing behind the sign-out');
  assert.equal(store.values.has(ATELIER_DRAFT_KEY), false);
});

test('the next atelier opened after a sign-out keeps its own job as usual', () => {
  const store = fakeStore();
  forgetAtelierDraft(store);

  assert.equal(readAtelierDraft(store), null, 'the atelier opens with nothing to restore');
  assert.equal(writeAtelierDraft(store, draft()), 'full');
  assert.deepEqual(readAtelierDraft(store), draft());
});

// What is kept when the atelier is left.

const payload = () => ({ ...draft().project, displayUnit: 'cm' });
const leaving = (overrides = {}) => ({
  payload: payload(),
  hasPlan: true,
  plannedPieces: payload().pieces,
  cutMode: '2d',
  projectId: 'cloud-1',
  localProjectId: null,
  restoredAt: '2026-11-17T09:00:00.000Z',
  ...overrides,
});

test('a job with its plan is kept whole', () => {
  const kept = buildAtelierDraft(leaving());

  assert.equal(kept.v, 1);
  assert.deepEqual(kept.project, payload());
  assert.equal(kept.plannedPieces, null, 'the plan was made from the pieces on screen: said once');
  assert.equal(kept.restoredAt, '2026-11-17T09:00:00.000Z');
  assert.equal(kept.projectId, 'cloud-1');
});

test('pieces changed since the plan are kept beside the ones the plan was made from', () => {
  const planned = [{ id: 'p1', height: 72, width: 58, quantity: 2 }];

  assert.deepEqual(buildAtelierDraft(leaving({ plannedPieces: planned })).plannedPieces, planned);
});

test('a job without a plan is kept without one, and is not called a reopened plan', () => {
  const kept = buildAtelierDraft(leaving({ hasPlan: false, plannedPieces: null }));

  assert.equal('result' in kept.project, false);
  assert.deepEqual(kept.project.pieces, payload().pieces);
  assert.equal(kept.plannedPieces, null);
  assert.equal(kept.restoredAt, null);
  assert.equal(kept.cutMode, '2d');
});

// The round trip, with the modules the atelier restores a saved project with.

test('a job kept and read back restores as a saved project does: plan, sheets in place, unit', () => {
  const { buildPersistedProjectPayload } = loadTsModule('src/lib/projects/persistence-payload.ts');
  const { pickRestorableResult } = loadTsModule('src/lib/projects/restore.ts');
  const { readScanSheets } = loadTsModule('src/lib/projects/scan-sheets.ts');
  const { resolveProjectUnitMetadata } = loadTsModule('src/lib/units.ts');

  const thumb = 'data:image/jpeg;base64,AAAA';
  const scanPath = '11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg';
  const plan = {
    sheetsUsed: 1,
    sheets: [{ height: 244, width: 122 }],
    placedPieces: [{ id: 'p1', x: 0, y: 0, width: 58, height: 72, sheetIndex: 0 }],
    wastePercentage: 12,
    cutMode: '2d',
  };
  const saved = buildPersistedProjectPayload({
    name: 'Caissons bas',
    projectName: 'Caissons bas',
    // The second sheet has no thumbnail yet and no stored image: it keeps its place.
    scans: [{ thumb, path: scanPath }, { thumb: undefined, path: undefined }, { thumb }],
    scanGroup: '33333333-3333-4333-8333-333333333333',
    sheets: [{ height: 244, width: 122, material: 'mdf' }],
    sheet: { height: 244, width: 122, material: 'mdf' },
    pieces: [{ id: 'p1', height: 72, width: 58, quantity: 4, scanIndex: 3 }],
    options: { kerfWidth: 3 },
    result: plan,
    displayUnit: 'mm',
    migratedFromLegacyUnit: false,
  });
  const store = fakeStore();

  writeAtelierDraft(store, buildAtelierDraft(leaving({ payload: saved, plannedPieces: saved.pieces, restoredAt: null })));
  const { project } = readAtelierDraft(store);

  assert.deepEqual(pickRestorableResult(project.result), { ...plan, offcuts: [], unplacedPieces: [] });
  assert.deepEqual(readScanSheets(project), [{ thumb, path: scanPath }, {}, { thumb }]);
  assert.equal(project.scanGroup, '33333333-3333-4333-8333-333333333333');
  assert.deepEqual(project.pieces, saved.pieces);
  assert.equal(project.projectName, 'Caissons bas');
  assert.deepEqual(resolveProjectUnitMetadata(project), { displayUnit: 'mm', canonicalUnit: 'cm', migrated: false, migratedFromLegacyUnit: false });
});

// Which one wins when the atelier opens.

test('a project opened from the history, or work kept for a sign-in in this tab, comes before the draft', () => {
  const kept = draft();

  assert.equal(draftToRestore(kept, { openedFromHistory: false, pendingWorkFromThisTab: false }), kept);
  assert.equal(draftToRestore(kept, { openedFromHistory: true, pendingWorkFromThisTab: false }), null);
  assert.equal(draftToRestore(kept, { openedFromHistory: false, pendingWorkFromThisTab: true }), null);
  assert.equal(draftToRestore(null, { openedFromHistory: false, pendingWorkFromThisTab: false }), null);
});

// The atelier itself, read as text: the page needs a session to run.

const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');
const atelier = read('src/app/(site)/atelier/page.tsx');

test('the atelier keeps its job when it closes, from what the last render showed', () => {
  assert.match(atelier, /const leaveDraft = \(\) =>\s*buildAtelierDraft\(\{/);
  assert.match(atelier, /const leaveDraftRef = useRef\(leaveDraft\);\s*leaveDraftRef\.current = leaveDraft;/, 'refreshed at every render');
  assert.match(
    atelier,
    /return \(\) => \{\s*window\.clearTimeout\(arm\);\s*if \(!armed\) return;\s*writeAtelierDraft\(window\.sessionStorage, leaveDraftRef\.current\(\)\);\s*\};\s*\}, \[\]\);/,
    'written once, when the atelier closes'
  );
});

test('the scan is kept as its thumbnail and its path, never as the full image', () => {
  const builder = atelier.slice(atelier.indexOf('const leaveDraft = () =>'), atelier.indexOf('const leaveDraftRef = useRef(leaveDraft);'));

  assert.ok(builder.length > 0, 'the builder is delimited');
  assert.match(builder, /scans: scanSheetsRef\.current\.map\(\(sheet\) => \(\{ thumb: sheet\.thumb, path: sheet\.keeper\.knownPath\(\) \?\? undefined \}\)\)/);
  assert.equal(builder.includes('.image'), false);
});

test('the atelier restores the kept job only when nothing comes before it, and forgets it once read', () => {
  const restore = atelier.slice(atelier.indexOf("const savedProj = sessionStorage.getItem('qatlia_saved_project');"), atelier.indexOf('const handleDisplayUnitChange'));

  assert.match(restore, /const draft = draftToRestore\(readAtelierDraft\(window\.sessionStorage\), \{\s*openedFromHistory: !!savedProj,\s*pendingWorkFromThisTab: /);
  assert.match(restore, /window\.setTimeout\(\(\) => clearAtelierDraft\(window\.sessionStorage\), 0\);/);
  assert.match(restore, /openedFromHistoryRef\.current = !!savedProj \|\| !!draft;/, 'work kept for a sign-in elsewhere stays out, as after a reopened project');
  assert.match(restore, /const parsed = draft \? draft\.project : JSON\.parse\(savedProj \?\? ''\);/, 'one restore path for both');
  assert.match(restore, /setRestoredAt\(draft \? draft\.restoredAt : readRestoredProjectDate\(/, 'no reopened-plan banner for a plan made in this session');
  assert.match(restore, /if \(draft\) setCutMode\(draft\.cutMode\);/);
});

test('a new job leaves no kept job behind', () => {
  const newJob = atelier.slice(atelier.indexOf('const startNewJob = () => {')).slice(0, 1800);

  assert.match(newJob, /clearAtelierDraft\(window\.sessionStorage\);/);
});

test('signing out forgets the kept job, from the menu and from the account page', () => {
  for (const file of ['src/components/AccountMenu.tsx', 'src/app/(site)/account/page.tsx']) {
    assert.match(
      read(file),
      /clearPendingWork\(window\.localStorage, window\.sessionStorage\);\s*forgetAtelierDraft\(window\.sessionStorage\);/,
      file
    );
  }
});

// A save still running when the atelier is left: the job kept in the tab has no
// project yet. The save, finishing after, gives it its project, so a PDF
// exported or a name typed on return updates that project instead of saving
// the plan a second time.

const { adoptSavedJob } = loadTsModule('src/lib/atelier-draft.ts');

function keptWhileSaving(overrides = {}) {
  const store = fakeStore();
  writeAtelierDraft(store, draft({ projectId: null, localProjectId: null, restoredAt: null, ...overrides }));
  return store;
}

test('a save finishing after the atelier was left gives the kept job its project', () => {
  const store = keptWhileSaving();

  adoptSavedJob(store, { result: draft().project.result, projectId: 'cloud-9', localProjectId: null });

  assert.equal(readAtelierDraft(store).projectId, 'cloud-9');
});

test('a save kept on this device only gives the kept job its local entry', () => {
  const store = keptWhileSaving();

  adoptSavedJob(store, { result: draft().project.result, projectId: null, localProjectId: 'optimize_1' });

  assert.equal(readAtelierDraft(store).localProjectId, 'optimize_1');
});

test('the save of another plan leaves the kept job alone', () => {
  const store = keptWhileSaving();

  adoptSavedJob(store, { result: { sheets: [{ placements: [9] }] }, projectId: 'cloud-9', localProjectId: null });

  assert.equal(readAtelierDraft(store).projectId, null);
});

test('a kept job that already has its project keeps it', () => {
  const store = keptWhileSaving({ projectId: 'cloud-1' });

  adoptSavedJob(store, { result: draft().project.result, projectId: 'cloud-9', localProjectId: null });

  assert.equal(readAtelierDraft(store).projectId, 'cloud-1');
});

test('the images stored after the save fill the sheets that had none, in place', () => {
  const kept = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg';
  const fresh = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg';
  const project = { ...draft().project, scans: [{ thumb: 'data:image/jpeg;base64,AAAA', path: kept }, {}, { thumb: 'data:image/jpeg;base64,BBBB' }] };
  const store = keptWhileSaving({ project });

  adoptSavedJob(store, { result: project.result, scanPaths: [null, null, fresh] });

  assert.deepEqual(readAtelierDraft(store).project.scans, [
    { thumb: 'data:image/jpeg;base64,AAAA', path: kept },
    {},
    { thumb: 'data:image/jpeg;base64,BBBB', path: fresh },
  ]);
});

test('with no job kept in the tab, a save writes nothing there', () => {
  const store = fakeStore();

  adoptSavedJob(store, { result: draft().project.result, projectId: 'cloud-9', localProjectId: null });

  assert.equal(store.values.size, 0);
});

test('the atelier hands each save to the job it may have kept, then the images once stored', () => {
  const persist = atelier.slice(atelier.indexOf('const persistProject = async'), atelier.indexOf('const recordPdfGenerated'));

  assert.match(persist, /adoptSavedJob\(window\.sessionStorage, \{ result: nextResult, projectId: savedCloudId, localProjectId: savedLocalId \}\);/);
  assert.match(
    persist,
    /void scanAttachRef\.current\.then\(\(\) =>\s*adoptSavedJob\(window\.sessionStorage, \{ result: nextResult, scanPaths: sheetsAtSave\.map\(\(sheet\) => sheet\.keeper\.knownPath\(\)\) \}\)\s*\);/
  );
});
