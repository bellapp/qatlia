/**
 * Fixed WhatsApp replies (French and Moroccan Arabic).
 *
 * Pure module: the texts the bot sends without calling the assistant. The demo
 * video link always comes before the site link so WhatsApp builds the video
 * preview from the first URL of the message.
 */

import { CREDIT_PACKS, formatMAD } from '@/lib/billing/catalog';
import { SIGNUP_FREE_CREDITS, VISION_CREDIT_COST } from '@/lib/billing/policy';
import { supportWhatsAppUrl } from '@/lib/support';

export type Lang = 'fr' | 'ar';

/**
 * The video in the reader's language: the 1-minute French demo, and a simple
 * explanation in darija for the darija texts.
 */
export const DEMO_VIDEO_URLS: Record<Lang, string> = {
  fr: 'https://youtu.be/dQE_PzXUAR0',
  ar: 'https://youtube.com/shorts/rAjcW-1Wylk',
};

/**
 * Short links: each redirects to its page with `utm_source=whatsapp`
 * (next.config.mjs), so a sign-up is still traced back to WhatsApp
 * (src/lib/acquisition.ts) while the prospect never reads the tag; the site
 * then drops it from the address bar (src/components/ClientShell.tsx).
 */
/** The site in the reader's language: the darija texts open the Arabic landing page. */
export const SITE_LINKS: Record<Lang, string> = {
  fr: 'https://qatlia.ma/wa',
  ar: 'https://qatlia.ma/wa/ar',
};

/** The workshop opens without an account: the photo is kept and read right after sign-up. */
export const ATELIER_LINK = 'https://qatlia.ma/wa/atelier';

const SUPPORT_URL = supportWhatsAppUrl();

// Packs are listed from the catalog so a price change reaches the bot too.
const PACK_LINES_FR = Object.values(CREDIT_PACKS)
  .map((pack) => `• ${pack.credits} crédits : ${formatMAD(pack.priceMAD)}`)
  .join('\n');
const PACK_LINES_AR = Object.values(CREDIT_PACKS)
  .map((pack) => `• ${pack.credits} كريدي بـ ${pack.priceMAD} درهم`)
  .join('\n');

/** A tappable reply button. Its id is the menu digit, so a tap is routed exactly like typing it. */
export interface MenuButton {
  id: '1' | '2' | '3';
  title: string;
}

/** WhatsApp caps a reply button title at 20 characters; the greeting is bilingual, so are the titles. */
export const MENU_BUTTON_TITLE_MAX = 20;

export const MENU_BUTTONS: readonly MenuButton[] = [
  { id: '1', title: 'Démo · كيفاش كيخدم' },
  { id: '2', title: 'Tarifs · الأثمنة' },
  { id: '3', title: 'Conseiller · مستشار' },
];

/**
 * The greeting opens on the one thing to do right here: send the photo of the
 * cut list (the bot reads it, src/lib/whatsapp/photo.ts), or a voice note when
 * they are heard. In the 80 ad conversations of 14-20/11/2026, 59 % left after
 * a long greeting that only pointed at the site.
 */
const GREETING_INVITE: Record<Lang, { hello: string; photo: string; voice: string }> = {
  ar: {
    hello: 'مرحبا بيك فـ QatliA 👋',
    photo: '📸 صيفط ليا هنا تصويرة ورقة القياسات ديالك، ونرجع ليك مخطط التقطيع فثواني.',
    voice: '🎤 ولا صيفط ليا أوديو وسولني اللي بغيتي.',
  },
  fr: {
    hello: 'Bonjour, bienvenue chez QatliA 👋',
    photo: '📸 Envoyez-moi ici la photo de votre fiche de débit : je vous renvoie le plan de coupe en quelques secondes.',
    voice: '🎤 Ou posez votre question par message vocal.',
  },
};

