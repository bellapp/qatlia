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
import {
  HANDOFF_HOURS,
  decide,
  detectLang,
  looksLikeMeasurements,
  resolveLang,
  typedBeyondPrefill,
  type Decision,
} from '@/lib/whatsapp/router';
import { withSiteReferral } from '@/lib/whatsapp/site-contact';
import { assistantBudgetMs, hearVoice } from '@/lib/whatsapp/voice';
import { waitForPhotoRead } from '@/lib/whatsapp/read-wait';
import { HISTORY_MESSAGES, askAssistant, type HistoryItem, type PhotoReadNote } from '@/lib/whatsapp/assistant';
import { handleTypedList } from '@/lib/whatsapp/typed-list';
import { latestPhotoRead } from '@/lib/whatsapp/photo-store';
import { photoLink } from '@/lib/whatsapp/photo-summary';
import { sendButtons, sendImage, sendPlanCard, sendText, type PlanCard } from '@/lib/whatsapp/send';
import { handlePhoto, type PhotoMessageKind } from '@/lib/whatsapp/photo';
import { pictureCheckMs, planCodeFromImageUrl } from '@/lib/whatsapp/plan-image';
import { storePlanPicture } from '@/lib/whatsapp/plan-picture-store';
import {
  SEND_FAILED_KIND,
  WhatsAppTablesMissingError,
  claimGreeting,
  claimInbound,
  countAssistantReplies,
  countBotMessages,
  countInboundMessages,
  inboundAfter,
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

/**
 * A message carrying the advisor's number (redirect mode). The assistant gives
 * it at most once per ADVISOR_LINK_WINDOW_HOURS: it gave it seven times in 13
 * minutes to « بسم الله » (23/11/2026). An explicit ask (button 3) always gets it.
 */
const ADVISOR_LINK_KIND = 'redirect';
const ADVISOR_LINK_WINDOW_HOURS = 24;

const ok = () => new Response('ok', { status: 200 });

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Whether a message the contact sent gets an answer of its own: a typed text
 * (not the ad's pre-filled one), a photo, a voice note. Reactions, stickers
 * and the pre-filled text get none, so they never take an answer over.
 */
function answersItself(row: { kind: string; body: string | null }): boolean {
  if (row.kind === 'image' || row.kind === 'audio') return true;
  if (row.kind !== 'text' || !row.body) return false;
  return typedBeyondPrefill(row.body) !== '';
}

/**
 * A newer message from the contact will be answered, with this one in its
 * history: this one stays unanswered (two near-identical answers to
 * « هدا دابا ديبيتاج » + « ياك », 22/11/2026). A failing check answers anyway.
 */
async function overtaken(db: SupabaseClient, waId: string, wamid: string): Promise<boolean> {
  try {
    return (await inboundAfter(db, waId, wamid)).some(answersItself);
  } catch (error) {
    console.error('[whatsapp] newer message check failed', describeError(error));
    return false;
  }
}

/** At most this many of the person's messages, sent just before this one, are read with it. */
const TYPED_MESSAGES_MAX = 6;

/**
 * This message after the ones the person sent just before it, with no answer
 * in between: a carpenter gives his doors one message at a time (21/11/2026).
 */
function typedMeasurements(history: HistoryItem[], message: string): string {
  const before: string[] = [];
  for (let i = history.length - 1; i >= 0 && before.length < TYPED_MESSAGES_MAX - 1; i--) {
    const item = history[i];
    if (item.direction !== 'user') break;
    if (item.body !== '📷 photo') before.unshift(item.body);
  }
  return [...before, message].join('\n');
}

/** Redirect mode: whether the advisor's number already went to this contact lately. Unknown counts as no. */
async function advisorLinkSentLately(db: SupabaseClient, waId: string, now: Date): Promise<boolean> {
  try {
    const since = new Date(now.getTime() - ADVISOR_LINK_WINDOW_HOURS * HOUR_MS);
    return (await countBotMessages(db, waId, ADVISOR_LINK_KIND, since)) > 0;
  } catch (error) {
    console.error('[whatsapp] advisor link lookup failed', describeError(error));
    return false;
  }
}

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
  kind: 'fixed' | 'assistant' | 'image_hint' | typeof ADVISOR_LINK_KIND | PhotoMessageKind,
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

/**
 * The plan picture by link (src/app/(site)/w/[code]/plan.png). YCloud accepts the
 * message first and downloads the link afterwards, so a picture the site cannot
 * draw would leave the prospect with nothing: it is fetched here first. False
 * (not drawn, refused, or too late in the webhook's 60 s: pictureCheckMs) lets
 * the photo flow send its text answer instead.
 */
async function deliverPicture(
  db: SupabaseClient,
  config: WhatsAppConfig,
  waId: string,
  link: string,
  // The bare picture's caption: unused since a refused card lets the text go.
  _caption: string,
  kind: PhotoMessageKind,
  startedAt: Date,
  card: PlanCard,
): Promise<boolean> {
  const checkMs = pictureCheckMs(Date.now() - startedAt.getTime());
  if (checkMs === null) {
    console.log('[whatsapp] plan picture skipped: too late, the text answer goes');
    return false;
  }
  let bytes: Uint8Array;
  try {
    const check = await fetch(link, { signal: AbortSignal.timeout(checkMs) });
    const type = check.headers.get('content-type') ?? '';
    bytes = new Uint8Array(await check.arrayBuffer());
    if (!check.ok || !/^image\/(png|jpeg)/.test(type)) {
      console.error(`[whatsapp] plan picture not drawn (${check.status})`);
      return false;
    }
  } catch (error) {
    console.error('[whatsapp] plan picture check failed', describeError(error));
    return false;
  }

  // The bytes just drawn, kept as a file: WhatsApp fetches it at once, where a
  // big list drawn on the fly made it give up (22/11/2026). Not stored: the
  // card keeps the site's link.
  const code = planCodeFromImageUrl(link);
  const stored = code ? await storePlanPicture(db, code, bytes) : null;
  const sent = stored ? { ...card, image: stored } : card;

  // The picture with its button to the link (owner, 21/11/2026: « l'image cliquable »).
  const cardWamid = await sendPlanCard(config, waId, sent);
  if (cardWamid !== null) {
    await recordOutbound(db, { waId, wamid: cardWamid, direction: 'bot', kind, body: card.body });
    return true;
  }
  // Refused ("(#131053) Media upload error" when WhatsApp could not fetch the
  // picture in time, 21/11/2026): the text answer goes. Not the bare picture:
  // YCloud takes it at once, WhatsApp fails it later, and the text never went.
  console.error('[whatsapp] plan card refused, the text answer goes');
  await recordOutbound(db, { waId, wamid: null, direction: 'bot', kind: SEND_FAILED_KIND, body: card.body });
  return false;
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
    deliverImage: (link, caption, kind, card) => deliverPicture(db, config, waId, link, caption, kind, now, card),
  });
  if (outcome === 'silent') return;
  if (outcome === 'hint') {
    const since = new Date(now.getTime() - IMAGE_HINT_COOLDOWN_MINUTES * 60 * 1000);
    if ((await countBotMessages(db, waId, 'image_hint', since)) > 0) return;
    if (!(await deliver(db, config, waId, COPY.imageHint[lang], 'image_hint'))) return;
  }
  if (contact.greetedAt === null) await updateContact(db, waId, { greetedAt: now });
}

