const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./helpers/load-ts-module');

// A job opened from a WhatsApp link shows a free preview of the plan
// (plan 2026-11-19-whatsapp-plan-apercu, Task 3). Signed in, the atelier runs
// the normal, paid optimization once; signed out, it shows the sign-up banner.

const { photoPreviewStep } = loadTsModule('src/lib/whatsapp/photo-preview.ts');
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
