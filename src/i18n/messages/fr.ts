/**
 * French is the reference catalog: every other locale is typed as `Catalog`,
 * so adding, renaming or dropping a key here is a compile error everywhere
 * else until the translations follow. Keep the tree shallow and grouped by the
 * surface that renders it.
 */
export const fr = {
  nav: {
    brandAria: 'QatlIA — accueil',
    login: 'Connexion',
    tryFree: 'Essayer gratuitement',
    languageAria: 'Choisir la langue',
    languageOptionAria: 'Afficher le site en {language}',
    lightMode: 'Mode clair',
    darkMode: 'Mode sombre',
  },
  language: {
    fr: 'français',
    en: 'anglais',
    ar: 'arabe',
  },
  hero: {
    badge: 'Optimisation de découpe pour menuisiers',
    titleLead: 'Optimisez vos panneaux',
    titleHighlight: 'en quelques secondes',
    // Rendered in two parts around {waste} so the figure stays bold.
    subtitle:
      'Réduisez vos chutes jusqu’à {waste}. Scannez vos fiches de débit, optimisez le placement, exportez votre plan en PDF industriel.',
    wasteFigure: '75 %',
    ctaPrimary: 'Essayer gratuitement',
    ctaSecondary: 'J’ai déjà un compte',
    note: '{count} crédits d’analyse photo offerts à l’inscription · Optimisation et exports gratuits · Sans carte bancaire',
  },
  stats: {
    waste: { value: '75', unit: '%', label: 'Moins de chutes sur vos panneaux' },
    surface: { value: '90', unit: '%', label: 'Surface utile optimisée en moyenne' },
    time: { value: '2', unit: 'min', label: 'Pour générer un plan complet' },
    credits: { value: '5', unit: 'crédits', label: 'Offerts à l’inscription' },
  },
  features: {
    eyebrow: 'Fonctionnalités',
    title: 'Tout ce dont votre atelier a besoin',
    scan: {
      title: 'Scan manuscrit IA',
      desc: 'Photographiez votre carnet de mesures. L’IA extrait automatiquement les cotes.',
    },
    guillotine: {
      title: 'Coupe guillotine',
      desc: 'Algorithme de coupe linéaire traversante, le standard des ateliers de menuiserie.',
    },
    report: {
      title: 'Rapport PDF pro',
      desc: 'Plan de coupe avec cotes, nomenclature, chutes. Prêt pour l’atelier ou le client.',
    },
    waste: {
      title: 'Réduction des chutes',
      desc: 'Visualisez le taux de chute et la surface utile. Moins de perte = plus de rentabilité.',
    },
  },
  steps: {
    eyebrow: 'Comment ça marche',
    title: 'Trois étapes, un plan parfait',
    one: {
      title: 'Ajoutez vos pièces',
      desc: 'Scannez une fiche ou saisissez les dimensions manuellement en centimètres.',
    },
    two: {
      title: 'Lancez l’optimisation',
      desc: 'L’algorithme calcule le placement optimal en quelques secondes.',
    },
    three: {
      title: 'Exportez le rapport',
      desc: 'Téléchargez le PDF avec le plan de coupe et la nomenclature.',
    },
  },
  finalCta: {
    title: 'Prêt à optimiser votre atelier ?',
    body: 'Commencez gratuitement avec {count} crédits d’analyse photo. L’optimisation et les exports restent gratuits. Pas de carte bancaire, pas d’engagement.',
    button: 'Essayer QatlIA maintenant',
  },
  footer: {
    brand: 'QatlIA Pro',
    tagline: 'Maroc · MAD · Optimisation de découpe pour menuisiers',
  },
};

export type Catalog = typeof fr;
