/**
 * WhatsApp Cloud API webhook.
 *
 * GET answers Meta's verification handshake. POST receives message events:
 * the signature is checked on the raw body, then each event is handled on its
 * own (inbound message -> fixed reply or assistant, echo -> human takes over).
 *
 * Once the signature is valid this route always answers 200, whatever goes
 * wrong: Meta retries on any other status and would flood the endpoint.
 * Nothing sensitive (token, secret, body, message text, phone numbers) is logged.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminConfig } from '@/lib/billing/config';
import { getWhatsAppConfig, type WhatsAppConfig } from '@/lib/whatsapp/config';
import { verifySignature } from '@/lib/whatsapp/signature';
import { parseWebhook, type EchoEvent, type InboundEvent } from '@/lib/whatsapp/payload';
import { COPY } from '@/lib/whatsapp/copy';
import { HANDOFF_HOURS, decide, detectLang, type Decision } from '@/lib/whatsapp/router';
import { HISTORY_MESSAGES, askAssistant } from '@/lib/whatsapp/assistant';
import { sendText } from '@/lib/whatsapp/send';
import {
  WhatsAppTablesMissingError,
  claimGreeting,
  claimInbound,
  countAssistantReplies,
  countBotMessages,
  recentHistory,
  recordOutbound,
  releaseGreeting,
  updateContact,
  upsertContact,
} from '@/lib/whatsapp/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** One fixed "send us a photo in the app" hint per contact in this window, however many photos they send. */
const IMAGE_HINT_COOLDOWN_MINUTES = 10;

const ok = () => new Response('ok', { status: 200 });

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
}

function handoffDeadline(now: Date): Date {
  return new Date(now.getTime() + HANDOFF_HOURS * HOUR_MS);
}

/** Sends one text and logs it. Returns false (and records nothing) when the send failed. */
async function deliver(
  db: SupabaseClient,
  config: WhatsAppConfig,
  waId: string,
  body: string,
  kind: 'fixed' | 'assistant' | 'image_hint',
): Promise<boolean> {
  const wamid = await sendText(config, waId, body);
  if (wamid === null) return false;
  await recordOutbound(db, { waId, wamid, direction: 'bot', kind, body });
  return true;
}

/** A message the business sent from the phone itself: log it, and in coexistence mode let the human lead. */
async function handleEcho(db: SupabaseClient, config: WhatsAppConfig, event: EchoEvent): Promise<void> {
  const now = new Date();
  // whatsapp_messages.wa_id references the contact, so the row must exist first.
  await upsertContact(db, { waId: event.waId, profileName: null, referral: null });
  const recorded = await recordOutbound(db, {
    waId: event.waId,
    wamid: event.wamid,
    direction: 'human',
    kind: 'echo',
    body: event.text,
  });
  // A redelivered echo, or the echo of a message the bot sent itself (its wamid is already stored),
  // is not a human taking over.
  if (recorded && config.handoffMode === 'coexistence') {
    await updateContact(db, event.waId, { handoffUntil: handoffDeadline(now) });
  }
}

