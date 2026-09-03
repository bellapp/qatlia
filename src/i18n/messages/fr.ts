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
    tryFreeShort: 'Essayer',
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
    // Slogan 1 (client copy): gain framed in two beats, second beat highlighted.
    taglineGain: 'Plus de panneaux rentabilisés,',
    taglineSave: 'moins de bois gaspillé',
    // Slogan 2 (client copy): three action beats, rendered as a standalone band.
    actionSlogan: 'Mesurez. Prenez la photo. Économisez',
    // No promised waste percentage: QatlIA reports the chute rate it actually
    // measured on the artisan's own plan, and never a fleet-wide average it
    // has no measurement for.
    subtitle:
      'Scannez vos fiches de débit, optimisez le placement, exportez votre plan en PDF industriel. Le taux de chute affiché est celui calculé sur votre plan.',
    ctaPrimary: 'Essayer gratuitement',
    ctaSecondary: 'J’ai déjà un compte',
    note: '{count} crédits d’analyse photo offerts à l’inscription · Optimisation et exports gratuits · Sans carte bancaire',
  },
  // Each tile states something the product can actually demonstrate. Only the
  // credit count is a figure, and it is the one the sign-up flow really grants.
  stats: {
    waste: { title: 'Chutes mesurées', label: 'Le taux de chute vient de votre plan, pas d’une moyenne annoncée.' },
    surface: { title: 'Surface utile calculée', label: 'Calculée à partir des pièces réellement placées sur vos panneaux.' },
    time: { title: 'Plan en quelques secondes', label: 'De la liste de pièces au plan de coupe, sans attente.' },
    credits: { title: '{count} crédits offerts', label: 'Analyses photo offertes à l’inscription.' },
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
  common: {
    cancel: 'Annuler',
    add: 'Ajouter',
    close: 'Fermer',
    delete: 'Supprimer',
    yes: 'Oui',
    no: 'Non',
    loading: 'Chargement…',
  },
  /**
   * Display labels for the `MaterialType` enum. The stable values (`mdf`,
   * `verre`, …) are what the optimizer, the API schema and every saved project
   * carry; only these labels are ever translated.
   */
  materials: {
    mdf: 'MDF / Bois',
    melamine: 'Mélaminé Blanc',
    chene: 'Chêne Massif',
    contreplaques: 'Contreplaqué',
    stratifie: 'Stratifié',
    medium: 'Médium (MDF Sup.)',
    aluminium: 'Aluminium',
    verre: 'Verre',
    /**
     * Short form for the badges of the history cards, where the full label does
     * not fit. `mdf` stays the industry abbreviation in every locale.
     */
    badge: {
      mdf: 'MDF',
      melamine: 'Mélaminé',
      chene: 'Chêne',
      contreplaques: 'CTP',
      stratifie: 'Stratifié',
      medium: 'Médium',
      aluminium: 'Alu',
      verre: 'Verre',
    },
  },
  atelier: {
    header: {
      tagline: 'Atelier de découpe & calepinage',
      actionsAria: 'Actions de coupe',
      cutMode2dAria: 'Découpe 2D — panneaux',
      cutMode1dAria: 'Découpe 1D — barres',
      history: 'Historique',
      credits: 'crédits',
      creditsAria: 'Crédits d’analyse photo restants',
    },
    /**
     * Name given to the project saved after an optimization. `{material}` is the
     * stable `MaterialType` value upper-cased, not a translated label: it is what
     * the history list, `/api/projects` and the PDF all identify the record by.
     */
    project: {
      nameBars: 'Barres {material} — {count} pcs',
      nameSheets: 'Débit {material} — {count} pcs',
    },
    scan: {
      cameraTitle: 'Appareil photo',
      cameraDesc: 'Scanner une fiche de débit papier',
      cameraBadge: '📷 Scan IA',
      uploadTitle: 'Importer un fichier',
      uploadDesc: 'Photo, scan ou capture d’écran',
      visionBadge: 'Vision IA · Extraction automatique',
      previewAlt: 'Aperçu de la fiche de débit scannée',
      analyzedTitle: 'Fiche analysée',
      analyzedCount: { one: '{count} cote extraite', many: '{count} cotes extraites' },
      processingTitle: 'Analyse en cours…',
      processingDesc: 'Extraction des dimensions et quantités',
    },
    /** One entry per machine-readable code returned by /api/vision. */
    visionError: {
      generic: 'Aucune mesure détectée dans l’image.',
      network: 'Erreur réseau lors de l’analyse de l’image.',
      authRequired: 'Connectez-vous pour analyser une photo de fiche de débit.',
      invalidInput: 'Cette image ne peut pas être analysée. Utilisez une photo JPG, PNG ou WebP.',
      rateLimited: 'Trop d’analyses en peu de temps. Patientez un instant avant de réessayer.',
      visionUnavailable: 'L’analyse photo est momentanément indisponible. Réessayez dans un instant.',
      creditLedgerUnavailable: 'Le décompte des crédits est indisponible. Réessayez dans un instant.',
      insufficientCredits: 'Votre solde de crédits est épuisé. Rechargez votre compte pour analyser une nouvelle photo.',
      aiRateLimit: 'Service temporairement saturé. Veuillez réessayer dans un instant.',
      aiServiceError: 'Erreur d’analyse. Veuillez réessayer avec une photo plus nette.',
      aiParseError: 'Aucune mesure lisible n’a été détectée. Vérifiez que la photo est nette et bien cadrée.',
      processingFailed: 'L’analyse a échoué. Réessayez avec une photo plus nette.',
    },
    stock: {
      titleBar: 'Barre en stock',
      titleSheet: 'Panneau brut en stock',
      subtitleBar: 'Longueur de la barre',
      subtitleSheet: 'Dimensions du panneau',
      unitGroupAria: 'Unité d’affichage du projet',
      presetAria: 'Choisir un panneau prédéfini',
      presetPlaceholder: 'Panneaux prédéfinis…',
      presetBuiltIn: 'Tailles standards',
      presetSaved: 'Mes panneaux sauvegardés',
      savePreset: 'Sauvegarder',
      savePresetAria: 'Sauvegarder le panneau actuel comme préréglage',
      managePresets: 'Gérer',
      deletePresetAria: 'Supprimer ce panneau sauvegardé',
      heightLabel: 'Hauteur (Y) — {unit}',
      widthLabel: 'Largeur (X) — {unit}',
      lengthLabel: 'Longueur ({unit})',
      heightAria: 'Hauteur {unit}',
      widthAria: 'Largeur {unit}',
      lengthAria: 'Longueur {unit}',
      materialLabel: 'Matériau',
      materialAria: 'Matériau du panneau',
    },
    advanced: {
      toggle: 'Réglages de coupe avancés',
    },
    optimize: {
      running: 'Calcul du calepinage…',
      cta: 'Optimiser le plan de coupe',
    },
    cost: {
      bannerLabel: 'Coût total estimé',
      currency: 'MAD',
      amount: '{value} MAD',
      bannerMeta: '{meters} m linéaires de coupe · {sheets}',
      sheetsCount: { one: '{count} panneau', many: '{count} panneaux' },
      breakdownTitle: 'Estimation du coût',
      panels: 'Panneaux',
      edges: 'Chants',
      labor: 'Main d’œuvre',
      total: 'Total',
    },
    metrics: {
      sheets: 'Feuilles',
      usable: 'Utile',
      usableSub: 'surface',
      waste: 'Chute',
      wasteSub: 'résiduelle',
      pieces: 'Pièces',
      piecesSub: 'placées',
    },
    plan: {
      sheetTab: 'Panneau {index}',
      zoomOut: 'Zoom arrière',
      zoomIn: 'Zoom avant',
      zoomLevelAria: 'Niveau de zoom',
    },
    exports: {
      csv: 'CSV',
      json: 'JSON',
      png: 'PNG',
      dxf: 'DXF',
      csvAria: 'Télécharger les mesures des pièces au format CSV (Excel)',
      jsonAria: 'Télécharger le plan au format JSON',
      pngAria: 'Télécharger le plan au format PNG',
      dxfAria: 'Télécharger le plan au format DXF pour CNC',
      pdfGenerating: 'Génération…',
      pdf: 'Exporter le rapport PDF',
      /** Default PDF project title when the artisan never named the project. */
      pdfDefaultProjectName: 'Plan Découpe QatlIA',
    },
    cutOrder: {
      title: 'Ordre de coupe',
      count: { one: '{count} pièce', many: '{count} pièces' },
      number: '#',
      piece: 'Pièce',
      dimensions: 'H × L ({unit})',
      rotation: 'Rotation',
      rotated: 'Oui (90°)',
      notRotated: 'Non',
    },
    offcuts: {
      title: 'Chutes ({count})',
      item: 'Chute #{index}',
    },
  },
  pieces: {
    filterPlaceholder: 'Filtrer...',
    filterAria: 'Filtrer les pièces',
    counts: '{qty} pcs · {rows}',
    rowCount: { one: '{count} ligne', many: '{count} lignes' },
    pasteExcel: 'Coller Excel',
    templates: 'Modèles',
    deselectAll: 'Désél.',
    selectAll: 'Tout',
    swapAll: 'Permuter tout',
    swapAllTitle: 'Permuter hauteur ↔ largeur de toutes les pièces (ou de la sélection)',
    swapAllAria: 'Permuter hauteur et largeur de toutes les pièces',
    deleteSelectedAria: 'Supprimer la sélection',
    exportCsv: 'Exporter en CSV',
    // Column names of the exported file. Only the header row is localized: the
    // data rows below it stay canonical (figures, piece name, hex color), so an
    // export opened in any language still describes the same cut list.
    exportCsvHeader: 'Numéro,Hauteur ({unit}),Largeur ({unit}),Quantité,Référence,Couleur',
    addPiece: 'Ajouter une pièce',
    import: {
      label: 'Coller une liste de pièces',
      // The `{format}` token is a data format, not prose: the import parser
      // only recognises those French column headers, so it is rendered
      // verbatim in every locale (see PiecesManager).
      formatHint: 'Format accepté : {format} ou collage Excel avec tabulations.',
      unitLabel: 'Unité des dimensions collées',
      // Sample piece name shown in the textarea placeholder. Only the name is
      // translated: the column separators and the figures around it are the
      // format the parser reads.
      exampleName: 'Joue TV',
      submit: 'Importer',
      importedCount: { one: '{count} pièce importée', many: '{count} pièces importées' },
      ignoredCount: { one: '{count} ligne ignorée', many: '{count} lignes ignorées' },
      summary: '{imported} · {ignored}',
    },
    template: {
      label: 'Ajouter un modèle de meuble',
      hint: 'Chaque choix ajoute des pièces prêtes à optimiser, sans remplacer la liste existante.',
      // `{name}` is the stable template value, never translated.
      option: '{name} · {count} pièces',
      added: {
        one: '{count} pièce ajoutée depuis {template}.',
        many: '{count} pièces ajoutées depuis {template}.',
      },
      empty: 'Le modèle sélectionné ne contient aucune pièce.',
    },
    feedback: {
      noneValid: 'Aucune pièce valide à ajouter.',
      invalidDimensions: 'Renseignez des dimensions valides en {unit}.',
      addedOne: '1 pièce ajoutée.',
      addedNone: 'Aucune pièce ajoutée.',
    },
    columns: {
      number: '#',
      piece: 'Pièce',
      dimensions: 'H × L ({unit})',
      quantity: 'Qté',
      edges: 'Chants',
      color: 'Coul.',
    },
    empty: {
      filtered: 'Aucun résultat pour ce filtre.',
      none: 'Aucune pièce. Ajoutez la première ci-dessous.',
    },
    row: {
      selectAria: 'Sélectionner',
      namePlaceholder: 'Nom',
      heightAria: 'Hauteur {unit}',
      widthAria: 'Largeur {unit}',
      quantityAria: 'Quantité',
      colorLabel: 'Couleur de la pièce',
      colorAria: 'Couleur {name}',
      fallbackName: 'pièce {index}',
      swapTitle: 'Permuter hauteur ↔ largeur',
      swapAria: 'Permuter hauteur et largeur de {name}',
      deleteAria: 'Supprimer',
      materialAria: 'Matériau : {material}',
    },
    edge: {
      left: 'Gauche',
      right: 'Droite',
      top: 'Haut',
      bottom: 'Bas',
      leftShort: 'G',
      rightShort: 'D',
      topShort: 'H',
      bottomShort: 'B',
      title: 'Chant {side}',
    },
    edgeBanding: {
      none: 'Aucun',
      white: 'Blanc',
      beech: 'Hêtre',
      oak: 'Chêne',
      grey: 'Gris',
      black: 'Noir',
      walnut: 'Noyer',
      price: ' ({price} MAD/m)',
      selectAria: 'Couleur du chant',
    },
    quickAdd: {
      heightLabel: 'H ({unit})',
      widthLabel: 'L ({unit})',
      quantityLabel: 'Qté',
      nameLabel: 'Nom',
      namePlaceholder: 'ex: Côté G',
      submitAria: 'Ajouter la pièce',
      edgesLabel: 'Chants :',
      colorLabel: 'Couleur',
    },
  },
  options: {
    kerf: {
      tooltip: 'Épaisseur de matière retirée par le trait de scie entre chaque coupe. Standard : 3 mm pour lame carbure.',
      title: 'Épaisseur de lame (Kerf)',
      desc: 'Trait de scie retiré entre chaque coupe',
      unit: 'mm',
      aria: 'Épaisseur de lame en millimètres',
      scaleMax: '10 mm',
    },
    priority: {
      tooltip: 'Algorithme de placement : Guillotine = coupes droites traversantes (standard atelier). Min chutes = meilleur rendement surface.',
      aria: 'Objectif d’optimisation',
      linearGuillotine: 'Coupe linéaire traversante (atelier)',
      minWaste: 'Minimiser les chutes (%)',
      minSheets: 'Minimiser les panneaux',
      balanced: 'Équilibré (facilité de coupe)',
    },
    labels: {
      label: 'Étiquettes sur les pièces',
      desc: 'N° et dimensions visibles sur le plan',
      tooltip: 'Affiche le numéro et les dimensions (H×L) au centre de chaque pièce sur le schéma de coupe.',
    },
    singleSheet: {
      label: 'Mode 1 feuille unique',
      desc: 'Limite stricte, alerte si des pièces restent',
      tooltip: 'Force l’optimisation sur un seul panneau. Utile si vous n’avez qu’une chute à optimiser.',
    },
    multiMaterial: {
      label: 'Répartition multi-matériaux',
      desc: 'Isole MDF, aluminium et verre',
      tooltip: 'Sépare les pièces par matériau. Chaque matériau est optimisé sur ses propres panneaux.',
    },
    grain: {
      label: 'Verrouiller le sens du fil',
      desc: 'Interdit la rotation 90° des pièces',
      tooltip: 'Empêche la rotation des pièces. À activer pour le bois massif ou le stratifié avec sens de veinage.',
    },
    pricing: {
      tooltip: 'Tarifs utilisés pour le chiffrage. Par défaut : main d’œuvre à 0 MAD, panneau au tarif catalogue du matériau.',
      title: 'Tarification',
      laborLabel: 'Main d’œuvre / découpe',
      laborModeAria: 'Mode de tarification de la main d’œuvre',
      laborValueAria: 'Montant de la main d’œuvre',
      laborFixed: 'Forfait (MAD)',
      laborPerMeter: 'Au mètre (MAD/m)',
      stockOverride: 'Remplacer le tarif catalogue du panneau',
      stockModeAria: 'Mode de tarification du panneau',
      stockValueAria: 'Prix du panneau',
      stockPerM2: 'MAD / m²',
      stockPerSheet: 'MAD / panneau',
    },
  },
  emptyState: {
    loadingAria: 'Chargement du plan de coupe',
    noResultsTitle: 'Aucun résultat',
    noResultsBody: 'Aucun projet ne correspond à cette recherche. Essayez un autre filtre.',
    readyTitle: 'Prêt pour le calepinage',
    readyBody: 'Ajoutez vos pièces et lancez l’optimisation pour visualiser le plan de coupe 2D.',
    step1: '1. Photo',
    step1Desc: 'Scannez une fiche',
    step2: '2. Pièces',
    step2Desc: 'Ajoutez les dimensions',
    step3: '3. Optimiser',
    step3Desc: 'Générez le plan',
  },
  tour: {
    button: 'Guide',
    buttonTitle: 'Visite guidée',
    /**
     * Popover chrome of driver.js. `{current}`/`{total}` are filled by the
     * library itself (it counts the steps), so the copy stays translatable
     * without the component ever hardcoding "sur 4".
     */
    next: 'Suivant',
    previous: 'Précédent',
    done: 'Terminer',
    progress: 'Étape {current} sur {total}',
    step1Title: '1. Importez vos données',
    step1Desc: 'Scannez une fiche de débit avec la caméra, ou ajoutez les pièces manuellement.',
    step2Title: '2. Gérez vos pièces',
    step2Desc: 'Ajoutez, modifiez ou supprimez les pièces. Indiquez la hauteur, largeur et quantité.',
    step3Title: '3. Lancez l’optimisation',
    step3Desc: 'Cliquez sur Optimiser pour calculer le placement optimal. Ajustez les options avancées.',
    step4Title: '4. Exportez votre plan',
    step4Desc: 'Téléchargez le rapport PDF, DXF pour CNC, PNG ou JSON. Visualisez le coût estimé.',
  },
  account: {
    menuAria: 'Menu du compte {email}',
    sectionTitle: 'Compte atelier',
    myAccount: 'Mon compte',
    creditsUsage: 'Usage des crédits',
    changePassword: 'Changer le mot de passe',
    logout: 'Déconnexion',
  },
  auth: {
    defaultTitle: 'Télécharger le rapport PDF',
    defaultSubtitle: '{count} crédits offerts à la création du compte.',
    loginSubtitle: 'Connectez-vous pour enregistrer ce débit et exporter.',
    perk: 'Historique cloud + {count} crédits Vision à l’inscription',
    google: 'Continuer avec Google',
    googleRedirect: 'Redirection Google…',
    googleError: 'Erreur lors de la connexion Google',
    genericError: 'Une erreur est survenue',
    /**
     * Customer-facing copy for the Supabase auth failures an artisan can
     * actually trigger. The upstream messages are English server strings and
     * are never shown: `authErrorKey()` maps message and code variants onto
     * these keys, and anything unrecognised falls back to `genericError`.
     */
    errors: {
      invalidCredentials: 'Email ou mot de passe incorrect.',
      alreadyRegistered: 'Un compte existe déjà avec cet email. Connectez-vous.',
      emailNotConfirmed: 'Confirmez votre email avant de vous connecter.',
      weakPassword: 'Le mot de passe doit contenir au moins {min} caractères.',
      rateLimited: 'Trop de tentatives. Réessayez dans quelques minutes.',
    },
    orEmail: 'ou email',
    namePlaceholder: 'Nom d’atelier',
    emailLabel: 'Adresse email',
    emailPlaceholder: 'artisan@atelier.ma',
    passwordPlaceholder: 'Mot de passe',
    showPassword: 'Afficher le mot de passe',
    hidePassword: 'Masquer le mot de passe',
    submitLogin: 'Se connecter & exporter',
    submitSignup: 'Créer le compte',
    switchToSignup: 'Créer un compte (+ {count} crédits)',
    switchToLogin: 'Déjà un compte ? Se connecter',
  },
  /**
   * Wording for the packs of `src/lib/billing/catalog.ts`, keyed by the stable
   * `PackId`. The catalog stays the single source of truth for the figures: the
   * MAD price arrives as `{price}` and the monthly allowance as `{count}`, so a
   * translation can never promise an amount the ledger will not honour.
   */
  billing: {
    packs: {
      starter: {
        name: 'Pack Découverte',
        description: 'Idéal pour tester ou pour 1 petit chantier',
        badge: '{price} DH',
      },
      standard: {
        name: 'Pack Artisan',
        description: 'Le choix populaire des menuisiers actifs',
        badge: 'Populaire ({price} DH)',
      },
      pro: {
        name: 'Pack Atelier Pro',
        description: 'Pour les ateliers à fort volume de débit',
        badge: 'Économique ({price} DH)',
      },
      atelierMax: {
        name: 'Abonnement Atelier Max',
        description: '{count} analyses photo IA par mois, pour les ateliers à très fort volume',
        badge: '{price} DH / mois',
        renewal: '{count} crédits ajoutés à votre solde chaque mois',
      },
    },
  },
  creditsPage: {
    back: 'Retour au Dashboard',
    balanceUnknown: 'Solde indisponible',
    balance: { one: 'Solde actuel : {count} crédit', many: 'Solde actuel : {count} crédits' },
    eyebrow: 'Recharge de Crédits',
    // `{price}` is the entry pack's MAD price and `{count}` its credits, both
    // read from the billing catalog.
    headline: '{price} = {count} analyses photo',
    policy:
      '1 crédit est débité uniquement lors d’une analyse photo réussie. L’optimisation du schéma et tous les exports (PDF, DXF, JSON, PNG, devis) sont gratuits et illimités.',
    recommended: 'Recommandé',
    /** Dirham symbol as printed on the cards; identical in every locale. */
    currency: 'DH',
    perMonth: '/mois',
    // Rendered in two parts around {count} so the allowance stays bold.
    packAnalyses: '{count} analyses photo',
    packAnalysesMonthly: '{count} analyses photo par mois',
    freePlans: 'Schémas de coupe illimités et gratuits',
    freeExports: 'Exports PDF, DXF, JSON et PNG gratuits',
    choose: 'Choisir ce pack',
    chooseAria: 'Choisir le {pack}',
    redirecting: 'Redirection vers le paiement…',
    // Rendered around {provider} so the payment provider stays bold.
    securePayment: 'Paiement sécurisé par {provider} — cartes Visa / Mastercard, débitées en dirhams ({currency})',
    invoiceNote: 'Facture et reçu instantanés par email',
    /**
     * One entry per machine-readable code returned by /api/credits/checkout. The
     * route keeps answering in French for non-browser callers; the customer sees
     * their own language, and never the provider's own message.
     */
    errors: {
      authRequired: 'Connectez-vous pour acheter des crédits.',
      invalidSelection: 'Ce pack n’est plus disponible. Choisissez-en un autre.',
      unavailable: 'Le paiement est momentanément indisponible. Réessayez plus tard.',
      network: 'Erreur réseau. Vérifiez votre connexion et réessayez.',
      generic: 'Le paiement n’a pas pu être lancé. Réessayez dans un instant.',
    },
  },
  creditsSuccess: {
    title: 'Paiement reçu',
    body: 'Votre paiement a été reçu. Votre solde sera mis à jour dès confirmation du paiement.',
    balance: 'Solde de crédits mis à jour',
    demoTitle: 'Mode démonstration',
    demoBody:
      'Aucun paiement n’a été effectué et aucun crédit n’a été ajouté : le paiement n’est pas configuré sur cet environnement.',
    demoBalance: 'Solde inchangé',
    back: 'Retourner au Débit de Panneaux',
  },
  historyPage: {
    backToAtelier: 'Atelier',
    eyebrow: 'Atelier',
    heading: 'Vos débits',
    subtitle: 'Rouvrir un plan, relancer le calepinage ou réexporter le PDF.',
    refresh: 'Actualiser',
    loadingAria: 'Chargement de l’historique',
    filterPlaceholder: 'Filtrer par nom ou dimension...',
    filterAria: 'Filtrer les débits',
    materialFilterAria: 'Filtrer par matériau',
    allMaterials: 'Tous matériaux',
    resultCount: { one: '{count} résultat', many: '{count} résultats' },
    stats: {
      panel: 'Panneau',
      pieces: 'Pièces',
      waste: 'Chute',
    },
    // Canonical panel size. `{unit}` is the SI symbol, not prose.
    sheetSize: '{height} × {width} {unit}',
    piecesValue: '{count} pcs',
    sheetsUsed: { one: '{count} feuille', many: '{count} feuilles' },
    open: 'Ouvrir',
    openAria: 'Ouvrir le débit {name}',
    /** What the artisan is told when the cloud history is not the source shown. */
    sync: {
      localOnly: 'Plans enregistrés sur cet appareil. La sync cloud se fera dès que la base atelier sera prête.',
      cloudDisabled: 'Historique cloud pas encore activé — vos débits de cet appareil s’affichent ci-dessous.',
      cloudUnavailable: 'Historique cloud indisponible — affichage local.',
      offline: 'Impossible de joindre le serveur — historique local affiché.',
    },
  },
  accountPage: {
    eyebrow: 'Compte',
    title: 'Votre espace artisan',
    topUp: 'Recharger',
    creditsRemaining: 'crédits restants',
    ledgerAria: 'Mouvements de crédits',
    noMovements:
      'Aucun mouvement pour l’instant. Un crédit est débité uniquement lors d’une analyse photo réussie ; l’optimisation et les exports sont gratuits.',
    /** Shown only for a ledger row saved without its own description. */
    txDebit: 'Analyse photo IA',
    txCredit: 'Achat de crédits',
    googleNote: 'Si vous vous connectez uniquement via Google, un mot de passe n’est pas obligatoire.',
    newPassword: 'Nouveau mot de passe',
    confirmPassword: 'Confirmer',
    confirmPasswordAria: 'Confirmer le nouveau mot de passe',
    saving: 'Enregistrement…',
    submit: 'Mettre à jour le mot de passe',
    passwordUpdated: 'Mot de passe mis à jour.',
    errors: {
      tooShort: '{min} caractères minimum.',
      mismatch: 'Les mots de passe ne correspondent pas.',
      generic: 'La mise à jour du mot de passe a échoué. Réessayez.',
    },
  },
  loginPage: {
    brandTagline: 'Atelier de calepinage',
    eyebrow: 'Compte artisan',
    asideTitle: 'Vos plans de coupe, synchronisés.',
    asideBody:
      'Historique des débits, crédits Vision IA, export PDF industriel. Un compte, tous vos ateliers.',
    perkCredits: '{count} crédits offerts à l’inscription',
    perkHistory: 'Historique de chaque plan généré',
    perkSecurity: 'Connexion Google ou email sécurisée',
    asideFooter: 'QatlIA Pro · Maroc · MAD',
    titleSignup: 'Créer un compte',
    subtitleLogin: 'Retrouvez vos débits et crédits.',
    subtitleSignup: '{count} crédits offerts pour lancer vos premiers scans.',
    /** Sample workshop name; a name, so it is localized like the copy around it. */
    namePlaceholder: 'Menuiserie Atlas',
    submitLogin: 'Se connecter',
    signupPending: 'Compte créé. Vérifiez votre email, puis reconnectez-vous.',
    switchToSignup: 'Pas de compte ? Créer un compte (+ {count} crédits)',
    backToAtelier: 'Retour à l’atelier',
  },
  /**
   * The client-quotation dialog (Task 8). This UI can run in all three app
   * locales; the generated PDF *document* itself is only ever French or
   * Arabic (see src/lib/quotation.ts's `QUOTATION_LOCALES` and
   * src/lib/exports/quotation-catalog.ts) — `outputLocale` below is that
   * document-language choice, independent of the UI locale showing this
   * dialog.
   */
  quotation: {
    openButton: 'Devis client',
    openButtonAria: 'Générer un devis client au format PDF',
    title: 'Devis client',
    subtitle: 'Génère un devis PDF prêt à envoyer, à partir du chiffrage actuel du plan.',
    authRequired: 'Connectez-vous pour générer un devis client.',
    companySection: 'Votre entreprise',
    clientSection: 'Client',
    fields: {
      companyName: 'Nom de l’entreprise',
      companyAddress: 'Adresse',
      companyPhone: 'Téléphone',
      companyEmail: 'Email',
      companyIce: 'ICE',
      companyTaxId: 'IF',
      clientName: 'Nom du client',
      clientAddress: 'Adresse',
      clientPhone: 'Téléphone',
      clientEmail: 'Email',
      quoteNumber: 'N° de devis',
      issueDate: 'Date d’émission',
      expiryDate: 'Validité jusqu’au',
      /** Optional artisan-facing reference (e.g. a client's own order/PO number) — bounded, never required. */
      projectReference: 'Référence projet',
      notes: 'Notes',
    },
    delivery: {
      label: 'Livraison',
      amount: 'Montant (MAD)',
    },
    discount: {
      label: 'Remise',
      modeNone: 'Aucune',
      modePercentage: 'Pourcentage',
      modeFixed: 'Montant fixe',
      value: 'Valeur',
    },
    vat: {
      enable: 'Appliquer la TVA',
      rate: 'Taux (%)',
      disabledNote: 'Aucune TVA appliquée par défaut — cochez la case pour en ajouter une.',
    },
    outputLocale: {
      label: 'Langue du document',
      fr: 'Français',
      ar: 'Arabe',
    },
    amountInWords: 'Indiquer le montant en toutes lettres',
    logo: {
      label: 'Logo (optionnel)',
      hint: 'PNG ou JPEG, 500 Ko maximum.',
      remove: 'Retirer le logo',
      tooLarge: 'Ce fichier dépasse 500 Ko.',
      badType: 'Seuls les fichiers PNG ou JPEG sont acceptés.',
    },
    submit: 'Générer le PDF',
    generating: 'Génération…',
    savedToProject: 'Devis enregistré sur le projet.',
    notSaved: 'Devis généré (non enregistré sur un projet).',
    errors: {
      authRequired: 'Connectez-vous pour générer un devis.',
      rateLimited: 'Trop de devis générés en peu de temps. Patientez un instant avant de réessayer.',
      invalidLogo: 'Le logo est invalide (format ou taille non accepté).',
      invalidInput: 'Certains champs du devis sont invalides. Vérifiez le formulaire.',
      payloadTooLarge: 'Le devis est trop volumineux à envoyer. Raccourcissez les notes ou les détails.',
      amountInWordsTooLarge: 'Le montant total est trop élevé pour être exprimé en toutes lettres.',
      projectNotFound: 'Ce projet est introuvable.',
      generic: 'La génération du devis a échoué. Réessayez.',
      tooManyPanelGroups: 'Ce plan utilise {count} formats de panneaux distincts, plus que les {max} qu’un devis peut lister. Simplifiez le plan ou contactez le support.',
      tooManyPieceGroups: 'Ce plan utilise {count} formats de pièces distincts, plus que les {max} qu’un devis peut lister. Simplifiez le plan ou contactez le support.',
    },
    closeAria: 'Fermer',
  },
};

export type Catalog = typeof fr;
