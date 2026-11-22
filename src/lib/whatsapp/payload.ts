/**
 * Parsing of Meta WhatsApp Cloud API webhook payloads.
 *
 * Pure and total: anything unexpected yields no events, never an exception
 * (Meta retries on non-200, so the route must always be able to acknowledge).
 */

import { z } from 'zod';

export type InboundKind =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'location'
  | 'contacts'
  | 'sticker'
  | 'reaction'
  | 'other';

export interface InboundEvent {
  type: 'inbound';
  wamid: string;
  waId: string;
  profileName: string | null;
  kind: InboundKind;
  text: string | null;
  referral: Record<string, unknown> | null;
  /** Meta's id of the photo (kind 'image'), to download it; null for every other kind. */
  mediaId: string | null;
}

export interface EchoEvent {
  type: 'echo';
  waId: string;
  text: string | null;
  /** The echo's own message id, used to dedupe redeliveries and echoes of the bot's sends. */
  wamid: string | null;
}

const KNOWN_KINDS: ReadonlySet<string> = new Set([
  'text',
  'image',
  'audio',
  'video',
  'document',
  'location',
  'contacts',
  'sticker',
  'reaction',
]);

/**
 * A user with a WhatsApp username may hide their phone number: Meta then
 * omits `from` / `contacts[].wa_id` and gives only the business-scoped user
 * id (BSUID, e.g. "MA.1163870366035687") in `from_user_id` / `contacts[].user_id`.
 * The bot dropped those messages: 19 prospects of the ad got no answer
 * (20-22/11/2026). The phone number stays the identity when Meta sends it.
 */
const messageSchema = z.object({
  from: z.string().min(1).optional(),
  from_user_id: z.string().min(1).optional(),
  id: z.string().min(1),
  type: z.string().optional(),
  text: z.object({ body: z.string() }).partial().optional(),
  image: z.object({ caption: z.string(), id: z.string(), mime_type: z.string() }).partial().optional(),
  audio: z.object({ id: z.string() }).partial().optional().catch(undefined),
  interactive: z
    .object({ type: z.string(), button_reply: z.object({ id: z.string() }).partial() })
    .partial()
    .optional()
    .catch(undefined),
  button: z.object({ payload: z.string(), text: z.string() }).partial().optional().catch(undefined),
  referral: z.record(z.string(), z.unknown()).optional().catch(undefined),
});

const echoSchema = z.object({
  id: z.string().min(1).optional(),
  to: z.string().min(1),
  type: z.string().optional(),
  text: z.object({ body: z.string() }).partial().optional(),
});

const contactSchema = z.object({
  wa_id: z.string().optional(),
  user_id: z.string().optional(),
  profile: z.object({ name: z.string() }).partial().optional(),
});

const valueSchema = z.object({
  metadata: z.object({ phone_number_id: z.string() }),
  contacts: z.array(z.unknown()).optional(),
  messages: z.array(z.unknown()).optional(),
  message_echoes: z.array(z.unknown()).optional(),
});

const envelopeSchema = z.object({
  entry: z.array(
    z.object({
      changes: z.array(z.object({ field: z.string(), value: z.unknown() })).optional(),
    }),
  ),
});

/**
 * A tap on a reply button, as the text it stands for: the button id (the bot's
 * own buttons use the menu digit as id). Meta sends `interactive.button_reply`;
 * a reply to a message delivered as a template comes as `button.payload`.
 */
function buttonText(message: z.infer<typeof messageSchema>): string | null {
  if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
    return message.interactive.button_reply?.id || null;
  }
  if (message.type === 'button') return message.button?.payload || message.button?.text || null;
  return null;
}

function parseInbound(
  raw: unknown,
  profileNames: Map<string, string>,
): InboundEvent | null {
  const parsed = messageSchema.safeParse(raw);
  if (!parsed.success) return null;
  const message = parsed.data;
  const waId = message.from ?? message.from_user_id;
  if (!waId) return null;
  const type = message.type ?? '';
  const tapped = buttonText(message);
  let kind: InboundKind = KNOWN_KINDS.has(type) ? (type as InboundKind) : 'other';
  if (tapped !== null) kind = 'text';

  let text: string | null = null;
  if (tapped !== null) text = tapped;
  else if (kind === 'text') text = message.text?.body ?? null;
  else if (kind === 'image') text = message.image?.caption ?? null;

  return {
    type: 'inbound',
    wamid: message.id,
    waId,
    profileName: profileNames.get(waId) ?? null,
    kind,
    text,
    referral: message.referral ?? null,
    // Photos are read as cut lists, voice notes transcribed: both are downloaded.
    mediaId:
      kind === 'image' && message.image?.id
        ? message.image.id
        : kind === 'audio' && message.audio?.id
          ? message.audio.id
          : null,
  };
}

function parseEcho(raw: unknown): EchoEvent | null {
  const parsed = echoSchema.safeParse(raw);
  if (!parsed.success) return null;
  const echo = parsed.data;
  return {
    type: 'echo',
    waId: echo.to,
    text: echo.type === 'text' ? echo.text?.body ?? null : null,
    wamid: echo.id ?? null,
  };
}

export function parseWebhook(body: unknown, phoneNumberId: string): Array<InboundEvent | EchoEvent> {
  const envelope = envelopeSchema.safeParse(body);
  if (!envelope.success) return [];

  const events: Array<InboundEvent | EchoEvent> = [];
  for (const entry of envelope.data.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages' && change.field !== 'smb_message_echoes') continue;
      const value = valueSchema.safeParse(change.value);
      if (!value.success || value.data.metadata.phone_number_id !== phoneNumberId) continue;

      if (change.field === 'messages') {
        const profileNames = new Map<string, string>();
        for (const rawContact of value.data.contacts ?? []) {
          const contact = contactSchema.safeParse(rawContact);
          if (contact.success && contact.data.profile?.name) {
            for (const id of [contact.data.wa_id, contact.data.user_id]) {
              if (id) profileNames.set(id, contact.data.profile.name);
            }
          }
        }
        for (const rawMessage of value.data.messages ?? []) {
          const event = parseInbound(rawMessage, profileNames);
          if (event) events.push(event);
        }
      } else {
        for (const rawEcho of value.data.message_echoes ?? []) {
          const event = parseEcho(rawEcho);
          if (event) events.push(event);
        }
      }
    }
  }
  return events;
}
