const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// src/lib/logo-resize.ts: the pure sizing rule behind the logo upload on the
// account page. The canvas part (resizeLogoFile) needs a browser and is not
// exercised here.

function load() {
  return loadTsModule('src/lib/logo-resize.ts');
}

test('a wide image is scaled down so its longest side is the maximum', () => {
  const { fitWithin } = load();
  assert.deepEqual({ ...fitWithin(1200, 600, 600) }, { width: 600, height: 300 });
});

test('a tall image is scaled down so its longest side is the maximum', () => {
  const { fitWithin } = load();
  assert.deepEqual({ ...fitWithin(500, 2000, 600) }, { width: 150, height: 600 });
});

test('an image already within the maximum is left unchanged', () => {
  const { fitWithin } = load();
  assert.deepEqual({ ...fitWithin(300, 200, 600) }, { width: 300, height: 200 });
  assert.deepEqual({ ...fitWithin(600, 600, 600) }, { width: 600, height: 600 });
});

test('scaled sizes are whole pixels and never collapse to zero', () => {
  const { fitWithin } = load();
  const rounded = fitWithin(1000, 333, 600);
  assert.ok(Number.isInteger(rounded.width) && Number.isInteger(rounded.height));
  assert.deepEqual({ ...rounded }, { width: 600, height: 200 });
  const thin = { ...fitWithin(10000, 3, 600) };
  assert.equal(thin.width, 600);
  assert.equal(thin.height, 1);
});

test('the maximum side of a logo is 600 pixels', () => {
  assert.equal(load().LOGO_MAX_SIDE_PX, 600);
});
