const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module');

// A big list's picture takes 7 to 10 s to draw, and WhatsApp gave up on the
// card ("(#131053) Media upload error", hamouda's 351 pieces, 21/11/2026)
// while static files go through at once. The bot keeps the bytes it already
// downloads to check the picture, stores them in a public Supabase Storage
// bucket, and the card points at that file (owner's go, 22/11/2026).

const ROOT = path.resolve(__dirname, '..');
const { storePlanPicture, removePlanPictures, PLAN_PICTURE_BUCKET } = loadTsModule(path.join(ROOT, 'src/lib/whatsapp/plan-picture-store.ts'));
const { planCodeFromImageUrl } = loadTsModule(path.join(ROOT, 'src/lib/whatsapp/plan-image.ts'));

const PUBLIC = 'https://ref.supabase.co/storage/v1/object/public/whatsapp-plans/k7m2qx9dab.jpg';

function fakeStorage({ uploads = [{ data: { path: 'k7m2qx9dab.jpg' }, error: null }], create = { data: {}, error: null }, remove = { data: [], error: null } } = {}) {
  const calls = { uploads: [], creates: [], removes: [] };
  let n = 0;
  const storage = {
    from: (bucket) => ({
      upload: async (p, body, options) => {
        calls.uploads.push({ bucket, path: p, bytes: body.length, options });
        return uploads[Math.min(n++, uploads.length - 1)];
      },
      getPublicUrl: (p) => ({ data: { publicUrl: `https://ref.supabase.co/storage/v1/object/public/${bucket}/${p}` } }),
      remove: async (paths) => {
        calls.removes.push({ bucket, paths });
        return remove;
      },
    }),
    createBucket: async (name, options) => {
      calls.creates.push({ name, options });
      return create;
    },
  };
  return { db: { storage }, calls };
}

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

test('the picture is stored as <code>.jpg in the public bucket and its public link comes back', async () => {
  const { db, calls } = fakeStorage();
  assert.equal(PLAN_PICTURE_BUCKET, 'whatsapp-plans');
  assert.equal(await storePlanPicture(db, 'k7m2qx9dab', BYTES), PUBLIC);
  assert.deepEqual(calls.uploads, [
    { bucket: 'whatsapp-plans', path: 'k7m2qx9dab.jpg', bytes: 4, options: { contentType: 'image/jpeg', upsert: true, cacheControl: '86400' } },
  ]);
  assert.equal(calls.creates.length, 0);
});

test('the bucket is made public on first use, then the upload is tried again', async () => {
  const { db, calls } = fakeStorage({
    uploads: [{ data: null, error: { message: 'Bucket not found', statusCode: '404' } }, { data: { path: 'k7m2qx9dab.jpg' }, error: null }],
  });
  assert.equal(await storePlanPicture(db, 'k7m2qx9dab', BYTES), PUBLIC);
  assert.deepEqual(calls.creates, [
    { name: 'whatsapp-plans', options: { public: true, fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: ['image/jpeg'] } },
  ]);
  assert.equal(calls.uploads.length, 2);
});

test('a storage failure gives null, never an exception: the card then keeps the site link', async () => {
  const errors = test.mock.method(console, 'error', () => {});
  const { db } = fakeStorage({ uploads: [{ data: null, error: { message: 'boom', statusCode: '500' } }] });
  assert.equal(await storePlanPicture(db, 'k7m2qx9dab', BYTES), null);
  assert.equal(await storePlanPicture({}, 'k7m2qx9dab', BYTES), null, 'no storage at all');
  errors.mock.restore();
});

test('expired codes lose their stored picture, best effort', async () => {
  const { db, calls } = fakeStorage();
  await removePlanPictures(db, ['k7m2qx9dab', 'abcdefghjk']);
  assert.deepEqual(calls.removes, [{ bucket: 'whatsapp-plans', paths: ['k7m2qx9dab.jpg', 'abcdefghjk.jpg'] }]);
  await removePlanPictures(db, []);
  assert.equal(calls.removes.length, 1, 'nothing to remove: no call');
  await removePlanPictures({}, ['k7m2qx9dab']);
});

test('the code of a plan picture link', () => {
  assert.equal(planCodeFromImageUrl('https://qatlia.ma/w/k7m2qx9dab/plan.jpg'), 'k7m2qx9dab');
  assert.equal(planCodeFromImageUrl('https://qatlia.ma/whatsapp/exemple-fiche.jpg'), null);
});
