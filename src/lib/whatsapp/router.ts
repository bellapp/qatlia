/**
 * Decision router for inbound WhatsApp messages.
 *
 * Pure: given the event, the contact state, the clock and the handoff mode, it
 * says what to do (stay silent, send a fixed reply, or ask the assistant). All
 * side effects (sending, persisting, calling the model) belong to the caller.
 */

import type { HandoffMode } from '@/lib/whatsapp/config';
import { COPY, type Lang } from '@/lib/whatsapp/copy';
import type { InboundEvent } from '@/lib/whatsapp/payload';

export const HANDOFF_HOURS = 24;
export const MAX_ASSISTANT_REPLIES_PER_DAY = 20;

export interface ContactState {
  waId: string;
  lang: Lang;
  greetedAt: Date | null;
  handoffUntil: Date | null;
}

export type Decision =
  | { action: 'silent' }
  | { action: 'send'; text: string; markGreeted: boolean; handoff: boolean }
  | { action: 'assistant' };

const ARABIC_LETTER = /[؀-ۿ]/;
const LATIN_LETTERS = /[A-Za-zÀ-ÖØ-öø-ÿ]/g;
const MIN_LATIN_LETTERS = 3;

/** Arabic if any Arabic letter, French if at least 3 Latin letters, otherwise unchanged. */
export function detectLang(text: string | null, previous: Lang): Lang {
  if (!text) return previous;
  if (ARABIC_LETTER.test(text)) return 'ar';
  if ((text.match(LATIN_LETTERS) ?? []).length >= MIN_LATIN_LETTERS) return 'fr';
  return previous;
}

// A single digit 1-3 (Latin or Arabic-Indic), optionally in a keycap emoji or
// followed by "." or ")". Nothing else counts as a menu choice.
const MENU_CHOICE = /^\s*([1-3١-٣])️?⃣?\s*[.)]?\s*$/;

export function menuChoice(text: string | null): 1 | 2 | 3 | null {
  if (!text) return null;
  const match = MENU_CHOICE.exec(text);
  if (!match) return null;
  const code = match[1].charCodeAt(0);
  const digit = code >= 0x0661 ? code - 0x0660 : code - 0x30;
  return digit as 1 | 2 | 3;
}

const SILENT_KINDS: ReadonlySet<string> = new Set(['sticker', 'reaction', 'other']);
const HANDOFF_MEDIA_KINDS: ReadonlySet<string> = new Set(['audio', 'video', 'document', 'location', 'contacts']);

export function decide(input: {
  event: InboundEvent;
  contact: ContactState;
  now: Date;
  assistantRepliesLast24h: number;
  handoffMode: HandoffMode;
}): Decision {
  const { event, contact, now, assistantRepliesLast24h, handoffMode } = input;
  const lang = contact.lang;
  const redirect = handoffMode === 'redirect';

  // A human conversation hand-off is a coexistence concept; redirect mode never sets handoff.
  const toAdvisor = (text: string, markGreeted: boolean): Decision => ({
    action: 'send',
    text: redirect ? `${text}\n\n${COPY.redirect[lang]}` : text,
    markGreeted,
    handoff: !redirect,
  });
  const reply = (text: string, markGreeted: boolean): Decision => ({
    action: 'send',
    text,
    markGreeted,
    handoff: false,
  });

  // 1. A human took over this conversation.
  if (contact.handoffUntil !== null && contact.handoffUntil.getTime() > now.getTime()) {
    return { action: 'silent' };
  }

  // 2. Nothing to answer.
  if (SILENT_KINDS.has(event.kind)) return { action: 'silent' };

  // 3. Menu choices, even for a contact not greeted yet.
  const choice = menuChoice(event.text);
  if (choice === 1) return reply(COPY.howItWorks[lang], true);
  if (choice === 2) return reply(COPY.pricing[lang], true);
  if (choice === 3) return toAdvisor(COPY.advisor[lang], true);

  // 4. First contact.
  if (contact.greetedAt === null) return reply(COPY.greeting, true);

  // 5. Photos are read in the workshop, not by the bot.
  if (event.kind === 'image') return reply(COPY.imageHint[lang], false);

  // 6. Media the bot cannot read.
  if (HANDOFF_MEDIA_KINDS.has(event.kind)) return toAdvisor(COPY.mediaHandoff[lang], false);

  if (event.kind === 'text') {
    // 7. Daily assistant cap.
    if (assistantRepliesLast24h >= MAX_ASSISTANT_REPLIES_PER_DAY) return toAdvisor(COPY.advisor[lang], false);
    // 8. Free text goes to the assistant.
    return { action: 'assistant' };
  }

  // Unreachable with the current InboundKind union; stay quiet rather than guess.
  return { action: 'silent' };
}
