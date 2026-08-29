'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { Globe } from 'lucide-react';

// Inline messages to avoid import issues
const messages: Record<string, Record<string, string>> = {
  fr: {
    'app.title': 'QatlIA Pro — Optimisation de Découpe',
    'app.tryFree': 'Essayer gratuitement',
    'app.login': 'Connexion',
    'app.logout': 'Déconnexion',
    'app.account': 'Mon compte',
    'app.history': 'Historique',
    'app.credits': 'Crédits',
    'landing.heroTitle': 'Optimisez vos panneaux en quelques secondes',
    'landing.heroSubtitle': 'Réduisez vos chutes jusqu\'à 75%.',
    'landing.cta': 'Essayer QatlIA maintenant',
    'atelier.quickActions': 'Actions rapides',
    'atelier.takePhoto': 'Prendre une photo',
    'atelier.loadImage': 'Charger une image',
    'atelier.visionBadge': 'Vision IA',
    'atelier.stockPanel': 'Panneau brut',
    'atelier.pieces': 'Pièces à découper',
    'atelier.addPiece': 'Ajouter une pièce',
    'atelier.optimize': 'Optimiser',
    'atelier.advancedOptions': 'Réglages de coupe avancés',
    'atelier.results': 'Résultats',
    'atelier.exportPdf': 'Exporter le rapport PDF',
    'common.guide': 'Guide',
    'common.search': 'Rechercher',
    'common.delete': 'Supprimer',
    'common.cancel': 'Annuler',
    'common.save': 'Enregistrer',
    'common.loading': 'Chargement…',
    'common.error': 'Erreur',
    'common.cm': 'cm',
    'common.mm': 'mm',
    'common.qty': 'Qté',
    'common.ref': 'Réf.',
    'common.height': 'H',
    'common.width': 'L',
  },
  en: {
    'app.title': 'QatlIA Pro — Cutting Optimization',
    'app.tryFree': 'Try for free',
    'app.login': 'Sign in',
    'app.logout': 'Sign out',
    'app.account': 'My account',
    'app.history': 'History',
    'app.credits': 'Credits',
    'landing.heroTitle': 'Optimize your panels in seconds',
    'landing.heroSubtitle': 'Reduce waste by up to 75%.',
    'landing.cta': 'Try QatlIA now',
    'atelier.quickActions': 'Quick Actions',
    'atelier.takePhoto': 'Take a photo',
    'atelier.loadImage': 'Load an image',
    'atelier.visionBadge': 'AI Vision',
    'atelier.stockPanel': 'Stock panel',
    'atelier.pieces': 'Pieces to cut',
    'atelier.addPiece': 'Add a piece',
    'atelier.optimize': 'Optimize',
    'atelier.advancedOptions': 'Advanced cut settings',
    'atelier.results': 'Results',
    'atelier.exportPdf': 'Export PDF report',
    'common.guide': 'Guide',
    'common.search': 'Search',
    'common.delete': 'Delete',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.loading': 'Loading…',
    'common.error': 'Error',
    'common.cm': 'cm',
    'common.mm': 'mm',
    'common.qty': 'Qty',
    'common.ref': 'Ref.',
    'common.height': 'H',
    'common.width': 'W',
  },
  ar: {
    'app.title': 'QatlIA Pro — تحسين القطع',
    'app.tryFree': 'جرب مجاناً',
    'app.login': 'تسجيل الدخول',
    'app.logout': 'تسجيل الخروج',
    'app.account': 'حسابي',
    'app.history': 'السجل',
    'app.credits': 'الرصيد',
    'landing.heroTitle': 'حسِّن ألواحك في ثوانٍ',
    'landing.heroSubtitle': 'قلل الهدر حتى 75٪.',
    'landing.cta': 'جرب QatlIA الآن',
    'atelier.quickActions': 'إجراءات سريعة',
    'atelier.takePhoto': 'التقاط صورة',
    'atelier.loadImage': 'تحميل صورة',
    'atelier.visionBadge': 'الرؤية الذكية',
    'atelier.stockPanel': 'اللوح الخام',
    'atelier.pieces': 'القطع',
    'atelier.addPiece': 'أضف قطعة',
    'atelier.optimize': 'حسِّن',
    'atelier.advancedOptions': 'إعدادات متقدمة',
    'atelier.results': 'النتائج',
    'atelier.exportPdf': 'تصدير PDF',
    'common.guide': 'دليل',
    'common.search': 'بحث',
    'common.delete': 'حذف',
    'common.cancel': 'إلغاء',
    'common.save': 'حفظ',
    'common.loading': 'جارٍ التحميل…',
    'common.error': 'خطأ',
    'common.cm': 'سم',
    'common.mm': 'مم',
    'common.qty': 'العدد',
    'common.ref': 'مرجع',
    'common.height': 'إ',
    'common.width': 'ع',
  },
};

export type Locale = 'fr' | 'en' | 'ar';
export const locales: Locale[] = ['fr', 'en', 'ar'];

const LOCALE_LABELS: Record<Locale, string> = { fr: 'FR', en: 'EN', ar: 'AR' };

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (path: string) => string;
  dir: 'ltr' | 'rtl';
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'fr', setLocale: () => {},
  t: (p: string) => p, dir: 'ltr',
});

export function useLocale() { return useContext(LocaleContext); }

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('fr');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem('qatlia-locale') as Locale | null;
    if (stored && locales.includes(stored)) setLocaleState(stored);
    else {
      const nav = navigator.language?.slice(0, 2);
      if (nav === 'ar') setLocaleState('ar');
      else if (nav === 'en') setLocaleState('en');
    }
  }, []);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    localStorage.setItem('qatlia-locale', l);
    document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = l;
  };

  const t = (path: string) => {
    const msgs = messages[locale];
    return msgs?.[path] || path;
  };

  if (!mounted) return <>{children}</>;

  return (
    <LocaleContext.Provider value={{
      locale, setLocale, t,
      dir: locale === 'ar' ? 'rtl' : 'ltr',
    }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function LocaleSwitcher({ className = '' }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  return (
    <div className={`flex items-center gap-0.5 ${className}`}>
      <Globe className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 mr-1" />
      {locales.map(l => (
        <button
          key={l}
          onClick={() => setLocale(l)}
          className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${
            locale === l
              ? 'bg-brand-500 text-slate-950'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          {LOCALE_LABELS[l]}
        </button>
      ))}
    </div>
  );
}