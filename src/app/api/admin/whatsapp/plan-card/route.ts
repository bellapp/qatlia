import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeAdminRequest } from '@/lib/admin/auth';
import { getAdminDb } from '@/lib/admin/db';
import { getWhatsAppConfig } from '@/lib/whatsapp/config';
import { isPhotoCode } from '@/lib/whatsapp/photo-link';
import { photoLink } from '@/lib/whatsapp/photo-summary';
import { planImageUrl } from '@/lib/whatsapp/plan-image';
import { sendImage, sendPlanCard } from '@/lib/whatsapp/send';
import { recordOutbound } from '@/lib/whatsapp/store';

export const dynamic = 'force-dynamic';

/**
 * Sends the plan card of a read cut list by hand: the plan picture with a
 * button to its link (src/lib/whatsapp/send.ts, sendPlanCard). For a prospect
 * the bot answered before the card existed, or whose photo it missed (the
 * owner reads the sheet, stores the read, then sends the result). The admin
 * writes the text; the picture and the link come from the code.
 *
 * `to` sends the card to another number (a test on the owner's phone); by
 * default it goes to the number that sent the sheet. Never for an expired
 * link: the button would open nothing. WhatsApp only delivers it within 24 h
 * of that number's last message.
 */

const CardSchema = z.object({
  code: z.string(),
  body: z.string().trim().min(1).max(1024),
  button: z.string().trim().min(1).max(20).default('شوف المخطط كامل'),
  to: z.string().regex(/^\d{8,15}$/).optional(),
  // WhatsApp refused the plan picture of the first card ("(#131053) Media
  // upload error", 21/11/2026): another picture of the site to try in its
  // place, and the bare picture with the link in its caption as a way round.
  image: z.string().startsWith('https://qatlia.ma/').max(300).optional(),
  as: z.enum(['card', 'image']).default('card'),
});

export async function POST(req: Request) {
  const authorization = await authorizeAdminRequest(req);
  if (!authorization.ok) return authorization.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_DATA' }, { status: 400 });
  }
  const parsed = CardSchema.safeParse(raw);
  if (!parsed.success || !isPhotoCode(parsed.data.code)) {
    return NextResponse.json({ error: 'INVALID_DATA' }, { status: 400 });
  }
  const { code, body, button, to, as } = parsed.data;

  const db = getAdminDb();
  const config = getWhatsAppConfig();
  if (!db || !config) return NextResponse.json({ error: 'NOT_CONFIGURED' }, { status: 503 });

  const found = await db.from('whatsapp_photo_reads').select('wa_id, expires_at, pieces').eq('code', code).maybeSingle();
  if (found.error) {
    console.error('[admin] plan card: read lookup failed', found.error.message);
    return NextResponse.json({ error: 'DB_ERROR' }, { status: 500 });
  }
  const read = found.data as { wa_id: string; expires_at: string | null; pieces: unknown } | null;
  if (!read) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (!read.expires_at || Date.parse(read.expires_at) <= Date.now() || !Array.isArray(read.pieces)) {
    return NextResponse.json({ error: 'expired' }, { status: 410 });
  }

  // Draw the picture first, so the CDN holds it when WhatsApp downloads it
  // (PICTURE_CACHE): fetched cold, it took too long and WhatsApp gave up.
  const image = parsed.data.image ?? planImageUrl(code);
  try {
    const check = await fetch(image, { signal: AbortSignal.timeout(20_000) });
    await check.arrayBuffer();
    if (!check.ok) return NextResponse.json({ error: 'PICTURE_NOT_DRAWN' }, { status: 502 });
  } catch {
    return NextResponse.json({ error: 'PICTURE_NOT_DRAWN' }, { status: 502 });
  }

  const waId = to ?? read.wa_id;
  const url = photoLink(code);
  const wamid = as === 'image'
    ? await sendImage(config, waId, image, `${body}\n${url}`)
    : await sendPlanCard(config, waId, { image, body, button, url });
  if (wamid === null) return NextResponse.json({ error: 'SEND_FAILED' }, { status: 502 });

  // Logged like the bot's own answers, on the number that sent the sheet only.
  if (waId === read.wa_id) {
    await recordOutbound(db, { waId, wamid, direction: 'bot', kind: as === 'image' ? 'photo_result' : 'photo_result_card', body });
  }
  return NextResponse.json({ ok: true, wamid });
}
