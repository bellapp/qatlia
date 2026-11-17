const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// The form of the panel page: what the artisan types, in their unit, becomes a
// panel the account store accepts, or says which fields are wrong.

const { PANEL_NAME_MAX_CHARS, EMPTY_PANEL_FORM, panelToForm, parsePanelForm } = loadTsModule('src/lib/panel-form.ts');

const filled = (overrides = {}) => ({
  ...EMPTY_PANEL_FORM,
  name: 'MDF blanc',
  height: '244',
  width: '122',
  material: 'mdf',
  ...overrides,
});

test('a filled form gives the panel, dimensions in centimetres', () => {
  assert.deepEqual(parsePanelForm(filled({ color: '  Blanc ', price: '320' }), 'cm'), {
    ok: true,
    preset: { name: 'MDF blanc', height: 244, width: 122, material: 'mdf', color: 'Blanc', pricePerSheet: 320 },
  });
});

test('dimensions typed in millimetres come back in centimetres', () => {
  const parsed = parsePanelForm(filled({ height: '2440', width: '1220' }), 'mm');

  assert.equal(parsed.preset.height, 244);
  assert.equal(parsed.preset.width, 122);
});

test('a decimal comma is read as a decimal point', () => {
  assert.equal(parsePanelForm(filled({ height: '244,5', price: '320,50' }), 'cm').preset.height, 244.5);
  assert.equal(parsePanelForm(filled({ price: '320,50' }), 'cm').preset.pricePerSheet, 320.5);
});

test('a blank price is no price, a blank colour no colour', () => {
  const { preset } = parsePanelForm(filled({ price: '  ', color: ' ' }), 'cm');

  assert.equal('pricePerSheet' in preset, false);
  assert.equal('color' in preset, false);
});

test('without grain there is no grain direction', () => {
  assert.equal('grainOrientation' in parsePanelForm(filled({ hasGrain: false, grainOrientation: 'horizontal' }), 'cm').preset, false);
  assert.deepEqual(
    parsePanelForm(filled({ hasGrain: true, grainOrientation: 'horizontal' }), 'cm').preset,
    { name: 'MDF blanc', height: 244, width: 122, material: 'mdf', hasGrain: true, grainOrientation: 'horizontal' }
  );
});

test('every wrong field is named at once', () => {
  assert.deepEqual(parsePanelForm(filled({ name: '  ', height: '0', width: 'abc', price: 'abc' }), 'cm'), {
    ok: false,
    errors: ['name', 'height', 'width', 'price'],
  });
});

test('a name longer than the account store keeps is refused, one at the limit is kept', () => {
  assert.equal(PANEL_NAME_MAX_CHARS, 80);
  assert.deepEqual(parsePanelForm(filled({ name: 'x'.repeat(81) }), 'cm'), { ok: false, errors: ['name'] });
  assert.equal(parsePanelForm(filled({ name: 'x'.repeat(80) }), 'cm').ok, true);
});

test('sizes and prices the optimizer would refuse are refused here', () => {
  assert.deepEqual(parsePanelForm(filled({ height: '-5' }), 'cm').errors, ['height']);
  assert.deepEqual(parsePanelForm(filled({ width: '100001' }), 'cm').errors, ['width']);
  assert.deepEqual(parsePanelForm(filled({ price: '-1' }), 'cm').errors, ['price']);
  assert.deepEqual(parsePanelForm(filled({ price: '1000001' }), 'cm').errors, ['price']);
});

test('a material outside the list falls back to MDF, as a new panel does', () => {
  assert.equal(parsePanelForm(filled({ material: 'plywood' }), 'cm').preset.material, 'mdf');
});

test('a saved panel opened in the form and saved again is the same panel', () => {
  const saved = { id: 'p-1', name: 'Chêne clair', height: 280, width: 207, material: 'contreplaques', color: 'Chêne', hasGrain: true, grainOrientation: 'horizontal', pricePerSheet: 540.5 };

  for (const unit of ['cm', 'mm']) {
    const { id: _id, ...attributes } = saved;
    void _id;
    assert.deepEqual(parsePanelForm(panelToForm(saved, unit), unit), { ok: true, preset: attributes }, unit);
  }
  assert.equal(panelToForm(saved, 'mm').height, '2800');
  assert.equal(panelToForm(saved, 'cm').price, '540.5');
});

test('the empty form starts on MDF, vertical grain unticked, nothing typed', () => {
  assert.deepEqual(EMPTY_PANEL_FORM, { name: '', height: '', width: '', material: 'mdf', color: '', hasGrain: false, grainOrientation: 'vertical', price: '' });
});
