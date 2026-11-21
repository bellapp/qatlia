/**
 * qatlia.ma/w/<code>/plan.png: the picture of a read cut list's plan (first
 * panel, no measure), sent by the WhatsApp bot with the link and shown in the
 * link's preview. Same code and same 24 h as the link (src/lib/whatsapp/photo-link.ts).
 *
 * Fetching it never counts as opening the link: WhatsApp and YCloud download
 * it, not the prospect. The PNG gets an sRGB profile, which YCloud requires.
 */

import { ImageResponse } from 'next/og';
import { getAdminDb } from '@/lib/admin/db';
import { withSrgbProfile } from '@/lib/png-srgb';
import { isPhotoCode } from '@/lib/whatsapp/photo-link';
import { openPhotoDraft } from '@/lib/whatsapp/photo-store';
import { previewPlanFor } from '@/lib/whatsapp/photo-summary';
import { planImageLayout } from '@/lib/whatsapp/plan-image';
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
    const png = withSrgbProfile(new Uint8Array(await rendered.arrayBuffer()));
    const body = new ArrayBuffer(png.byteLength);
    new Uint8Array(body).set(png);
    return new Response(body, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'Content-Length': String(png.length) },
    });
  } catch (error) {
    console.error('[whatsapp] plan picture failed', error instanceof Error ? error.message : 'unknown error');
    return new Response('Unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
