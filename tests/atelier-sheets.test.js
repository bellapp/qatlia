const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Several photos picked at once (spec 2026-11-17): they must be read one after
// another, each sending the scan group the previous one got back. Read in
// parallel, none would have a group yet and every one would be charged. The
// app cannot start here, so the wiring is checked in the source.

const page = fs.readFileSync(path.resolve('src/app/(site)/atelier/page.tsx'), 'utf8');
const slice = (from, to) => page.slice(page.indexOf(from), page.indexOf(to));

test('picked photos are read one after another, never in parallel', () => {
  const upload = slice('const handleImageUpload = async', 'const runScan = async');
  assert.match(upload, /for \(const file of chosen\) \{[\s\S]*?await runScan\(scanImage, \{ batch: true \}\);/);
  assert.doesNotMatch(upload, /Promise\.all|\.map\(\s*async/);
  assert.match(upload, /const chosen = files\.slice\(0, room\);/, 'photos past the 4th are not read');
  assert.match(page, /<input type="file" accept="image\/\*" multiple /, 'the gallery accepts several photos');
});

test('each photo sends the project group, and keeps the one the server gives back', () => {
  const run = slice('const runScan = async', '// Runs a resumed action');
  assert.match(run, /\.\.\.\(scanGroupRef\.current \? \{ scanGroup: scanGroupRef\.current \} : \{\}\)/);
  assert.match(run, /scanGroupRef\.current = typeof data\.scanGroup === 'string' \? data\.scanGroup : null;/);
  assert.match(run, /if \(sheetIndex >= MAX_SCAN_SHEETS\) return 'failed';/, 'a 5th sheet is never sent');
});

test('a new job and a reopened project each bring their own group', () => {
  const newJob = slice('const startNewJob = () =>', 'const commitProjectName = async');
  assert.match(newJob, /scanGroupRef\.current = null;/);
  assert.match(page, /scanGroupRef\.current = isUuid\(parsed\.scanGroup\) \? \(parsed\.scanGroup as string\) : null;/);
});

test('a later sheet adds its pieces instead of replacing the list', () => {
  const run = slice('const runScan = async', '// Runs a resumed action');
  assert.match(run, /appendSheetPieces\(prev, readPieces\(replace \? 0 : prev\.length\), sheetNumber, replace\)/);
  assert.match(run, /const replace = sheetIndex === 0 && scanGroupRef\.current === null;/);
});