/** `overtakenInBatch`: a later message of this delivery, from the same contact, gets its own answer. */
async function handleInbound(
  db: SupabaseClient,
  config: WhatsAppConfig,
  inboundEvent: InboundEvent,
  overtakenInBatch = false,
): Promise<void> {
  // Written through the site's WhatsApp button: stored and answered like a contact from the ad.
  const event = withSiteReferral(inboundEvent);
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

  // What the assistant answers: a typed text, after a short wait for a message sent right after it.
  const assistantInput = {
    waId,
    wamid: event.wamid,
    message: event.text ?? '',
    lang,
    now,
    settleMs: config.replySettleMs,
    overtakenInBatch,
  };

  if (decision.action === 'send') {
    const kind = decision.advisorLink ? ADVISOR_LINK_KIND : 'fixed';
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
    // A first contact asking something: the greeting, then the answer.
    if (decision.thenAssistant) await answerWithAssistant(db, config, assistantInput);
    return;
  }

  if (decision.action === 'voice') {
    await handleVoiceMessage(db, config, event, contact.lang, now, overtakenInBatch);
    return;
  }

  // decision.action === 'assistant'
  await answerWithAssistant(db, config, assistantInput);
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
  overtakenInBatch: boolean,
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
    if (!(await deliver(db, config, waId, text, redirect ? ADVISOR_LINK_KIND : 'fixed'))) return;
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
    // Hearing took its time already: no extra wait, only the check for a newer message.
    settleMs: 0,
    overtakenInBatch,
    // Whatever hearing took comes off the typed read's and the assistant's time (60 s route budget).
    budgeted: true,
  });
}

/**
 * The sheet this number sent that the bot read, for the assistant (anas,
 * 21/11/2026: it asked again for a sheet it had read). A failing lookup only
 * leaves the note out.
 */
