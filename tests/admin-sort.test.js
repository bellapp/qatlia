const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// Header sorting of the loaded back office tables (spec 2026-11-25).

const { compareSortValues, sortRows } = loadTsModule('src/lib/admin/sort.ts');

const sortOf = (values, dir) => sortRows(values.map((v) => ({ sort: [v] })), 0, dir).map((r) => r.sort[0]);

test('les nombres se trient comme des nombres', () => {
  assert.deepEqual(sortOf([10, 2, 33, -1], 'asc'), [-1, 2, 10, 33]);
  assert.deepEqual(sortOf([10, 2, 33, -1], 'desc'), [33, 10, 2, -1]);
});

test('les textes se trient en français, sans tenir compte des accents ni de la casse', () => {
  assert.deepEqual(sortOf(['étagère', 'Côté', 'bas', 'Pièce 10', 'Pièce 9'], 'asc'), ['bas', 'Côté', 'étagère', 'Pièce 9', 'Pièce 10']);
});

test('les dates ISO se trient dans l’ordre du temps', () => {
  const dates = ['2026-11-02T10:00:00Z', '2026-10-30T09:00:00Z', '2026-11-25T08:00:00Z'];
  assert.deepEqual(sortOf(dates, 'desc'), ['2026-11-25T08:00:00Z', '2026-11-02T10:00:00Z', '2026-10-30T09:00:00Z']);
});

test('les valeurs vides restent en dernier dans les deux sens', () => {
  assert.deepEqual(sortOf([null, 3, '', 1, NaN], 'asc').slice(0, 2), [1, 3]);
  assert.deepEqual(sortOf([null, 3, '', 1, NaN], 'desc').slice(0, 2), [3, 1]);
  assert.equal(compareSortValues(null, null, 'asc'), 0);
  assert.ok(compareSortValues(null, 1, 'desc') > 0);
  assert.ok(compareSortValues(1, null, 'asc') < 0);
});

test('le tri est stable : les égalités gardent leur ordre', () => {
  const rows = [
    { id: 'a', sort: [1] },
    { id: 'b', sort: [1] },
    { id: 'c', sort: [0] },
  ];
  assert.deepEqual(sortRows(rows, 0, 'desc').map((r) => r.id), ['a', 'b', 'c']);
  assert.deepEqual(sortRows(rows, 0, 'asc').map((r) => r.id), ['c', 'a', 'b']);
});