const GREETING_DEMO: Record<Lang, string> = {
  ar: `🎥 شوف كيفاش كيخدم: ${DEMO_VIDEO_URLS.ar}`,
  fr: `🎥 Démo en 1 min : ${DEMO_VIDEO_URLS.fr}`,
};
/** One link only, so WhatsApp shows one preview: the video in the contact's language. */
const greetingDemoBoth = (lang: Lang): string => `🎥 Démo · كيفاش كيخدم : ${DEMO_VIDEO_URLS[lang]}`;

const GREETING_BUTTONS: Record<Lang, string> = {
  ar: 'ولا ختار من التحت 👇',
  fr: 'Ou choisissez ci-dessous 👇',
};
const GREETING_TYPED: Record<Lang, string> = {
  ar: 'ولا جاوب بـ 1 / 2 / 3:\n1️⃣ كيفاش كيخدم\n2️⃣ الأثمنة\n3️⃣ مستشار',
  fr: 'Ou répondez :\n1️⃣ Comment ça marche\n2️⃣ Tarifs\n3️⃣ Parler à un conseiller',
};
const GREETING_TYPED_BOTH = `1️⃣ Comment ça marche · كيفاش كيخدم
2️⃣ Tarifs · الأثمنة
3️⃣ Conseiller · مستشار
Répondez 1, 2 ou 3 · جاوب بـ 1 / 2 / 3`;

/**
 * The first-contact greeting. `bilingual` when the first message says nothing
 * sure about the reader (the French pre-filled text follows the phone, and many
 * darija speakers have a French phone): both languages, the contact's first.
 * `text` goes with the MENU_BUTTONS; `plain` is its typed 1/2/3 version.
 */
export function greeting(input: { lang: Lang; bilingual: boolean; voice: boolean }): { text: string; plain: string } {
  const invite = (lang: Lang): string => {
    const { hello, photo, voice } = GREETING_INVITE[lang];
    return [hello, photo, ...(input.voice ? [voice] : [])].join('\n');
  };
  if (!input.bilingual) {
    const head = `${invite(input.lang)}\n${GREETING_DEMO[input.lang]}`;
    return { text: `${head}\n${GREETING_BUTTONS[input.lang]}`, plain: `${head}\n${GREETING_TYPED[input.lang]}` };
  }
  const other: Lang = input.lang === 'ar' ? 'fr' : 'ar';
  const head = `${invite(input.lang)}\n\n${invite(other)}\n\n${greetingDemoBoth(input.lang)}`;
  return {
    text: `${head}\n👇 ${GREETING_BUTTONS.fr.replace(' 👇', '')} · ${GREETING_BUTTONS.ar.replace(' 👇', '')}`,
    plain: `${head}\n${GREETING_TYPED_BOTH}`,
  };
}

const DEFAULT_GREETING = greeting({ lang: 'fr', bilingual: true, voice: true });

const MENU_AGAIN_FR = 'Re-bonjour 👋 Envoyez-moi la photo de votre fiche 📸, ou choisissez ci-dessous 👇';
const MENU_AGAIN_AR = 'مرحبا بيك مرة أخرى 👋 صيفط ليا تصويرة الورقة 📸، ولا ختار من التحت 👇';

