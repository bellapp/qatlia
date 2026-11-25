const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');
const { renderComponent } = require('./helpers/render-component');

// Owner request, 2026-11-25: the button that computes the plan is often off
// the screen. A second one shows only then: in the header on a computer, at
// the bottom on a phone. A plan older than the pieces on screen says so.

const ROOT = path.resolve(__dirname, '..');
const load = (rel) => loadTsModule(path.join(ROOT, rel));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { planInputsKey, planShortcut } = load('src/lib/plan-inputs.ts');

const pieces = [
  { id: 'a', name: 'Côté', height: 200, width: 60, quantity: 2, material: 'mdf', rotatable: true, color: '#111111' },
  { id: 'b', name: 'Porte', height: 80, width: 40, quantity: 1, material: 'mdf', rotatable: true, edges: { top: true } },
];
const sheets = [{ id: 's0', height: 278, width: 208, kerf: 0, margin: 0, material: 'mdf', quantity: 1 }];
const options = { kerfWidth: 3, showLabels: true, singleSheetOnly: false, considerMaterial: false, edgeBanding: false, grainDirection: false, optimizationPriority: 'min_waste' };
const key = (change = {}) => planInputsKey({ pieces, sheets, options, cutMode: '2d', ...change });
const edit = (patch) => key({ pieces: [{ ...pieces[0], ...patch }, pieces[1]] });

test('what changes the cut makes the plan older than the pieces', () => {
  const before = key();
  for (const patch of [{ height: 201 }, { width: 61 }, { quantity: 3 }, { name: 'Fond' }, { rotatable: false }, { grain: 'vertical' }, { edges: { left: true } }, { material: 'plywood' }]) {
    assert.notEqual(edit(patch), before, JSON.stringify(patch));
  }
  assert.notEqual(key({ pieces: [pieces[0]] }), before, 'a piece removed');
  assert.notEqual(key({ cutMode: '1d' }), before);
  for (const patch of [{ height: 300 }, { width: 100 }, { margin: 1 }, { hasGrain: true }, { material: 'plywood' }]) {
    assert.notEqual(key({ sheets: [{ ...sheets[0], ...patch }] }), before, JSON.stringify(patch));
  }
  for (const patch of [{ kerfWidth: 4 }, { optimizationPriority: 'balanced' }, { singleSheetOnly: true }]) {
    assert.notEqual(key({ options: { ...options, ...patch } }), before, JSON.stringify(patch));
  }
});

test('what does not change the cut leaves the plan up to date', () => {
  const before = key();
  // A price is applied to the plan at once (repriceResult); a label or a color is only shown.
  assert.equal(edit({ color: '#222222' }), before);
  assert.equal(edit({ id: 'z' }), before);
  assert.equal(edit({ scanIndex: 2 }), before);
  assert.equal(edit({ edges: { left: false, right: false } }), before, 'no side banded is no edges');
  assert.equal(edit({ grain: 'none' }), before);
  assert.equal(key({ pieces: [pieces[1], pieces[0]] }), before, 'the order of the rows');
  assert.equal(key({ sheets: [{ ...sheets[0], label: 'Mon panneau', color: 'Blanc', pricePerSheet: 400 }] }), before);
  assert.equal(key({ options: { ...options, showLabels: false, edgeBandPricePerM: 9 } }), before);
  assert.equal(edit({ height: 201 }) === edit({ height: 201 }), true);
});

const state = (change = {}) => planShortcut({ hasPieces: true, sampleOnly: false, hasPlan: false, stale: false, mainVisible: false, reading: false, typing: false, ...change });

test('the second button shows only while the main one is off the screen', () => {
  assert.deepEqual(state(), { header: true, bar: true });
  assert.deepEqual(state({ mainVisible: true }), { header: false, bar: false });
  assert.deepEqual(state({ hasPieces: false }), { header: false, bar: false });
  assert.deepEqual(state({ reading: true }), { header: false, bar: false }, 'a cut list is being read');
});

