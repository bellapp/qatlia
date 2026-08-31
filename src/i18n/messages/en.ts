import type { Catalog } from './fr';

export const en: Catalog = {
  nav: {
    brandAria: 'QatlIA — home',
    login: 'Sign in',
    tryFree: 'Try it free',
    languageAria: 'Choose a language',
    languageOptionAria: 'View the site in {language}',
    lightMode: 'Light mode',
    darkMode: 'Dark mode',
  },
  language: {
    fr: 'French',
    en: 'English',
    ar: 'Arabic',
  },
  hero: {
    badge: 'Cutting optimization for woodworkers',
    titleLead: 'Optimize your panels',
    titleHighlight: 'in seconds',
    subtitle:
      'Cut your offcuts by up to {waste}. Scan your cut lists, optimize the nesting, export a shop-floor PDF plan.',
    wasteFigure: '75%',
    ctaPrimary: 'Try it free',
    ctaSecondary: 'I already have an account',
    note: '{count} free photo-analysis credits when you sign up · Optimization and exports are free · No credit card',
  },
  stats: {
    waste: { value: '75', unit: '%', label: 'Less waste on your panels' },
    surface: { value: '90', unit: '%', label: 'Usable area optimized on average' },
    time: { value: '2', unit: 'min', label: 'To generate a complete plan' },
    credits: { value: '5', unit: 'credits', label: 'Free when you sign up' },
  },
  features: {
    eyebrow: 'Features',
    title: 'Everything your workshop needs',
    scan: {
      title: 'AI handwriting scan',
      desc: 'Photograph your measurement notebook. The AI extracts the dimensions automatically.',
    },
    guillotine: {
      title: 'Guillotine cuts',
      desc: 'Edge-to-edge straight-cut algorithm, the standard in joinery workshops.',
    },
    report: {
      title: 'Pro PDF report',
      desc: 'Cut plan with dimensions, bill of materials and offcuts. Ready for the shop or the client.',
    },
    waste: {
      title: 'Less offcut waste',
      desc: 'See your waste rate and usable area. Less loss means more margin.',
    },
  },
  steps: {
    eyebrow: 'How it works',
    title: 'Three steps, one perfect plan',
    one: {
      title: 'Add your pieces',
      desc: 'Scan a cut list or type the dimensions in manually, in centimetres.',
    },
    two: {
      title: 'Run the optimization',
      desc: 'The algorithm computes the best nesting in a few seconds.',
    },
    three: {
      title: 'Export the report',
      desc: 'Download the PDF with the cut plan and the bill of materials.',
    },
  },
  finalCta: {
    title: 'Ready to optimize your workshop?',
    body: 'Start free with {count} photo-analysis credits. Optimization and exports stay free. No credit card, no commitment.',
    button: 'Try QatlIA now',
  },
  footer: {
    brand: 'QatlIA Pro',
    tagline: 'Morocco · MAD · Cutting optimization for woodworkers',
  },
};