async function handleInbound(db: SupabaseClient, config: WhatsAppConfig, event: InboundEvent): Promise<void> {
  const now = new Date();
  const { waId } = event;

  let contact = await upsertContact(db, { waId, profileName: event.profileName, referral: event.referral });
  const claimed = await claimInbound(db, { wamid: event.wamid, waId, kind: event.kind, body: event.text });
  if (!claimed) return; // Meta redelivered a message that was already handled.

  const lang = detectLang(event.text, contact.lang);
  if (lang !== contact.lang) {
    await updateContact(db, waId, { lang });
    contact = { ...contact, lang };
  }

  // In coexistence the bot shares the support line with the owner: by default it only answers
  // people who came from the ad, so existing customers keep getting the owner only.
  if (config.handoffMode === 'coexistence' && config.scope === 'ads' && !contact.fromAd) return;

  if (!config.enabled) return;

  const assistantRepliesLast24h = await countAssistantReplies(db, waId, new Date(now.getTime() - DAY_MS));
  const decideFor = (state: typeof contact): Decision =>
    decide({ event, contact: state, now, assistantRepliesLast24h, handoffMode: config.handoffMode });
  let decision = decideFor(contact);

  // Meta delivers a burst concurrently: only the delivery that wins the conditional write greets.
  let greetingClaimed = false;
  if (decision.action === 'send' && decision.text === COPY.greeting) {
    if (await claimGreeting(db, waId, now)) {
      greetingClaimed = true;
    } else {
      decision = decideFor({ ...contact, greetedAt: now });
    }
  }

  if (decision.action === 'silent') return;

  if (decision.action === 'send') {
    const isImageHint = event.kind === 'image' && decision.text === COPY.imageHint[lang];
    if (isImageHint) {
      const since = new Date(now.getTime() - IMAGE_HINT_COOLDOWN_MINUTES * 60 * 1000);
      if ((await countBotMessages(db, waId, 'image_hint', since)) > 0) return;
    }
    if (!(await deliver(db, config, waId, decision.text, isImageHint ? 'image_hint' : 'fixed'))) {
      if (greetingClaimed) await releaseGreeting(db, waId, now);
      return;
    }
    const patch: { greetedAt?: Date; handoffUntil?: Date } = {};
    if (decision.markGreeted && !greetingClaimed) patch.greetedAt = now;
    if (decision.handoff) patch.handoffUntil = handoffDeadline(now);
    if (Object.keys(patch).length > 0) await updateContact(db, waId, patch);
    return;
  }

  // decision.action === 'assistant'
  const redirect = config.handoffMode === 'redirect';
  const history = await recentHistory(db, waId, HISTORY_MESSAGES, event.wamid);
  const answer = config.openrouterKey
    ? await askAssistant({
        history,
        message: event.text ?? '',
        model: config.model,
        apiKey: config.openrouterKey,
        handoffMode: config.handoffMode,
      })
    : null;

  if (!answer) {
    const text = redirect ? `${COPY.fallback[lang]}\n\n${COPY.redirect[lang]}` : COPY.fallback[lang];
    if (!(await deliver(db, config, waId, text, 'fixed'))) return;
    if (!redirect) await updateContact(db, waId, { handoffUntil: handoffDeadline(now) });
    return;
  }

  if (!(await deliver(db, config, waId, answer.reply, 'assistant'))) return;
  if (!answer.handoff) return;
  if (redirect) {
    await deliver(db, config, waId, COPY.redirect[lang], 'fixed');
  } else {
    await updateContact(db, waId, { handoffUntil: handoffDeadline(now) });
  }
}

export async function GET(request: Request): Promise<Response> {
  const config = getWhatsAppConfig();
  if (!config) {
    console.error('[whatsapp] configuration absente');
    return new Response('Not found', { status: 404 });
  }

  const params = new URL(request.url).searchParams;
  const challenge = params.get('hub.challenge');
  if (params.get('hub.mode') === 'subscribe' && params.get('hub.verify_token') === config.verifyToken && challenge !== null) {
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return new Response('Forbidden', { status: 403 });
}

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();

  const config = getWhatsAppConfig();
  if (!config) {
    console.error('[whatsapp] configuration absente');
    return ok();
  }

  if (!verifySignature(rawBody, request.headers.get('x-hub-signature-256'), config.appSecret)) {
    return new Response('Invalid signature', { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return ok();
  }

  const events = parseWebhook(body, config.phoneNumberId);
  if (events.length === 0) return ok();

  const adminConfig = getSupabaseAdminConfig(process.env);
  if (!adminConfig) {
    console.error('[whatsapp] supabase admin non configuré');
    return ok();
  }
  const db = createClient(adminConfig.url, adminConfig.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const event of events) {
    try {
      if (event.type === 'echo') await handleEcho(db, config, event);
      else await handleInbound(db, config, event);
    } catch (error) {
      if (error instanceof WhatsAppTablesMissingError) {
        console.error('[whatsapp] migration 015 non appliquée');
        break;
      }
      console.error('[whatsapp] event failed', describeError(error));
    }
  }

  return ok();
}
