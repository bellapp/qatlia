const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// pruneFreeRects() is a private helper of the guillotine packer that removes free
// rectangles fully contained within another free rectangle after every placement.
// It is exposed read-only via GuillotinePacker for this pure-function regression.

test('pruneFreeRects keeps exactly one survivor for exact duplicate rectangles', () => {
  const { GuillotinePacker } = loadTsModule('src/lib/cutting/binpacking.ts');
  const duplicate = { x: 0, y: 0, width: 10, height: 10 };

  const result = GuillotinePacker.pruneFreeRects([{ ...duplicate }, { ...duplicate }]);

  assert.equal(result.length, 1, 'exact duplicates must dedupe to exactly one survivor, not zero');
  assert.deepEqual(result[0], duplicate);
});

test('pruneFreeRects keeps exactly one survivor among three exact duplicates', () => {
  const { GuillotinePacker } = loadTsModule('src/lib/cutting/binpacking.ts');
  const duplicate = { x: 5, y: 5, width: 20, height: 8 };

  const result = GuillotinePacker.pruneFreeRects([{ ...duplicate }, { ...duplicate }, { ...duplicate }]);

  assert.equal(result.length, 1, 'three-way exact duplicates must still dedupe to exactly one survivor');
});

test('pruneFreeRects still drops a rectangle strictly contained in a larger one', () => {
  const { GuillotinePacker } = loadTsModule('src/lib/cutting/binpacking.ts');
  const outer = { x: 0, y: 0, width: 20, height: 20 };
  const inner = { x: 0, y: 0, width: 10, height: 10 };

  const result = GuillotinePacker.pruneFreeRects([outer, inner]);

  assert.equal(result.length, 1, 'a strictly smaller contained rectangle must still be dropped');
  assert.deepEqual(result[0], outer);
});

test('pruneFreeRects keeps distinct non-overlapping rectangles', () => {
  const { GuillotinePacker } = loadTsModule('src/lib/cutting/binpacking.ts');
  const a = { x: 0, y: 0, width: 10, height: 10 };
  const b = { x: 50, y: 50, width: 5, height: 5 };

  const result = GuillotinePacker.pruneFreeRects([a, b]);

  assert.equal(result.length, 2, 'disjoint rectangles must not be affected by dedup');
});