test('on a phone the bar stays away when there is nothing to compute, or the keyboard is open', () => {
  assert.deepEqual(state({ hasPlan: true }), { header: true, bar: false }, 'the plan is up to date: the bar would cover it');
  assert.deepEqual(state({ hasPlan: true, stale: true }), { header: true, bar: true });
  assert.deepEqual(state({ sampleOnly: true }), { header: true, bar: false }, 'the example list a visitor opens on');
  assert.deepEqual(state({ typing: true }), { header: true, bar: false });
});

test('the buttons say compute, then compute again, in the three languages', () => {
  const props = { onRun: () => {}, busy: false, stale: false };
  const words = { fr: ['Calculer le plan', 'Recalculer le plan'], en: ['Compute the plan', 'Compute again'], ar: ['احسب المخطط', 'أعد حساب المخطط'] };
  for (const [locale, [first, again]] of Object.entries(words)) {
    for (const name of ['PlanHeaderButton', 'PlanBar']) {
      const html = renderComponent('src/components/PlanShortcut.tsx', name, { ...props, hasPlan: false }, locale);
      assert.ok(html.includes(`>${first}<`), `${locale} ${name}`);
      assert.ok(renderComponent('src/components/PlanShortcut.tsx', name, { ...props, hasPlan: true }, locale).includes(`>${again}<`), `${locale} ${name}`);
    }
  }
});

test('the header button is for a computer, the bar for a phone, and the bar clears the phone edge', () => {
  const props = { onRun: () => {}, busy: false, hasPlan: true, stale: true };
  const header = renderComponent('src/components/PlanShortcut.tsx', 'PlanHeaderButton', props);
  const bar = renderComponent('src/components/PlanShortcut.tsx', 'PlanBar', props);
  assert.match(header, /class="hidden lg:inline-flex/);
  assert.match(bar, /lg:hidden/);
  assert.match(bar, /fixed inset-x-0 bottom-0 z-40/, 'under every dialog (z-50 and up)');
  assert.match(bar, /safe-area-inset-bottom/);
  assert.match(bar, /Le plan n’est plus à jour/);
});

test('a run in progress cannot be started twice', () => {
  for (const name of ['PlanHeaderButton', 'PlanBar']) {
    assert.match(renderComponent('src/components/PlanShortcut.tsx', name, { onRun: () => {}, busy: true, hasPlan: true, stale: true }), /disabled=""/);
  }
});

test('the atelier wires it: the plan remembers what it was made from, the run is the one the main button starts', () => {
  const atelier = read('src/app/(site)/atelier/page.tsx');
  assert.match(atelier, /ref=\{mainRunRef\}/);
  assert.match(atelier, /<PlanHeaderButton/);
  assert.match(atelier, /<PlanBar/);
  assert.match(atelier, /data-testid="plan-stale-notice"/);
  const header = atelier.indexOf('<PlanHeaderButton');
  assert.ok(header > atelier.indexOf('<header') && header < atelier.indexOf('</header>'), 'in the header, not in the bar between screens');
  // The key is taken from what the run was sent, before the answer.
  const run = atelier.slice(atelier.indexOf('const handleRunOptimization'), atelier.indexOf('const previewBlocksExport'));
  assert.ok(run.indexOf('const runKey = planInputsKey(') < run.indexOf("fetch('/api/optimize'"));
  assert.match(run, /setPlanKey\(runKey\)/);
});

test('a job left and put back still knows its plan is old', () => {
  const { buildAtelierDraft } = load('src/lib/atelier-draft.ts');
  const leaving = { payload: { pieces: [], result: {} }, hasPlan: true, plannedPieces: [], cutMode: '2d', projectId: null, localProjectId: null, restoredAt: null, keptAt: 1 };
  assert.equal(buildAtelierDraft({ ...leaving, planKey: 'abc' }).planKey, 'abc');
  assert.equal('planKey' in buildAtelierDraft({ ...leaving, planKey: null }), false);
  assert.equal('planKey' in buildAtelierDraft({ ...leaving, hasPlan: false, planKey: 'abc' }), false);
  assert.match(read('src/app/(site)/atelier/page.tsx'), /typeof draft\?\.planKey === 'string'/);
});