export const COPY: {
  /** The bilingual first-contact greeting, French first (see greeting() for every variant), sent with the MENU_BUTTONS. */
  greeting: string;
  /** The same greeting as plain text with a typed 1/2/3 menu, used when the button message cannot be sent. */
  greetingPlain: string;
  /** Short menu for a contact already greeted who comes back through the ad, sent with the MENU_BUTTONS. */
  menuAgain: string;
  /** The same as plain text with a typed 1/2/3 menu. */
  menuAgainPlain: string;
  howItWorks: Record<Lang, string>;
  pricing: Record<Lang, string>;
  advisor: Record<Lang, string>;
  redirect: Record<Lang, string>;
  imageHint: Record<Lang, string>;
  mediaHandoff: Record<Lang, string>;
  /** A voice note the bot could not hear (download, format, transcription, daily cap). */
  voiceUnclear: Record<Lang, string>;
  fallback: Record<Lang, string>;
} = {
  greeting: DEFAULT_GREETING.text,

  greetingPlain: DEFAULT_GREETING.plain,

  menuAgain: `${MENU_AGAIN_FR}

${MENU_AGAIN_AR}`,

  menuAgainPlain: `${MENU_AGAIN_FR}
1️⃣ Comment ça marche
2️⃣ Tarifs
3️⃣ Parler à un conseiller

${MENU_AGAIN_AR}
جاوب بـ 1 / 2 / 3`,

  // Written for carpenters not at ease with technology: one thing to do, in
  // everyday words (tests/whatsapp-simple-messages.test.js).
  howItWorks: {
    fr: `C'est simple 👇
📸 Prenez en photo votre fiche de débit avec votre téléphone et envoyez-la-moi ici.
✅ Je vous renvoie le plan de coupe : combien de panneaux, et comment les couper.
🎥 Vidéo d'1 minute : ${DEMO_VIDEO_URLS.fr}`,
    ar: `ساهلة 👇
📸 صوّر ورقة القياسات ديالك بالتيليفون وصيفطها ليا هنا.
✅ نرجع ليك مخطط التقطيع: شحال من بانو وكيفاش تقطعهم.
🎥 شوف الفيديو بالدارجة: ${DEMO_VIDEO_URLS.ar}`,
  },

  pricing: {
    fr: `💰 Tarifs
🎁 ${SIGNUP_FREE_CREDITS} crédits gratuits à l'inscription.
${VISION_CREDIT_COST} crédit = 1 fiche lue + son plan de coupe.

Packs, sans abonnement :
${PACK_LINES_FR}

👉 ${SITE_LINKS.fr}`,
    ar: `💰 الأثمنة
🎁 ${SIGNUP_FREE_CREDITS} كريدي مجانا ملي كتسجل.
${VISION_CREDIT_COST} كريدي = ورقة وحدة كتقرا + مخطط التقطيع ديالها.

الباقات، بلا اشتراك:
${PACK_LINES_AR}

👉 ${SITE_LINKS.ar}`,
  },

  advisor: {
    fr: `Avec plaisir ! Un conseiller vous répond très vite 🙏 Dites-nous ce que vous fabriquez (cuisines, placards…), par écrit ou en vocal.`,
    ar: `مرحبا! مستشار غادي يجاوبك قريب 🙏 قول لينا شنو كتصاوب (كوزينات، بلاكارات…)، بالكتابة ولا بأوديو.`,
  },

  redirect: {
    fr: `Écrivez directement à notre conseiller ici : ${SUPPORT_URL}`,
    ar: `كتب للمستشار ديالنا مباشرة هنا: ${SUPPORT_URL}`,
  },

  imageHint: {
    fr: `Merci pour la photo ! Pour avoir le plan de coupe, ouvrez ce lien et reprenez dedans la photo de votre fiche 👇
👉 ${ATELIER_LINK}`,
    ar: `شكرا على الصورة! باش تاخد مخطط التقطيع، حل هاد الرابط وعاود صوّر فيه الورقة ديالك 👇
👉 ${ATELIER_LINK}`,
  },

  mediaHandoff: {
    fr: `Je ne peux pas ouvrir ce message 🙏 Envoyez-moi plutôt la photo de votre fiche de débit, ou écrivez-moi. Un conseiller peut aussi vous répondre.`,
    ar: `ما قدرتش نحل هاد الرسالة 🙏 صيفط ليا تصويرة ورقة القياسات، ولا كتب ليا. ومستشار يقدر يجاوبك حتى هو.`,
  },

  voiceUnclear: {
    fr: `Je n'ai pas bien entendu votre vocal 🙏 Envoyez-moi la photo de votre fiche de débit, ou un conseiller vous répond très vite.`,
    ar: `ما سمعتش مزيان الأوديو ديالك 🙏 صيفط ليا تصويرة ورقة القياسات، ولا مستشار غادي يجاوبك قريب.`,
  },

  fallback: {
    fr: `Merci pour votre message ! Un conseiller vous répond très vite.`,
    ar: `شكرا على رسالتك! مستشار غادي يجاوبك قريب.`,
  },
};

