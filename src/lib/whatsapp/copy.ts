/**
 * Fixed WhatsApp replies (French and Moroccan Arabic).
 *
 * Pure module: the texts the bot sends without calling the assistant. The demo
 * video link always comes before the site link so WhatsApp builds the video
 * preview from the first URL of the message.
 */

import { CREDIT_PACKS, formatMAD } from '@/lib/billing/catalog';
import { ANALYSIS_WINDOW_HOURS, SIGNUP_FREE_CREDITS, VISION_CREDIT_COST } from '@/lib/billing/policy';
import { supportWhatsAppUrl } from '@/lib/support';

export type Lang = 'fr' | 'ar';

export const DEMO_VIDEO_URL = 'https://youtu.be/dQE_PzXUAR0';

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
👉 Essai gratuit : https://qatlia.ma`;

const GREETING_INTRO_AR = `مرحبا 👋 QatliA كيعطيك مخطط تقطيع الألواح من صورة ورقة القياسات فثواني.
👉 جرّب مجانا: https://qatlia.ma`;

export const COPY: {
  /** First-contact message, sent with the MENU_BUTTONS under it. */
  greeting: string;
  /** The same greeting as plain text with a typed 1/2/3 menu, used when the button message cannot be sent. */
  greetingPlain: string;
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

  howItWorks: {
    fr: `Voici comment ça marche en 1 minute 🎥
${DEMO_VIDEO_URL}

1. Créez votre compte sur https://qatlia.ma
2. Prenez en photo votre fiche de mesure
3. Lancez l'optimisation, et vous obtenez le plan de coupe et le PDF pour l'atelier.`,
    ar: `شوف كيفاش كيخدم فدقيقة 🎥
${DEMO_VIDEO_URL}

1. دير حساب فـ https://qatlia.ma
2. صوّر ورقة القياسات
3. ضغط على التحسين، وغادي يعطيك مخطط التقطيع وتقرير PDF للورشة.`,
  },

  pricing: {
    fr: `💰 Tarifs QatliA
🎁 ${SIGNUP_FREE_CREDITS} crédits gratuits à l'inscription pour essayer.
${VISION_CREDIT_COST} crédit = 1 analyse complète (photo de la fiche + plan de coupe).
Recalculs de la même liste gratuits pendant ${ANALYSIS_WINDOW_HOURS} h, exports PDF gratuits.

Packs, sans abonnement :
${PACK_LINES_FR}

👉 https://qatlia.ma`,
    ar: `💰 الأثمنة ديال QatliA
🎁 ${SIGNUP_FREE_CREDITS} كريدي مجانا ملي كتسجل باش تجرب.
${VISION_CREDIT_COST} كريدي = تحليل كامل (صورة الورقة + مخطط التقطيع).
إعادة الحساب فنفس اللائحة مجانية لمدة ${ANALYSIS_WINDOW_HOURS} ساعة، وملفات PDF مجانية.

الباقات، بلا اشتراك:
${PACK_LINES_AR}

👉 https://qatlia.ma`,
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
    fr: `Merci pour la photo ! Pour obtenir votre plan de coupe, créez votre compte sur https://qatlia.ma puis prenez votre fiche de mesure en photo dans l'atelier : l'IA lit les pièces pour vous.`,
    ar: `شكرا على الصورة! باش تاخد مخطط التقطيع، دير حساب فـ https://qatlia.ma وصوّر ورقة القياسات فالورشة، والذكاء الاصطناعي غادي يقرا القطع.`,
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
