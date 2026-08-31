import type { Catalog } from './fr';

export const ar: Catalog = {
  nav: {
    brandAria: 'QatlIA — الصفحة الرئيسية',
    login: 'تسجيل الدخول',
    tryFree: 'جرّب مجاناً',
    languageAria: 'اختر اللغة',
    languageOptionAria: 'عرض الموقع بـ{language}',
    lightMode: 'الوضع الفاتح',
    darkMode: 'الوضع الداكن',
  },
  language: {
    fr: 'الفرنسية',
    en: 'الإنجليزية',
    ar: 'العربية',
  },
  hero: {
    badge: 'تحسين القطع للنجارين',
    titleLead: 'حسِّن ألواحك',
    titleHighlight: 'في ثوانٍ معدودة',
    subtitle:
      'قلّل الهدر حتى {waste}. صوّر قوائم القياسات، حسِّن ترتيب القطع، وصدّر مخطط القطع بصيغة PDF جاهزة للورشة.',
    // Morocco writes numbers with Western digits, not Eastern Arabic ones.
    wasteFigure: '75%',
    ctaPrimary: 'جرّب مجاناً',
    ctaSecondary: 'لديّ حساب بالفعل',
    note: '{count} أرصدة لتحليل الصور مجاناً عند التسجيل · التحسين والتصدير مجانيان · بدون بطاقة بنكية',
  },
  stats: {
    waste: { value: '75', unit: '%', label: 'هدر أقل في ألواحك' },
    surface: { value: '90', unit: '%', label: 'مساحة مستغلة محسّنة في المتوسط' },
    time: { value: '2', unit: 'دقيقة', label: 'لإنشاء مخطط كامل' },
    credits: { value: '5', unit: 'أرصدة', label: 'مجاناً عند التسجيل' },
  },
  features: {
    eyebrow: 'الميزات',
    title: 'كل ما تحتاجه ورشتك',
    scan: {
      title: 'قراءة الخط اليدوي بالذكاء الاصطناعي',
      desc: 'صوّر دفتر القياسات، ويستخرج الذكاء الاصطناعي الأبعاد تلقائياً.',
    },
    guillotine: {
      title: 'قطع المقصلة',
      desc: 'خوارزمية قطع مستقيم من طرف إلى طرف، وهي المعيار في ورش النجارة.',
    },
    report: {
      title: 'تقرير PDF احترافي',
      desc: 'مخطط قطع بالأبعاد وقائمة المواد والبواقي. جاهز للورشة أو للزبون.',
    },
    waste: {
      title: 'تقليل البواقي',
      desc: 'اطّلع على نسبة الهدر والمساحة المستغلة. خسارة أقل تعني ربحاً أكبر.',
    },
  },
  steps: {
    eyebrow: 'كيف يعمل',
    title: 'ثلاث خطوات ومخطط مثالي',
    one: {
      title: 'أضف قطعك',
      desc: 'امسح قائمة القياسات أو أدخل الأبعاد يدوياً بالسنتيمتر.',
    },
    two: {
      title: 'شغّل التحسين',
      desc: 'تحسب الخوارزمية أفضل ترتيب للقطع في ثوانٍ.',
    },
    three: {
      title: 'صدّر التقرير',
      desc: 'حمّل ملف PDF مع مخطط القطع وقائمة المواد.',
    },
  },
  finalCta: {
    title: 'هل أنت مستعد لتحسين ورشتك؟',
    body: 'ابدأ مجاناً مع {count} أرصدة لتحليل الصور. يبقى التحسين والتصدير مجانيين. بدون بطاقة بنكية وبدون التزام.',
    button: 'جرّب QatlIA الآن',
  },
  footer: {
    brand: 'QatlIA Pro',
    tagline: 'المغرب · درهم · تحسين القطع للنجارين',
  },
};
