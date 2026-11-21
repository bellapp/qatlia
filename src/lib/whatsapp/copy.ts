/**
 * Fixed WhatsApp replies (French and Moroccan Arabic).
 *
 * Pure module: the texts the bot sends without calling the assistant. The demo
 * video link always comes before the site link so WhatsApp builds the video
 * preview from the first URL of the message.
 */

import { CREDIT_PACKS, formatMAD } from '@/lib/billing/catalog';
import { ANALYSIS_WINDOW_HOURS, MAX_SCANS_PER_ANALYSIS, SIGNUP_FREE_CREDITS, VISION_CREDIT_COST } from '@/lib/billing/policy';
import { supportWhatsAppUrl } from '@/lib/support';

export type Lang = 'fr' | 'ar';

export const DEMO_VIDEO_URL = 'https://youtu.be/dQE_PzXUAR0';

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
  ar: `🎥 شوف كيفاش كيخدم: ${DEMO_VIDEO_URL}`,
  fr: `🎥 Démo en 1 min : ${DEMO_VIDEO_URL}`,
};
const GREETING_DEMO_BOTH = `🎥 Démo · كيفاش كيخدم : ${DEMO_VIDEO_URL}`;

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
  const head = `${invite(input.lang)}\n\n${invite(other)}\n\n${GREETING_DEMO_BOTH}`;
  return {
    text: `${head}\n👇 ${GREETING_BUTTONS.fr.replace(' 👇', '')} · ${GREETING_BUTTONS.ar.replace(' 👇', '')}`,
    plain: `${head}\n${GREETING_TYPED_BOTH}`,
  };
}

const DEFAULT_GREETING = greeting({ lang: 'fr', bilingual: true, voice: true });

const MENU_AGAIN_FR = 'Re-bonjour 👋 Choisissez ci-dessous 👇 ou posez directement votre question ✍️';
const MENU_AGAIN_AR = 'مرحبا بيك مرة أخرى 👋 ختار من التحت 👇 ولا سول سؤالك مباشرة';

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

  howItWorks: {
    fr: `Voici comment ça marche en 1 minute 🎥
${DEMO_VIDEO_URL}

1. Créez votre compte sur ${SITE_LINKS.fr}
2. Prenez en photo votre fiche de mesure
3. Lancez l'optimisation, et vous obtenez le plan de coupe et le PDF pour l'atelier.

📸 Ou envoyez-moi directement ici la photo de votre fiche : je la lis pour vous.`,
    ar: `شوف كيفاش كيخدم فدقيقة 🎥
${DEMO_VIDEO_URL}

1. دير حساب فـ ${SITE_LINKS.ar}
2. صوّر ورقة القياسات
3. ضغط على التحسين، وغادي يعطيك مخطط التقطيع وتقرير PDF للورشة.

📸 ولا صيفط ليا التصويرة ديال الورقة هنا مباشرة ونقراها ليك.`,
  },

  pricing: {
    fr: `💰 Tarifs QatliA
🎁 ${SIGNUP_FREE_CREDITS} crédits gratuits à l'inscription pour essayer.
${VISION_CREDIT_COST} crédit = 1 analyse complète (photo de la fiche, jusqu'à ${MAX_SCANS_PER_ANALYSIS} photos si elle tient sur plusieurs feuilles, + plan de coupe).
Recalculs de la même liste gratuits pendant ${ANALYSIS_WINDOW_HOURS} h, exports PDF gratuits.

Packs, sans abonnement :
${PACK_LINES_FR}

👉 ${SITE_LINKS.fr}`,
    ar: `💰 الأثمنة ديال QatliA
🎁 ${SIGNUP_FREE_CREDITS} كريدي مجانا ملي كتسجل باش تجرب.
${VISION_CREDIT_COST} كريدي = تحليل كامل (صورة الورقة، حتى ${MAX_SCANS_PER_ANALYSIS} صور إلا كانت فعدة أوراق، + مخطط التقطيع).
إعادة الحساب فنفس اللائحة مجانية لمدة ${ANALYSIS_WINDOW_HOURS} ساعة، وملفات PDF مجانية.

الباقات، بلا اشتراك:
${PACK_LINES_AR}

👉 ${SITE_LINKS.ar}`,
  },

  advisor: {
    fr: `Avec plaisir ! Un conseiller vous répond très vite. En attendant, dites-nous ce que vous fabriquez (cuisines, placards, meubles…) et quels panneaux vous utilisez.`,
    ar: `مرحبا! مستشار غادي يجاوبك قريب. قول لينا شنو كتصاوب (كوزينات، بلاكارات، أثاث…) وشنو نوع الألواح اللي كتخدم بيها.`,
  },

  redirect: {
    fr: `Écrivez directement à notre conseiller ici : ${SUPPORT_URL}`,
    ar: `كتب للمستشار ديالنا مباشرة هنا: ${SUPPORT_URL}`,
  },

  imageHint: {
    fr: `Merci pour la photo ! Pour obtenir le plan de coupe, ouvrez l'atelier et prenez votre fiche de mesure en photo : l'IA lit les pièces pour vous. Vous créez ensuite votre compte gratuit (${SIGNUP_FREE_CREDITS} crédits offerts) : la photo prise dans l'atelier est gardée pendant l'inscription.
👉 ${ATELIER_LINK}`,
    ar: `شكرا على الصورة! باش تاخد مخطط التقطيع، حل الورشة وصوّر ورقة القياسات، والذكاء الاصطناعي غادي يقرا القطع. من بعد دير حساب مجاني (${SIGNUP_FREE_CREDITS} كريدي فابور)، والصورة اللي صورتي فالورشة كتبقى محفوظة.
👉 ${ATELIER_LINK}`,
  },

  mediaHandoff: {
    fr: `Je ne peux pas encore ouvrir ce type de message. Écrivez-moi votre question, ou un conseiller vous répond très vite.`,
    ar: `مازال ما نقدرش نحل هاد النوع ديال الرسائل. كتب ليا سؤالك، ولا مستشار غادي يجاوبك قريب.`,
  },

  voiceUnclear: {
    fr: `Je n'ai pas bien compris votre message vocal 🙏 Écrivez-moi votre question en quelques mots, ou un conseiller vous répond très vite.`,
    ar: `ما فهمتش مزيان الأوديو ديالك 🙏 كتب ليا سؤالك بشي كلمات، ولا مستشار غادي يجاوبك قريب.`,
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
    fr: `Je n'ai pas réussi à lire cette fiche 😕 Envoyez une photo plus nette, bien à plat et en entier, ou prenez-la directement dans l'atelier :
👉 ${ATELIER_LINK}`,
    ar: `ما قدرتش نقرا هاد الورقة 😕 صيفط صورة واضحة، مسطحة وكاملة، ولا صوّرها مباشرة فالورشة:
👉 ${ATELIER_LINK}`,
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
