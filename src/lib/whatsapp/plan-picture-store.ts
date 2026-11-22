/**
 * The plan picture kept as a file for WhatsApp to fetch.
 *
 * A big list's picture takes 7 to 10 s to draw at /w/<code>/plan.jpg, and
 * WhatsApp gave up on the card ("(#131053) Media upload error", 351 pieces,
 * 21/11/2026), while static files go through at once. The webhook already
 * downloads the picture once to check it: those bytes are stored in a public
 * Supabase Storage bucket, made on first use, and the card points at that file
 * (owner's go, 22/11/2026). The file goes with the read when it expires.
 *
 * Never throws: a failure gives null and the card keeps the site's link.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const PLAN_PICTURE_BUCKET = 'whatsapp-plans';

type StorageOwner = Pick<SupabaseClient, 'storage'> | Record<string, unknown>;
type StorageError = { message?: string; statusCode?: string | number } | null;

const fileOf = (code: string) => `${code}.jpg`;

function bucketMissing(error: StorageError): boolean {
  return !!error && (String(error.statusCode) === '404' || /bucket not found/i.test(error.message ?? ''));
}

/** Stores `bytes` (a JPEG) as <code>.jpg; its public link, or null. */
export async function storePlanPicture(db: StorageOwner, code: string, bytes: Uint8Array): Promise<string | null> {
  const storage = (db as Partial<SupabaseClient>).storage;
  if (!storage) return null;
  try {
    const bucket = storage.from(PLAN_PICTURE_BUCKET);
    const upload = () => bucket.upload(fileOf(code), bytes, { contentType: 'image/jpeg', upsert: true, cacheControl: '86400' });
    let { error } = await upload();
    if (bucketMissing(error as StorageError)) {
      const created = await storage.createBucket(PLAN_PICTURE_BUCKET, {
        public: true,
        fileSizeLimit: 5 * 1024 * 1024,
        allowedMimeTypes: ['image/jpeg'],
      });
      if (created.error) console.error('[whatsapp] plan picture bucket not created', created.error.message);
      ({ error } = await upload());
    }
    if (error) {
      console.error('[whatsapp] plan picture not stored', (error as StorageError)?.message ?? 'unknown error');
      return null;
    }
    return bucket.getPublicUrl(fileOf(code)).data.publicUrl || null;
  } catch (error) {
    console.error('[whatsapp] plan picture not stored', error instanceof Error ? error.message : 'unknown error');
    return null;
  }
}

/** Removes the stored pictures of these codes; a failure is only logged. */
export async function removePlanPictures(db: StorageOwner, codes: string[]): Promise<void> {
  const storage = (db as Partial<SupabaseClient>).storage;
  if (!storage || codes.length === 0) return;
  try {
    const { error } = await storage.from(PLAN_PICTURE_BUCKET).remove(codes.map(fileOf));
    if (error) console.error('[whatsapp] plan pictures not removed', error.message);
  } catch (error) {
    console.error('[whatsapp] plan pictures not removed', error instanceof Error ? error.message : 'unknown error');
  }
}
