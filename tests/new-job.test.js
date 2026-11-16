const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// User request, 2026-11-16: with a plan reopened from history on screen, the
// atelier had no way to start another job. The artisan had to scan over the
// old one (its name and plan stayed), or reload the page.

const newJob = () => loadTsModule('src/lib/new-job.ts');
const source = fs.readFileSync(path.resolve('src/app/(site)/atelier/page.tsx'), 'utf8');

const shelf = { id: 'a', name: 'Étagère', height: 70, width: 33, quantity: 6, material: 'mdf', rotatable: true };
const side = { id: 'b', name: 'Côté', height: 95.2, width: 33, quantity: 2, material: 'mdf', rotatable: true };

test('an empty list loses nothing', () => {
  assert.equal(newJob().piecesOnlyOnScreen([], [shelf]), false);
});

test('the list of the saved plan loses nothing, even as a fresh copy', () => {
  const { piecesOnlyOnScreen } = newJob();

  assert.equal(piecesOnlyOnScreen([{ ...shelf }, { ...side }], [shelf, side]), false);
});

test('a list changed since the plan exists only on screen', () => {
  const { piecesOnlyOnScreen } = newJob();

  assert.equal(piecesOnlyOnScreen([{ ...shelf, quantity: 7 }, side], [shelf, side]), true, 'a quantity was changed');
  assert.equal(piecesOnlyOnScreen([shelf, side, { ...side, id: 'c' }], [shelf, side]), true, 'a piece was added');
  assert.equal(piecesOnlyOnScreen([shelf], [shelf, side]), true, 'a piece was removed');
});

test('a list with no plan to compare it to exists only on screen', () => {
  assert.equal(newJob().piecesOnlyOnScreen([shelf], null), true);
});

/** The body of the function that starts a new job. */
function startNewJob() {
  const start = source.indexOf('const startNewJob = () => {');
  assert.ok(start > 0, 'the atelier can start a new job');
  return source.slice(start, source.indexOf('\n  };', start));
}

/** The opening tag of the new-job button. */
function newJobButton() {
  const marker = source.indexOf('data-testid="new-job-button"');
  assert.ok(marker > 0, 'the atelier has a new-job button');
  return source.slice(source.lastIndexOf('<button', marker), source.indexOf('</button>', marker));
}

test('the new-job button sits with the job name, above the plan', () => {
  const strip = source.indexOf('Project strip');
  const button = source.indexOf('data-testid="new-job-button"');
  const plan = source.indexOf('id="plan-top"');

  assert.ok(strip > 0 && plan > 0);
  assert.ok(strip < button && button < plan, 'it is in the strip that carries the job name');
  assert.ok(newJobButton().includes("'atelier.project.newJob'"), 'it carries its name');
});

test('a new job empties the pieces, the name, the scan and the plan', () => {
  const body = startNewJob();

  for (const call of [
    'setPieces([])',
    "commitName('')",
    "setProjectNameDraft('')",
    'setResult(null)',
    'setRestoredAt(null)',
    'setPreviewImage(null)',
    'setScanThumb(null)',
    'scanKeeper.restore(null)',
    'setPdfGeneratedAt(null)',
  ]) {
    assert.ok(body.includes(call), `${call} is part of a new job`);
  }
});

test('a new job is no longer the project that was on screen', () => {
  const body = startNewJob();

  // The name field writes to the saved project: left pointing at the old one,
  // naming the new job would rename the old one in history.
  assert.ok(body.includes('setLastSavedProjectId(null)'));
  assert.ok(body.includes('setLocalProjectId(null)'));
  assert.ok(body.includes("lastPersistedNameRef.current = ''"));
});

test('a new job keeps the panel, the cut settings and the unit', () => {
  const body = startNewJob();

  assert.doesNotMatch(body, /setSheets|setOptions|setCutMode|setDisplayUnit/);
});

test('pieces that exist only on screen are not dropped on the first click', () => {
  const handler = source.slice(source.indexOf('const handleNewJob = () => {'), source.indexOf('const startNewJob = () => {'));

  assert.ok(handler.length > 0, 'the click goes through a check first');
  assert.ok(handler.includes('piecesOnlyOnScreen('), 'the check is the one tested above');
  assert.ok(handler.includes('setConfirmingNewJob(true)'), 'the first click asks');
  assert.ok(newJobButton().includes("t(confirmingNewJob ? 'atelier.project.newJobConfirm' : 'atelier.project.newJob')"));
});

test('a question left unanswered goes away on its own', () => {
  // A button takes no focus from a tap on iOS, so leaving it cannot be the
  // only thing that takes the question back: an armed button forgotten there
  // would empty the list on a later tap.
  assert.match(source, /if \(!confirmingNewJob\) return;\s*const timer = window\.setTimeout\(\(\) => setConfirmingNewJob\(false\), NEW_JOB_CONFIRM_MS\);\s*return \(\) => window\.clearTimeout\(timer\);/);
  assert.match(source, /const NEW_JOB_CONFIRM_MS = \d[\d_]*;/);
});

test('no new job is started while a scan or an optimization is running', () => {
  // Its answer would land on the emptied atelier.
  assert.ok(newJobButton().includes('disabled={isOptimizing || isProcessingVision || !hasJobOnScreen}'));
});

test('the button is named in the three languages', () => {
  for (const locale of ['fr', 'en', 'ar']) {
    const messages = fs.readFileSync(path.resolve(`src/i18n/messages/${locale}.ts`), 'utf8');
    assert.match(messages, /newJob: '[^']+'/, `${locale} names the button`);
    assert.match(messages, /newJobConfirm: '[^']+'/, `${locale} words the confirmation`);
  }
});
