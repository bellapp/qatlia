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

/** Tags every site link the bot sends, so a sign-up can be traced back to WhatsApp (see src/lib/acquisition.ts). */
export const WHATSAPP_TRACKING = 'utm_source=whatsapp';

/** The site in the reader's language: the darija texts open the Arabic landing page. */
export const SITE_LINKS: Record<Lang, string> = {
  fr: `https://qatlia.ma/?${WHATSAPP_TRACKING}`,
  ar: `https://qatlia.ma/ar?${WHATSAPP_TRACKING}`,
};

/** The workshop opens without an account: the photo is kept and read right after sign-up. */
export const ATELIER_LINK = `https://qatlia.ma/atelier?${WHATSAPP_TRACKING}`;

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

const GREETING_INTRO_FR = `Bonjour 👋 Merci pour votre intérêt !
QatliA optimise la découpe de vos panneaux : prenez en photo votre fiche de mesure et recevez le plan de coupe en PDF en quelques secondes.
🎥 Démo en 1 min : ${DEMO_VIDEO_URL}
👉 Essai gratuit : ${SITE_LINKS.fr}`;

const GREETING_INTRO_AR = `مرحبا 👋 QatliA كيعطيك مخطط تقطيع الألواح من صورة ورقة القياسات فثواني.
👉 جرّب مجانا: ${SITE_LINKS.ar}`;

const MENU_AGAIN_FR = 'Re-bonjour 👋 Choisissez ci-dessous 👇 ou posez directement votre question ✍️';
const MENU_AGAIN_AR = 'مرحبا بيك مرة أخرى 👋 ختار من التحت 👇 ولا سول سؤالك مباشرة';

export const COPY: {
  /** First-contact message, sent with the MENU_BUTTONS under it. */
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
  fallback: Record<Lang, string>;
} = {
  greeting: `${GREETING_INTRO_FR}
Choisissez ci-dessous 👇 ou posez directement votre question ✍️

${GREETING_INTRO_AR}
ختار من التحت 👇 ولا سول سؤالك مباشرة`,

  greetingPlain: `${GREETING_INTRO_FR}
Répondez :
1️⃣ Comment ça marche
2️⃣ Tarifs
3️⃣ Parler à un conseiller
Ou posez directement votre question ✍️

${GREETING_INTRO_AR}
جاوب بـ 1 / 2 / 3 ولا سول سؤالك مباشرة`,

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
3. Lancez l'optimisation, et vous obtenez le plan de coupe et le PDF pour l'atelier.`,
    ar: `شوف كيفاش كيخدم فدقيقة 🎥
${DEMO_VIDEO_URL}

1. دير حساب فـ ${SITE_LINKS.ar}
2. صوّر ورقة القياسات
3. ضغط على التحسين، وغادي يعطيك مخطط التقطيع وتقرير PDF للورشة.`,
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
    fr: `Je ne peux pas encore écouter ni ouvrir ce type de message. Écrivez-moi votre question, ou un conseiller vous répond très vite.`,
    ar: `مازال ما نقدرش نسمع ولا نحل هاد النوع ديال الرسائل. كتب ليا سؤالك، ولا مستشار غادي يجاوبك قريب.`,
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
  /** A number whose photo was already read: its link while valid, and the atelier for the next ones. */
  already: (lang: Lang, link: string | null) => string;
} = {
  reading: {
    fr: '📸 Je lis votre fiche… (10 à 20 secondes)',
    ar: '📸 كنقرا الورقة ديالك… (10 حتى 20 ثانية)',
  },
  already: (lang, link) => {
    if (lang === 'ar') {
      const first = link ? `الورقة الأولى ديالك تقرات 👉 ${link}\n` : '';
      return `${first}الأوراق الأخرى صوّرهم فالورشة، من بعد ما تدير حساب مجاني:\n👉 ${ATELIER_LINK}`;
    }
    const first = link ? `Votre première fiche est déjà lue 👉 ${link}\n` : '';
    return `${first}Les fiches suivantes se lisent dans l'atelier, après votre inscription gratuite :\n👉 ${ATELIER_LINK}`;
  },
};
