/**
 * Decision router for inbound WhatsApp messages.
 *
 * Pure: given the event, the contact state, the clock and the handoff mode, it
 * says what to do (stay silent, send a fixed reply, or ask the assistant). All
 * side effects (sending, persisting, calling the model) belong to the caller.
 */

import type { HandoffMode } from '@/lib/whatsapp/config';
import { COPY, MENU_BUTTONS, type Lang, type MenuButton } from '@/lib/whatsapp/copy';
import type { InboundEvent } from '@/lib/whatsapp/payload';

export const HANDOFF_HOURS = 24;
export const MAX_ASSISTANT_REPLIES_PER_DAY = 20;

export interface ContactState {
  waId: string;
  lang: Lang;
  greetedAt: Date | null;
  handoffUntil: Date | null;
}

/** Reply buttons sent under the text, and the plain text to send instead if the button message fails. */
export interface Menu {
  buttons: readonly MenuButton[];
  fallbackText: string;
}

export type Decision =
  | { action: 'silent' }
  | { action: 'send'; text: string; markGreeted: boolean; handoff: boolean; menu?: Menu }
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

/**
 * The texts WhatsApp pre-fills when someone taps a Click-to-WhatsApp ad. They
 * follow the language of the phone, not the person's: a darija speaker with a
 * French phone sends the French one.
 */
const AD_PREFILLS: readonly RegExp[] = [
  /^\s*Bonjour\s*!\s*Puis-je en savoir plus/i,
  /^\s*Hello!?\s*Can I get more info/i,
  /^\s*مرحب[اًا]*!?\s*هل يمكنني الحصول على مزيد من المعلومات/,
];

/** The message came from tapping the ad: it carries the ad referral, or is one of WhatsApp's pre-filled texts. */
export function isAdPrefill(event: Pick<InboundEvent, 'kind' | 'text' | 'referral'>): boolean {
  if (event.referral !== null) return true;
  if (event.kind !== 'text' || !event.text) return false;
  const text = event.text;
  return AD_PREFILLS.some((prefill) => prefill.test(text));
}

/** The ad speaks darija, so a first contact through it is answered in darija until they write in French. */
export const AD_DEFAULT_LANG: Lang = 'ar';

/**
 * The language to answer in. A pre-filled ad message says nothing about the
 * person (see AD_PREFILLS): it sets the ad's language on a first contact and
 * leaves a known contact's language alone. Anything typed is detected.
 */
export function resolveLang(
  event: Pick<InboundEvent, 'kind' | 'text' | 'referral'>,
  contact: Pick<ContactState, 'lang' | 'greetedAt'>,
): Lang {
  if (isAdPrefill(event)) return contact.greetedAt === null ? AD_DEFAULT_LANG : contact.lang;
  return detectLang(event.text, contact.lang);
}

/**
 * An ad message from a contact greeted less than this long ago is the tail of
 * the first burst (WhatsApp delivers the pre-filled text and a typed "salam"
 * together), not a new visit: it gets no answer of its own.
 */
export const REGREET_QUIET_MINUTES = 10;

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

  // 4. First contact: the menu comes as buttons, so one tap is enough to answer.
  if (contact.greetedAt === null) {
    return {
      action: 'send',
      text: COPY.greeting,
      markGreeted: true,
      handoff: false,
      menu: { buttons: MENU_BUTTONS, fallbackText: COPY.greetingPlain },
    };
  }

  // 5. Back through the ad: the menu again rather than a presentation written by the assistant.
  if (isAdPrefill(event)) {
    const quietUntil = contact.greetedAt.getTime() + REGREET_QUIET_MINUTES * 60 * 1000;
    if (now.getTime() < quietUntil) return { action: 'silent' };
    return {
      action: 'send',
      text: COPY.menuAgain,
      markGreeted: false,
      handoff: false,
      menu: { buttons: MENU_BUTTONS, fallbackText: COPY.menuAgainPlain },
    };
  }

  // 6. Photos are read in the workshop, not by the bot.
  if (event.kind === 'image') return reply(COPY.imageHint[lang], false);

  // 7. Media the bot cannot read.
  if (HANDOFF_MEDIA_KINDS.has(event.kind)) return toAdvisor(COPY.mediaHandoff[lang], false);

  if (event.kind === 'text') {
    // 8. Daily assistant cap.
    if (assistantRepliesLast24h >= MAX_ASSISTANT_REPLIES_PER_DAY) return toAdvisor(COPY.advisor[lang], false);
    // 9. Free text goes to the assistant.
    return { action: 'assistant' };
  }

  // Unreachable with the current InboundKind union; stay quiet rather than guess.
  return { action: 'silent' };
}
