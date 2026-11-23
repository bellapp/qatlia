/**
 * Decision router for inbound WhatsApp messages.
 *
 * Pure: given the event, the contact state, the clock and the handoff mode, it
 * says what to do (stay silent, send a fixed reply, or ask the assistant). All
 * side effects (sending, persisting, calling the model) belong to the caller.
 */

import type { HandoffMode } from '@/lib/whatsapp/config';
import { COPY, MENU_BUTTONS, exampleCaption, greeting, type Lang, type MenuButton } from '@/lib/whatsapp/copy';
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
  /** `greeting`: the first-contact greeting, which only one delivery of a burst may send (claimGreeting). */
  /** `exampleCaption`: once the text is out, the example cut list (EXAMPLE_FICHE_URL) goes with this caption. */
  /** `thenAssistant`: once the greeting is out, the assistant answers the message (a first contact asking something). */
  /** `advisorLink`: the text carries the advisor's number (redirect mode); the route logs it as such. */
  | {
      action: 'send';
      text: string;
      markGreeted: boolean;
      handoff: boolean;
      menu?: Menu;
      greeting?: true;
      exampleCaption?: string;
      thenAssistant?: true;
      advisorLink?: true;
    }
  | { action: 'assistant' }
  /** A photo: the webhook tries to read it as a cut list (src/lib/whatsapp/photo.ts). */
  | { action: 'photo' }
  /** A voice note: the webhook transcribes it and answers it like a text (src/lib/whatsapp/voice.ts). */
  | { action: 'voice' };

const ARABIC_LETTER = /[؀-ۿ]/;
const LATIN_LETTERS = /[A-Za-zÀ-ÖØ-öø-ÿ]/g;
const MIN_LATIN_LETTERS = 3;

// Darija written in Latin letters (22/11/2026: « Slm », « Chhal fi chhar »
// got the French greeting). Words French never uses, or a digit standing for
// an Arabic letter inside a word (3afak, ch7al, l9yassat).
const DARIJA_WORD =
  /\b(slm|salam|salamo|salm|salem|chhal|ch7al|wach|wash|bghit|bghina|kifach|kifash|khoya|khouya|bzaf|bzzaf|daba|hadi|hada|hadchi|mzyan|mezyan|chno|achno|wakha|safi|labas|dyal|dial|diali|dyali|ghir|taman|tamane|fabour)\b/i;
// Never an « x » around the digit (180x5x2), never a unit after it (3mm, 7cm).
const DIGIT_LETTER = /[a-wyz][3579][a-wyz]|\b3(?!mm|cm)[a-wyz]{2,}/i;

export function isLatinDarija(text: string): boolean {
  return DARIJA_WORD.test(text) || DIGIT_LETTER.test(text);
}

/** Arabic if any Arabic letter or darija in Latin letters, French if at least 3 Latin letters, otherwise unchanged. */
export function detectLang(text: string | null, previous: Lang): Lang {
  if (!text) return previous;
  if (ARABIC_LETTER.test(text)) return 'ar';
  if (isLatinDarija(text)) return 'ar';
  if ((text.match(LATIN_LETTERS) ?? []).length >= MIN_LATIN_LETTERS) return 'fr';
  return previous;
}

const SALUTATION_WORDS: ReadonlySet<string> = new Set([
  'slm', 'salam', 'salm', 'salem', 'salamo', 'salut', 'bonjour', 'bonsoir', 'hello', 'hi', 'hey', 'hola', 'hallo',
  'cv', 'ça', 'ca', 'va', 'labas', 'marhba', 'merhba', 'mrhba', 'ahlan', 'alikom', 'alaykom', 'ok', 'merci',
  'سلام', 'السلام', 'عليكم', 'ورحمة', 'الله', 'وبركاته', 'مرحبا', 'مرحبًا', 'اهلا', 'أهلا', 'صباح', 'مساء',
  'الخير', 'النور', 'شكرا',
  // « I would like some information »: what the ad's text asks, and the greeting answers.
  'بغيت', 'المعلومات', 'معلومات', 'عافاك', 'bghit', 'info', 'infos', 'information', 'informations', 'svp', 'stp',
]);

