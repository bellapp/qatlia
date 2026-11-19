/**
 * The link the WhatsApp bot sends after reading a photo: qatlia.ma/w/<code>.
 * Server-only (service role). Anything but a valid, unexpired code reads as
 * null, and the page shows "link expired" with a way to the atelier.
 */

import { getAdminDb } from '@/lib/admin/db';
import { openPhotoDraft, type PhotoDraft } from '@/lib/whatsapp/photo-store';

/** Same alphabet and length as newPhotoCode (photo-store.ts). */
const PHOTO_CODE = /^[abcdefghijkmnpqrstuvwxyz23456789]{10}$/;

export function isPhotoCode(code: unknown): code is string {
  return typeof code === 'string' && PHOTO_CODE.test(code);
}

export async function loadPhotoLink(code: unknown): Promise<PhotoDraft | null> {
  if (!isPhotoCode(code)) return null;
  const db = getAdminDb();
  if (!db) return null;
  try {
    const draft = await openPhotoDraft(db, code, new Date());
    return draft && draft !== 'expired' ? draft : null;
  } catch (error) {
    console.error('[whatsapp] photo link failed', error instanceof Error ? error.message : 'unknown error');
    return null;
  }
}