async function photoReadFor(db: SupabaseClient, waId: string, now: Date): Promise<PhotoReadNote | null> {
  try {
    const read = await latestPhotoRead(db, waId, now);
    return read ? { pieceCount: read.pieceCount, link: read.code ? photoLink(read.code) : null } : null;
  } catch (error) {
    console.error('[whatsapp] latest photo read lookup failed', describeError(error));
    return null;
  }
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
    /** Wait this long first, so a message sent right after this one takes the answer over. */
    settleMs: number;
    /** A later message of the same delivery takes the answer over. */
    overtakenInBatch: boolean;
    /**
     * A voice note: the typed read and the assistant only get what is left of
     * the route's time (assistantBudgetMs), measured right before each; with
     * too little left, the typed read is skipped and the fallback goes out.
     * Omitted: their own deadlines.
     */
    budgeted?: boolean;
  },
): Promise<void> {
  const { waId, lang, now } = input;
  if (input.overtakenInBatch) return;
  if (input.settleMs > 0) await sleep(input.settleMs);
  if (await overtaken(db, waId, input.wamid)) return;

  // A photo of this number being read: wait for it, so the assistant knows the
  // sheet was read (photoReadFor below) instead of asking for it again.
  const readWait = await waitForPhotoRead(db, waId, now);
  if (readWait !== 'none' && (await overtaken(db, waId, input.wamid))) return;
  const photoReading = readWait === 'running';

  const history = await recentHistory(db, waId, HISTORY_MESSAGES, input.wamid);

  // Measurements typed (or said) instead of a photo: read like a sheet, the
  // plan card goes out. Nothing read: the assistant answers as before. After
  // a wait, the time left is counted as for a voice note.
  const budgeted = input.budgeted || readWait !== 'none';
  const timeLeft = (): number | null | undefined =>
    budgeted ? assistantBudgetMs(Date.now() - now.getTime()) : undefined;

  const typed = typedMeasurements(history, input.message);
  // A photo still being read holds the number's read: the typed read would only stay silent.
  const readTimeoutMs = !photoReading && looksLikeMeasurements(typed) ? timeLeft() : null;
  if (readTimeoutMs !== null) {
    const outcome = await handleTypedList({
      db,
      config,
      waId,
      text: typed,
      lang,
      now,
      deliver: (text, kind) => deliver(db, config, waId, text, kind),
      deliverImage: (link, caption, kind, card) => deliverPicture(db, config, waId, link, caption, kind, now, card),
      ...(readTimeoutMs !== undefined ? { readTimeoutMs } : {}),
    });
    if (outcome !== 'fallback') return;
  }

  const redirect = config.handoffMode === 'redirect';
  const linkSent = redirect && (await advisorLinkSentLately(db, waId, now));
  const photoRead = await photoReadFor(db, waId, now);
  const timeoutMs = timeLeft();
  const answer =
    config.openrouterKey && timeoutMs !== null
      ? await askAssistant({
          history,
          message: input.message,
          model: config.model,
          apiKey: config.openrouterKey,
          handoffMode: config.handoffMode,
          photoRead,
          advisorLinkSent: linkSent,
          photoReading,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        })
      : null;

  // A message that came in while the assistant was writing answers both.
  if (answer && (await overtaken(db, waId, input.wamid))) return;

  if (!answer) {
    const withLink = redirect && !linkSent;
    const text = withLink ? `${COPY.fallback[lang]}\n\n${COPY.redirect[lang]}` : COPY.fallback[lang];
    if (!(await deliver(db, config, waId, text, withLink ? ADVISOR_LINK_KIND : 'fixed'))) return;
    if (!redirect) await updateContact(db, waId, { handoffUntil: handoffDeadline(now) });
    return;
  }

  if (!(await deliver(db, config, waId, answer.reply, 'assistant'))) return;
  if (!answer.handoff) return;
  if (redirect) {
    if (!linkSent) await deliver(db, config, waId, COPY.redirect[lang], ADVISOR_LINK_KIND);
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

  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    try {
      if (event.type === 'echo') {
        await handleEcho(db, config, event);
        continue;
      }
      // Handled one after the other, a later message of this delivery is not
      // stored yet when this one checks for newer messages: look ahead here.
      const overtakenInBatch = events
        .slice(index + 1)
        .some(
          (later) =>
            later.type === 'inbound' &&
            later.waId === event.waId &&
            answersItself({ kind: later.kind, body: later.text }),
        );
      await handleInbound(db, config, event, overtakenInBatch);
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
