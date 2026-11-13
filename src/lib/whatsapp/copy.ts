/**
 * Fixed WhatsApp replies (French and Moroccan Arabic).
 *
 * Pure module: the texts the bot sends without calling the assistant. The demo
 * video link always comes before the site link so WhatsApp builds the video
 * preview from the first URL of the message.
 */

import { ANALYSIS_WINDOW_HOURS } from '@/lib/billing/policy';
import { supportWhatsAppUrl } from '@/lib/support';

export type Lang = 'fr' | 'ar';

export const DEMO_VIDEO_URL = 'https://youtu.be/dQE_PzXUAR0';

const SUPPORT_URL = supportWhatsAppUrl();

export const COPY: {
  greeting: string;
  howItWorks: Record<Lang, string>;
  pricing: Record<Lang, string>;
  advisor: Record<Lang, string>;
  redirect: Record<Lang, string>;
  imageHint: Record<Lang, string>;
  mediaHandoff: Record<Lang, string>;
  fallback: Record<Lang, string>;
} = {
  greeting: `Bonjour 👋 Merci pour votre intérêt !
QatliA optimise la découpe de vos panneaux : prenez en photo votre fiche de mesure et recevez le plan de coupe en PDF en quelques secondes.
🎥 Démo en 1 min : ${DEMO_VIDEO_URL}
👉 Essai gratuit, sans carte bancaire : https://qatlia.ma
Répondez :
1️⃣ Comment ça marche
2️⃣ Tarifs
3️⃣ Parler à un conseiller
Ou posez directement votre question ✍️

مرحبا 👋 QatliA كيعطيك مخطط تقطيع الألواح من صورة ورقة القياسات فثواني.
👉 جرّب مجانا: https://qatlia.ma
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
    fr: `Vous commencez gratuitement avec des crédits offerts à l'inscription, sans carte bancaire. Ensuite, vous achetez des crédits seulement quand vous en avez besoin, sans abonnement. Les recalculs de la même liste sont gratuits pendant ${ANALYSIS_WINDOW_HOURS} h.
Détails : https://qatlia.ma`,
    ar: `كتبدا بالمجان بكريديات مهداة ملي كتسجل، بلا بطاقة بنكية. من بعد كتشري الكريديات غير ملي تحتاجهم، بلا اشتراك. إعادة الحساب فنفس اللائحة مجانية لمدة ${ANALYSIS_WINDOW_HOURS} ساعة.
التفاصيل: https://qatlia.ma`,
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