/** Nothing but a hello (or a plain ask for information): the greeting answers it fully. */
export function isSalutationOnly(text: string): boolean {
  // Punctuation (Latin and Arabic), emoji (surrogate pairs, symbols, variation selectors) out.
  const words = text
    .toLowerCase()
    .replace(/[!?.,،؟؛;:'"()*~…_-]|[\uD800-\uDFFF]|[☀-➿️‍]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return words.length > 0 && words.every((word) => SALUTATION_WORDS.has(word));
}

/**
 * The texts WhatsApp pre-fills when someone taps a Click-to-WhatsApp ad. They
 * follow the language of the phone, not the person's: a darija speaker with a
 * French phone sends the French one.
 */
const AD_PREFILLS: readonly RegExp[] = [
  /^\s*Bonjour\s*!\s*Puis-je en savoir\s+plus/i,
  /^\s*Hello!?\s*Can I get more info/i,
  /^\s*مرحب[اًا]*!?\s*هل يمكنني الحصول على مزيد من المعلومات/,
  /^\s*Hallo!?\s*Kann ich hierzu mehr Informationen/i,
  /^\s*¡?Hola!?\s*(Quiero|Me gustaría conseguir) más información/i,
];

/** The same texts whole, so what a person typed after them can be told apart. */
const AD_PREFILLS_WHOLE: readonly RegExp[] = [
  /^\s*Bonjour\s*!\s*Puis-je en savoir\s+plus à ce sujet\s*\?/i,
  /^\s*Hello!?\s*Can I get more info on this\s*\??/i,
  /^\s*مرحب[اًا]*!?\s*هل يمكنني الحصول على مزيد من المعلومات حول هذا\s*[؟?]?/,
  /^\s*Hallo!?\s*Kann ich hierzu mehr Informationen erhalten\s*\??/i,
  /^\s*¡?Hola!?\s*(Quiero más información|Me gustaría conseguir más información sobre esto)\s*\.?/i,
];

/**
 * What the person typed beyond WhatsApp's pre-filled ad text: the whole text
 * when it is not one, '' when it is only one (or a cut-off one).
 */
export function typedBeyondPrefill(text: string): string {
  for (const whole of AD_PREFILLS_WHOLE) {
    const match = whole.exec(text);
    if (match) return text.slice(match[0].length).trim();
  }
  return AD_PREFILLS.some((prefill) => prefill.test(text)) ? '' : text.trim();
}

/**
 * Something to answer in a text: not only the pre-filled ad text, not only a
 * hello. The ad's referral says nothing here: it rides on the first message
 * whatever the person typed (« …à ce sujet ?بشحال هاد الخير », 22/11/2026).
 */
export function asksSomething(text: string): boolean {
  const typed = typedBeyondPrefill(text);
  // No letter nor digit (« 👍 », « ?? »): nothing to answer.
  if (!/[A-Za-zÀ-ÿ0-9؀-ۿ]/.test(typed)) return false;
  return !isSalutationOnly(typed);
}

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
 * The language to answer in. A French or English pre-filled ad message says
 * nothing about the person (see AD_PREFILLS): it sets the ad's language on a
 * first contact and leaves a known contact's language alone. The Arabic one
 * comes from an Arabic phone, so it reads Arabic: darija. Anything typed is detected.
 */
export function resolveLang(
  event: Pick<InboundEvent, 'kind' | 'text' | 'referral'>,
  contact: Pick<ContactState, 'lang' | 'greetedAt'>,
): Lang {
  if (isAdPrefill(event)) {
    if (event.text && ARABIC_LETTER.test(event.text)) return 'ar';
    return contact.greetedAt === null ? AD_DEFAULT_LANG : contact.lang;
  }
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
  /** Voice notes are transcribed (WHATSAPP_VOICE_ENABLED and an OpenRouter key); off, they get mediaHandoff. */
  voiceEnabled?: boolean;
}): Decision {
  const { event, contact, now, assistantRepliesLast24h, handoffMode } = input;
  const lang = contact.lang;
  const redirect = handoffMode === 'redirect';

  // A human conversation hand-off is a coexistence concept; redirect mode never sets handoff
  // and gives the advisor's number instead (its own text, or the text followed by the link).
  const toAdvisor = (text: string, markGreeted: boolean, redirectText = `${text}\n\n${COPY.redirect[lang]}`): Decision =>
    redirect
      ? { action: 'send', text: redirectText, markGreeted, handoff: false, advisorLink: true }
      : { action: 'send', text, markGreeted, handoff: true };
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
  if (choice === 3) return toAdvisor(COPY.advisor[lang], true, COPY.advisorRedirect[lang]);

  // 3b. A photo is read as a cut list, even as the very first message: these
  // are the prospects the reading is for, and a menu would only bury it.
  if (event.kind === 'image') return { action: 'photo' };

  // 4. First contact: the menu comes as buttons, so one tap is enough to answer.
  // Arabic letters say the reader reads Arabic; anything else gets both languages.
  if (contact.greetedAt === null) {
    const darija = event.text !== null && (ARABIC_LETTER.test(event.text) || isLatinDarija(event.text));
    const bilingual = !darija;
    const { text, plain } = greeting({ lang, bilingual, voice: input.voiceEnabled === true });
    // A real question (not the ad's text, not a hello) is answered after the greeting.
    const asks = event.kind === 'text' && event.text !== null && asksSomething(event.text);
    return {
      action: 'send',
      text,
      markGreeted: true,
      handoff: false,
      greeting: true,
      menu: { buttons: MENU_BUTTONS, fallbackText: plain },
      // Then the answer; otherwise a photo of a real cut list, so "ورقة القياسات" is not a guess.
      ...(asks ? { thenAssistant: true as const } : { exampleCaption: exampleCaption(lang, bilingual) }),
    };
  }

  // 5. Back through the ad: the menu again rather than a presentation written by the assistant,
  // unless a question was typed with it (then the assistant answers it, step 9).
  if (isAdPrefill(event) && !(event.kind === 'text' && event.text !== null && asksSomething(event.text))) {
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

  // 6. A voice note is a question said rather than typed: the same cap as a text.
  if (event.kind === 'audio' && input.voiceEnabled === true) {
    if (assistantRepliesLast24h >= MAX_ASSISTANT_REPLIES_PER_DAY) {
      return toAdvisor(COPY.advisor[lang], false, COPY.advisorRedirect[lang]);
    }
    return { action: 'voice' };
  }

  // 7. Media the bot cannot read.
  if (HANDOFF_MEDIA_KINDS.has(event.kind)) return toAdvisor(COPY.mediaHandoff[lang], false);

  if (event.kind === 'text') {
    // 8. Daily assistant cap.
    if (assistantRepliesLast24h >= MAX_ASSISTANT_REPLIES_PER_DAY) {
      return toAdvisor(COPY.advisor[lang], false, COPY.advisorRedirect[lang]);
    }
    // 9. Free text goes to the assistant.
    return { action: 'assistant' };
  }

  // Unreachable with the current InboundKind union; stay quiet rather than guess.
  return { action: 'silent' };
}