/**
 * Texts of the photo reading (plan 2026-11-19): the bot reads a photographed
 * cut list once per number. The result itself is built in photo-summary.ts.
 */
export const PHOTO_COPY: {
  /** Sent as soon as the read starts: it takes 10 to 20 seconds. */
  reading: Record<Lang, string>;
  /** After "je lis", the read failed: always sent, so the prospect is never left with "je lis" alone. */
  unreadable: Record<Lang, string>;
  /** A number whose photo was already read: its link while valid, and the atelier for the next ones. */
  already: (lang: Lang, link: string | null) => string;
  /** A list read but over the bot's limit (MAX_BOT_PIECES): it was read, so never the unreadable text. */
  tooBig: (lang: Lang, pieceCount: number) => string;
} = {
  reading: {
    fr: '📸 Je lis votre fiche… (10 à 20 secondes)',
    ar: '📸 كنقرا الورقة ديالك… (10 حتى 20 ثانية)',
  },
  unreadable: {
    fr: `Je n'ai pas réussi à lire cette fiche 😕 Reprenez la photo de près, bien à plat, avec toute la feuille, et renvoyez-la-moi ici.`,
    ar: `ما قدرتش نقرا هاد الورقة 😕 عاود صوّرها من قريب، مسطحة وكاملة، وعاود صيفطها ليا هنا.`,
  },
  already: (lang, link) => {
    if (lang === 'ar') {
      const first = link ? `الورقة الأولى ديالك تقرات 👉 ${link}\n` : '';
      return `${first}الأوراق الأخرى صوّرهم فالورشة، من بعد ما تدير حساب مجاني:\n👉 ${ATELIER_LINK}`;
    }
    const first = link ? `Votre première fiche est déjà lue 👉 ${link}\n` : '';
    return `${first}Les fiches suivantes se lisent dans l'atelier, après votre inscription gratuite :\n👉 ${ATELIER_LINK}`;
  },
  tooBig: (lang, pieceCount) =>
    lang === 'ar'
      ? `✅ قريت الورقة ديالك: ${pieceCount} قطعة. هادي بزاف على الواتساب: صوّرها فالورشة ويتوجد المخطط ديالها كامل:\n👉 ${ATELIER_LINK}`
      : `✅ J'ai lu votre fiche : ${pieceCount} pièces. C'est trop pour WhatsApp : prenez-la en photo dans l'atelier, le plan s'y fait en entier :\n👉 ${ATELIER_LINK}`,
};

/**
 * A photo of a real cut list, sent right after the greeting: many prospects do
 * not know what "ورقة القياسات" is, and some send a drawing of the furniture
 * instead (owner, 20/11/2026). Served from public/ (the middleware skips .jpg);
 * it carries the sRGB color profile YCloud requires.
 */
export const EXAMPLE_FICHE_URL = 'https://qatlia.ma/whatsapp/exemple-fiche.jpg';

const EXAMPLE_CAPTION: Record<Lang, string> = {
  ar: '📸 بحال هادي: لائحة البياسات (الطول × العرض × العدد). صوّرها بالتيليفون وصيفطها ليا هنا.',
  fr: '📸 Comme celle-ci : la liste des pièces (longueur × largeur × nombre). Prenez-la en photo avec votre téléphone et envoyez-la-moi ici.',
};

/** The example's caption, in the greeting's languages: the contact's first when both. */
export function exampleCaption(lang: Lang, bilingual: boolean): string {
  if (!bilingual) return EXAMPLE_CAPTION[lang];
  const other: Lang = lang === 'ar' ? 'fr' : 'ar';
  return `${EXAMPLE_CAPTION[lang]}\n${EXAMPLE_CAPTION[other]}`;
}
