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
import { COPY, EXAMPLE_FICHE_URL, type Lang, type MenuButton } from '@/lib/whatsapp/copy';
import { HANDOFF_HOURS, decide, detectLang, resolveLang, type Decision } from '@/lib/whatsapp/router';
import { assistantBudgetMs, hearVoice } from '@/lib/whatsapp/voice';
import { HISTORY_MESSAGES, askAssistant } from '@/lib/whatsapp/assistant';
import { sendButtons, sendImage, sendText } from '@/lib/whatsapp/send';
import { handlePhoto, type PhotoMessageKind } from '@/lib/whatsapp/photo';
import {
  SEND_FAILED_KIND,
  WhatsAppTablesMissingError,
  claimGreeting,
  claimInbound,
  countAssistantReplies,
  countBotMessages,
  countInboundMessages,
  recentHistory,
  recordOutbound,
  releaseGreeting,
  setInboundBody,
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

/**
 * Sends one text (with reply buttons when given) and logs it. Returns false when the send failed;
 * the failure is then logged as a `send_failed` row, so a prospect left without an answer shows up
 * in the database (the platform logs are kept only for minutes).
 */
async function deliver(
  db: SupabaseClient,
  config: WhatsAppConfig,
  waId: string,
  body: string,
  kind: 'fixed' | 'assistant' | 'image_hint' | PhotoMessageKind,
  buttons?: readonly MenuButton[],
): Promise<boolean> {
  const wamid = buttons ? await sendButtons(config, waId, body, buttons) : await sendText(config, waId, body);
  if (wamid === null) {
    try {
      await recordOutbound(db, { waId, wamid: null, direction: 'bot', kind: SEND_FAILED_KIND, body });
    } catch (error) {
      // Recording is a diagnostic: it must not stop the caller from trying its plain-text fallback.
      console.error('[whatsapp] could not record a failed send', describeError(error));
    }
    return false;
  }
  await recordOutbound(db, { waId, wamid, direction: 'bot', kind, body });
  return true;
}

/**
 * The example cut list after the greeting. Best effort: the greeting is out and
 * the contact greeted, so a failure is only logged, never thrown.
 */
async function deliverExample(db: SupabaseClient, config: WhatsAppConfig, waId: string, caption: string): Promise<void> {
  try {
    const wamid = await sendImage(config, waId, EXAMPLE_FICHE_URL, caption);
    await recordOutbound(db, { waId, wamid, direction: 'bot', kind: wamid === null ? SEND_FAILED_KIND : 'example', body: caption });
  } catch (error) {
    console.error('[whatsapp] could not send the example cut list', describeError(error));
  }
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

/**
 * A photo: read as a cut list when the reading can (src/lib/whatsapp/photo.ts),
 * otherwise today's hint pointing to the atelier, once per cooldown window.
 * Either way the contact counts as greeted: a menu right after would bury the
 * answer.
 */
async function handlePhotoMessage(
  db: SupabaseClient,
  config: WhatsAppConfig,
  event: InboundEvent,
  contact: { greetedAt: Date | null },
  lang: Lang,
  now: Date,
): Promise<void> {
  const { waId } = event;
  const outcome = await handlePhoto({
    db,
    config,
    event,
    lang,
    now,
    deliver: (text, kind) => deliver(db, config, waId, text, kind),
  });
  if (outcome === 'silent') return;
  if (outcome === 'hint') {
    const since = new Date(now.getTime() - IMAGE_HINT_COOLDOWN_MINUTES * 60 * 1000);
    if ((await countBotMessages(db, waId, 'image_hint', since)) > 0) return;
    if (!(await deliver(db, config, waId, COPY.imageHint[lang], 'image_hint'))) return;
  }
  if (contact.greetedAt === null) await updateContact(db, waId, { greetedAt: now });
}

async function handleInbound(db: SupabaseClient, config: WhatsAppConfig, event: InboundEvent): Promise<void> {
  const now = new Date();
  const { waId } = event;

  let contact = await upsertContact(db, { waId, profileName: event.profileName, referral: event.referral });
  const claimed = await claimInbound(db, { wamid: event.wamid, waId, kind: event.kind, body: event.text });
  if (!claimed) return; // Meta redelivered a message that was already handled.

  // A pre-filled ad message follows the phone's language, not the person's: see resolveLang.
  const lang = resolveLang(event, contact);
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
    decide({
      event,
      contact: state,
      now,
      assistantRepliesLast24h,
      handoffMode: config.handoffMode,
      // Without a key nothing can be heard: the old "write to me" reply.
      voiceEnabled: config.voiceEnabled && config.openrouterKey !== null,
    });
  let decision = decideFor(contact);

  // Meta delivers a burst concurrently: only the delivery that wins the conditional write greets.
  let greetingClaimed = false;
  if (decision.action === 'send' && decision.greeting === true) {
    if (await claimGreeting(db, waId, now)) {
      greetingClaimed = true;
    } else {
      decision = decideFor({ ...contact, greetedAt: now });
    }
  }

  if (decision.action === 'silent') return;

  if (decision.action === 'photo') {
    await handlePhotoMessage(db, config, event, contact, lang, now);
    return;
  }

  if (decision.action === 'send') {
    const kind = 'fixed';
    // A message with buttons that cannot be sent falls back to its plain-text version, so the contact still gets an answer.
    const sent = decision.menu
      ? (await deliver(db, config, waId, decision.text, kind, decision.menu.buttons)) ||
        (await deliver(db, config, waId, decision.menu.fallbackText, kind))
      : await deliver(db, config, waId, decision.text, kind);
    if (!sent) {
      if (greetingClaimed) await releaseGreeting(db, waId, now);
      return;
    }
    const patch: { greetedAt?: Date; handoffUntil?: Date } = {};
    if (decision.markGreeted && !greetingClaimed) patch.greetedAt = now;
    if (decision.handoff) patch.handoffUntil = handoffDeadline(now);
    if (Object.keys(patch).length > 0) await updateContact(db, waId, patch);
    if (decision.exampleCaption) await deliverExample(db, config, waId, decision.exampleCaption);
    return;
  }

  if (decision.action === 'voice') {
    await handleVoiceMessage(db, config, event, contact.lang, now);
    return;
  }

  // decision.action === 'assistant'
  await answerWithAssistant(db, config, { waId, wamid: event.wamid, message: event.text ?? '', lang, now });
}

/**
 * A voice note: heard (src/lib/whatsapp/voice.ts), its transcript is stored as
 * the text of the inbound message and answered exactly like a typed one, in
 * the language it was said in. Not heard: the "write it" reply, with the same
 * hand-off to the advisor as any media the bot cannot read.
 */
async function handleVoiceMessage(
  db: SupabaseClient,
  config: WhatsAppConfig,
  event: InboundEvent,
  storedLang: Lang,
  now: Date,
): Promise<void> {
  const { waId } = event;
  const heard = await hearVoice({
    config,
    event,
    now,
    countVoices: (since) => countInboundMessages(db, waId, 'audio', since),
  });

  if (heard.status === 'unheard') {
    const redirect = config.handoffMode === 'redirect';
    const text = redirect ? `${COPY.voiceUnclear[storedLang]}\n\n${COPY.redirect[storedLang]}` : COPY.voiceUnclear[storedLang];
    if (!(await deliver(db, config, waId, text, 'fixed'))) return;
    if (!redirect) await updateContact(db, waId, { handoffUntil: handoffDeadline(now) });
    return;
  }

  // Both writes help later answers; neither may cost this one.
  try {
    await setInboundBody(db, event.wamid, heard.text);
  } catch (error) {
    console.error('[whatsapp] voice: could not store the transcript', describeError(error));
  }
  const lang = detectLang(heard.text, storedLang);
  if (lang !== storedLang) {
    try {
      await updateContact(db, waId, { lang });
    } catch (error) {
      console.error('[whatsapp] voice: could not store the language', describeError(error));
    }
  }
  await answerWithAssistant(db, config, {
    waId,
    wamid: event.wamid,
    message: heard.text,
    lang,
    now,
    // Whatever hearing took comes off the assistant's time (60 s route budget).
    timeoutMs: assistantBudgetMs(Date.now() - now.getTime()),
  });
}

/** The assistant's answer to a free-text question (typed, or a transcribed voice note). */
async function answerWithAssistant(
  db: SupabaseClient,
  config: WhatsAppConfig,
  input: {
    waId: string;
    wamid: string;
    message: string;
    lang: Lang;
    now: Date;
    /** Omitted: the assistant's own deadline. `null`: no time left, the fallback goes out. */
    timeoutMs?: number | null;
  },
): Promise<void> {
  const { waId, lang, now } = input;
  const redirect = config.handoffMode === 'redirect';
  const history = await recentHistory(db, waId, HISTORY_MESSAGES, input.wamid);
  const answer =
    config.openrouterKey && input.timeoutMs !== null
      ? await askAssistant({
          history,
          message: input.message,
          model: config.model,
          apiKey: config.openrouterKey,
          handoffMode: config.handoffMode,
          ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
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
        console.error('[whatsapp] migration 016 non appliquée');
        break;
      }
      console.error('[whatsapp] event failed', describeError(error));
    }
  }

  return ok();
}
