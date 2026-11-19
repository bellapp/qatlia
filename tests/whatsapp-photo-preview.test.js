const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// A job opened from a WhatsApp link shows a free preview of the plan
// (plan 2026-11-19-whatsapp-plan-apercu, Task 3). Signed in, the atelier runs
// the normal, paid optimization once; signed out, it shows the sign-up banner.

const { photoPreviewStep, previewExportGate } = loadTsModule('src/lib/whatsapp/photo-preview.ts');
const { buildAtelierDraft } = loadTsModule('src/lib/atelier-draft.ts');
const { isPhotoPreview } = loadTsModule('src/lib/whatsapp/photo-summary.ts');

test('no preview : nothing to do', () => {
  assert.equal(photoPreviewStep({ preview: false, signedIn: true }), 'none');
  assert.equal(photoPreviewStep({ preview: false, signedIn: false }), 'none');
});

test('a preview while the sign-in is still unknown : wait', () => {
  assert.equal(photoPreviewStep({ preview: true, signedIn: null }), 'wait');
});

test('a preview, signed in : run the paid optimization', () => {
  assert.equal(photoPreviewStep({ preview: true, signedIn: true }), 'run');
});

test('a preview, signed out : the sign-up banner', () => {
  assert.equal(photoPreviewStep({ preview: true, signedIn: false }), 'banner');
});

// Review of the branch: the free preview must never leave the atelier as a
// file (PDF, quote, DXF, PNG, JSON) before a paid run replaced it, whatever
// the sign-in state: a signed-in user whose run did not happen (0 credits,
// network, sign-up confirmed in another tab) still holds only the preview.

test('a paid plan, or a normal job : exports allowed', () => {
  assert.equal(previewExportGate({ preview: false, signedIn: true }), 'allow');
  assert.equal(previewExportGate({ preview: false, signedIn: false }), 'allow');
});

test('the preview, signed out : sign up first (then the paid run)', () => {
  assert.equal(previewExportGate({ preview: true, signedIn: false }), 'sign-in');
});

test('the preview, signed in : the paid run instead of the export', () => {
  assert.equal(previewExportGate({ preview: true, signedIn: true }), 'run');
});

test('the atelier routes PDF, quote, DXF, PNG and JSON through the preview gate', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync('src/app/(site)/atelier/page.tsx', 'utf8');
  for (const handler of ['handleDownloadPdf', 'handleDownloadDxf', 'handleDownloadPng', 'handleDownloadJson']) {
    const start = source.indexOf(`const ${handler} = `);
    assert.notEqual(start, -1, `${handler} exists`);
    const body = source.slice(start, start + 600);
    assert.match(body, /previewBlocksExport\(\)/, `${handler} asks the preview gate first`);
  }
  // The quote has one opener (tests/atelier-nav.test.js); the gate comes right before it.
  const opener = source.indexOf('setIsQuotationDialogOpen(true)');
  assert.match(source.slice(opener - 200, opener), /if \(await previewBlocksExport\(\)\) return;/, 'the quote opens through the gate');
});

const leaving = (over = {}) => ({
  payload: { pieces: [{ id: '1', height: 50, width: 40, quantity: 2 }], result: { sheetsUsed: 1 } },
  hasPlan: true,
  plannedPieces: null,
  cutMode: '2d',
  projectId: null,
  localProjectId: null,
  restoredAt: null,
  keptAt: 1,
  ...over,
});

test('leaving the atelier on a preview keeps it a preview, so signing in elsewhere still charges the run', () => {
  assert.equal(isPhotoPreview(buildAtelierDraft(leaving({ photoPreview: true })).project), true);
});

test('a normal job, or a preview whose plan is gone, is kept as a normal job', () => {
  assert.equal(isPhotoPreview(buildAtelierDraft(leaving()).project), false);
  assert.equal(isPhotoPreview(buildAtelierDraft(leaving({ photoPreview: true, hasPlan: false })).project), false);
});
