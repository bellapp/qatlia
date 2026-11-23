import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeAdminRequest } from '@/lib/admin/auth';
import { getAdminDb } from '@/lib/admin/db';
import { getWhatsAppConfig } from '@/lib/whatsapp/config';
import { isBusinessScopedId, sendText } from '@/lib/whatsapp/send';
import { claimGreeting, recordOutbound, upsertContact } from '@/lib/whatsapp/store';

export const dynamic = 'force-dynamic';

/**
 * A text the owner writes to a prospect, sent through the bot's number
 * (22/11/2026): to a phone number, or to a business-scoped id ("MA.1163…", a
 * user with a WhatsApp username and no phone number). Admin only; logged in
 * whatsapp_messages as the owner's ('human'), so the assistant sees it in
 * the history. WhatsApp only delivers it within 24 h of the person's last message.
 */

const TextSchema = z.object({
  to: z.string().trim(),
  body: z.string().trim().min(1).max(1024),
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
  const parsed = TextSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_DATA' }, { status: 400 });
  const { to, body } = parsed.data;
  if (!/^\d{8,15}$/.test(to) && !isBusinessScopedId(to)) {
    return NextResponse.json({ error: 'INVALID_RECIPIENT' }, { status: 400 });
  }

  const db = getAdminDb();
  const config = getWhatsAppConfig();
  if (!db || !config) return NextResponse.json({ error: 'NOT_CONFIGURED' }, { status: 503 });

  const wamid = await sendText(config, to, body);
  if (wamid === null) return NextResponse.json({ error: 'SEND_FAILED' }, { status: 502 });

  try {
    // whatsapp_messages.wa_id references the contact.
    await upsertContact(db, { waId: to, profileName: null, referral: null });
    await recordOutbound(db, { waId: to, wamid, direction: 'human', kind: 'admin_text', body });
    // The owner's text greets: the next message gets an answer, not the greeting (22/11/2026).
    await claimGreeting(db, to, new Date());
  } catch (error) {
    console.error('[admin] text sent but not logged', error instanceof Error ? error.message : 'unknown error');
  }
  return NextResponse.json({ ok: true, wamid });
}
