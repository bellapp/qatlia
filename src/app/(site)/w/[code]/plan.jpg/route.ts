/**
 * qatlia.ma/w/<code>/plan.jpg: the plan picture the WhatsApp bot sends, the
 * same drawing as plan.png made a JPEG with the sRGB profile
 * (src/lib/jpeg-srgb.ts). WhatsApp never delivered the PNG, as a card's
 * header ("(#131053) Media upload error") or alone, while the example JPEG
 * goes through (21/11/2026).
 *
 * The CDN keeps it an hour (PICTURE_CACHE): drawing it is slow. Fetching it
 * never counts as opening the link: WhatsApp and YCloud download it, not the
 * prospect.
 */

import { ImageResponse } from 'next/og';
import { getAdminDb } from '@/lib/admin/db';
import { pngToJpeg } from '@/lib/jpeg-srgb';
import { isPhotoCode } from '@/lib/whatsapp/photo-link';
import { openPhotoDraft } from '@/lib/whatsapp/photo-store';
import { previewPlanFor } from '@/lib/whatsapp/photo-summary';
import { PICTURE_CACHE, planImageLayout } from '@/lib/whatsapp/plan-image';
import { PlanImage } from '@/lib/whatsapp/plan-image-view';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

export async function GET(_request: Request, { params }: { params: { code: string } }): Promise<Response> {
  if (!isPhotoCode(params.code)) return notFound();
  const db = getAdminDb();
  if (!db) return notFound();

  try {
    const draft = await openPhotoDraft(db, params.code, new Date(), { markOpened: false });
    if (!draft || draft === 'expired') return notFound();
    // None for a list over BOT_PLAN_MAX_PIECES: too long to plan in a request.
    const plan = previewPlanFor(draft);
    const layout = plan ? planImageLayout(plan) : null;
    if (!layout) return notFound();

    const rendered = new ImageResponse(PlanImage({ layout }), { width: layout.width, height: layout.height });
    const jpg = pngToJpeg(new Uint8Array(await rendered.arrayBuffer()));
    const body = new ArrayBuffer(jpg.byteLength);
    new Uint8Array(body).set(jpg);
    return new Response(body, {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': PICTURE_CACHE, 'Content-Length': String(jpg.length) },
    });
  } catch (error) {
    console.error('[whatsapp] plan picture (jpeg) failed', error instanceof Error ? error.message : 'unknown error');
    return new Response('Unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
