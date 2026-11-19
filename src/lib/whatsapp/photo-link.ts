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

/**
 * WhatsApp, Facebook and other apps fetch a link to build its preview as soon
 * as the message arrives: that fetch is not a prospect opening the link.
 */
const LINK_PREVIEW_AGENT = /whatsapp|facebookexternalhit|facebot|bot\b|crawler|spider|preview/i;

export function isLinkPreviewAgent(userAgent: string | null | undefined): boolean {
  return typeof userAgent === 'string' && LINK_PREVIEW_AGENT.test(userAgent);
}

export async function loadPhotoLink(code: unknown, userAgent: string | null = null): Promise<PhotoDraft | null> {
  if (!isPhotoCode(code)) return null;
  const db = getAdminDb();
  if (!db) return null;
  try {
    const draft = await openPhotoDraft(db, code, new Date(), { markOpened: !isLinkPreviewAgent(userAgent) });
    return draft && draft !== 'expired' ? draft : null;
  } catch (error) {
    console.error('[whatsapp] photo link failed', error instanceof Error ? error.message : 'unknown error');
    return null;
  }
}
