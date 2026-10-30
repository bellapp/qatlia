/**
 * Terms, privacy policy and refund policy: the French reference.
 *
 * Kept apart from the UI catalog because it is long prose, and merged into it as
 * `legal` so the same `t()` lookup, placeholder checks and locale fallback apply.
 * Figures are placeholders filled from src/lib/legal.ts (`legalVars`), never
 * typed here. A `body` is split on blank lines into paragraphs; a paragraph
 * whose lines all start with "- " renders as a list.
 *
 * The publisher is deliberately named by the brand only (founder's choice,
 * 2026-10-29): card payments are sold by Creem as Merchant of Record.
 */
export const legalFr = {
  updated: 'Dernière mise à jour : {date}',
  backHome: 'Retour à l’accueil',
  otherDocs: 'Documents légaux',
  contactLine: 'Une question sur ces documents ? Écrivez-nous à {email} ou sur WhatsApp au {whatsapp}.',
  checkoutNotice: 'Payer vaut acceptation de nos conditions :',
  nav: {
    terms: 'Conditions générales',
    privacy: 'Confidentialité',
    refund: 'Remboursement',
  },
  terms: {
    title: 'Conditions générales d’utilisation et de vente',
    summary: 'Les règles d’utilisation de QatliA et les conditions d’achat des crédits.',
    sections: {
      s1: {
        title: 'Qui sommes-nous',
        body:
          'QatliA est un service en ligne, accessible sur qatlia.ma, qui aide les menuisiers à préparer leurs plans de découpe. Il est édité à titre individuel depuis le Maroc.\n\n' +
          'Pour nous joindre : {email} ou WhatsApp au {whatsapp}.\n\n' +
          'En créant un compte ou en achetant des crédits, vous acceptez ces conditions. Si vous ne les acceptez pas, n’utilisez pas le service.',
      },
      s2: {
        title: 'Le service',
        body:
          'QatliA vous permet de :\n' +
          '- photographier une fiche de débit et en extraire la liste des pièces grâce à une intelligence artificielle ;\n' +
          '- calculer un plan de découpe optimisé pour vos panneaux ;\n' +
          '- exporter ce plan (PDF, DXF, image) et préparer un devis pour votre client.\n\n' +
          'Nous faisons évoluer le service régulièrement : une fonction peut être ajoutée, modifiée ou retirée.',
      },
      s3: {
        title: 'Votre compte',
        body:
          'Vous créez un compte avec une adresse e-mail et un mot de passe, ou avec votre compte Google. Les informations fournies doivent être exactes.\n\n' +
          'Vous êtes responsable de la confidentialité de votre mot de passe et de ce qui est fait depuis votre compte. Prévenez-nous sans attendre si vous pensez qu’il a été utilisé par quelqu’un d’autre.',
      },
      s4: {
        title: 'Les crédits',
        body:
          'Les crédits paient les analyses :\n' +
          '- une analyse complète coûte {visionCost} crédit. Elle comprend le scan de la photo (ou, pour une liste saisie à la main, son premier calcul d’optimisation) et tous les recalculs de la liste pendant {windowHours} heures ;\n' +
          '- les exports et les devis sont gratuits.\n\n' +
          'Chaque nouveau compte reçoit {freeCredits} crédits offerts. Une analyse qui échoue n’est pas décomptée.\n\n' +
          'Les crédits restent sur votre solde tant que votre compte est ouvert. Ils n’ont pas de valeur monétaire : ils ne sont ni échangeables contre de l’argent (hors remboursement prévu par notre politique), ni transférables à un autre compte.',
      },
      s5: {
        title: 'Prix et paiement',
        body:
          'Les prix des packs sont affichés sur la page Crédits avant tout paiement.\n\n' +
          'Paiement par carte : il est traité par Creem, notre revendeur officiel (Merchant of Record). Creem est le vendeur de la transaction, perçoit les éventuelles taxes, apparaît sur votre relevé bancaire et vous envoie le reçu. Ses propres conditions s’appliquent au paiement. Les prix par carte sont en dollars américains (USD).\n\n' +
          'Paiement manuel en dirhams (agence, transfert d’argent, virement) : vous recevez un numéro de commande, et les crédits sont ajoutés après vérification de votre paiement.\n\n' +
          'Nous ne voyons ni ne conservons jamais vos données de carte bancaire.',
      },
      s6: {
        title: 'Achats uniques, sans abonnement',
        body:
          'Chaque pack est payé une seule fois. QatliA ne vend aucun abonnement : rien n’est renouvelé ni prélevé automatiquement après votre achat.',
      },
      s7: {
        title: 'Remboursement',
        body:
          'Les crédits achetés et non utilisés sont remboursables pendant {days} jours après le paiement, dans les conditions de notre politique de remboursement.',
      },
      s8: {
        title: 'Vos contenus',
        body:
          'Vos projets, photos et devis vous appartiennent. Vous nous autorisez seulement à les traiter pour vous rendre le service.\n\n' +
          'Si vous saisissez les coordonnées de vos propres clients (dans un devis par exemple), vous devez avoir le droit de le faire, et vous restez responsable de ces données vis-à-vis d’eux.',
      },
      s9: {
        title: 'Vérifiez avant de couper',
        body:
          'La lecture d’une photo par l’intelligence artificielle peut contenir des erreurs (chiffre mal lu, pièce oubliée), et un plan de découpe dépend des dimensions que vous saisissez. Relisez toujours la liste des pièces et le plan avant de découper un panneau.\n\n' +
          'QatliA est fourni tel quel. Nous ne pouvons pas être tenus responsables d’un matériau perdu ou d’une découpe erronée qui résulte d’un plan non vérifié. Dans tous les cas, notre responsabilité est limitée au montant que vous nous avez payé au cours des douze derniers mois.\n\n' +
          'Nous faisons le nécessaire pour que le service reste disponible, sans pouvoir garantir une disponibilité continue ni l’absence d’erreur.',
      },
      s10: {
        title: 'Utilisations interdites',
        body:
          'Il est interdit de :\n' +
          '- contourner le décompte des crédits ou les limites du service ;\n' +
          '- extraire massivement des données, perturber le service ou tenter d’accéder à un compte qui n’est pas le vôtre ;\n' +
          '- utiliser le service pour une activité illégale.\n\n' +
          'En cas de manquement, nous pouvons suspendre ou fermer le compte concerné.',
      },
      s11: {
        title: 'Fermeture du compte',
        body:
          'Vous pouvez demander la fermeture de votre compte à tout moment en nous écrivant. Les crédits restants sont alors perdus, sauf s’ils sont encore remboursables selon notre politique de remboursement.',
      },
      s12: {
        title: 'Modifications',
        body:
          'Nous pouvons modifier ces conditions. La date de mise à jour figure en haut de la page ; en cas de changement important, nous vous prévenons dans l’application ou par e-mail. Continuer à utiliser QatliA après ce changement vaut acceptation.',
      },
      s13: {
        title: 'Droit applicable et litiges',
        body:
          'Ces conditions sont régies par le droit marocain. En cas de désaccord, écrivez-nous d’abord : nous cherchons toujours une solution amiable. À défaut, le litige sera porté devant les tribunaux marocains compétents, sans préjudice des droits que la loi de votre pays de résidence vous accorde en tant que consommateur.',
      },
    },
  },
  privacy: {
    title: 'Politique de confidentialité',
    summary: 'Quelles données QatliA collecte, pourquoi, avec qui elles sont partagées et comment exercer vos droits.',
    sections: {
      s1: {
        title: 'Responsable du traitement',
        body:
          'QatliA traite les données décrites ici. Pour toute question ou demande : {email} ou WhatsApp au {whatsapp}.\n\n' +
          'Nous appliquons la loi marocaine n° 09-08 sur la protection des données personnelles et, pour les utilisateurs de l’Union européenne, les principes du RGPD.',
      },
      s2: {
        title: 'Les données que nous collectons',
        body:
          '- Compte : adresse e-mail, nom fourni par Google si vous l’utilisez pour vous connecter, langue choisie. Votre mot de passe est géré par notre fournisseur d’authentification et n’est jamais stocké en clair.\n' +
          '- Projets : pièces, dimensions, matériaux, réglages et plans de découpe que vous enregistrez.\n' +
          '- Devis : les coordonnées de votre entreprise et celles de votre client que vous saisissez dans un devis enregistré sur un projet.\n' +
          '- Photos de fiches de débit : envoyées pour analyse au moment où vous les soumettez. QatliA ne les enregistre pas.\n' +
          '- Crédits et paiements : solde, historique des crédits, commandes manuelles (numéro, pack, mode de paiement, statut). Pour un paiement par carte, Creem nous confirme la transaction ; vos données de carte restent chez Creem.\n' +
          '- Support : les messages que vous nous envoyez par e-mail ou WhatsApp.\n' +
          '- Données techniques : journaux de connexion (adresse IP, navigateur) tenus par nos prestataires pour la sécurité.',
      },
      s3: {
        title: 'Pourquoi nous les utilisons',
        body:
          '- Vous fournir le service : compte, analyses, plans, exports (exécution du contrat).\n' +
          '- Traiter les paiements et tenir notre comptabilité (obligation légale).\n' +
          '- Protéger le service contre la fraude et les abus (intérêt légitime).\n' +
          '- Répondre à vos demandes de support.\n\n' +
          'Nous ne vendons pas vos données, nous n’affichons pas de publicité et nous n’utilisons pas vos projets pour entraîner un modèle d’intelligence artificielle.',
      },
      s4: {
        title: 'Nos prestataires',
        body:
          'Nous faisons appel à des prestataires qui traitent des données pour notre compte, uniquement pour faire fonctionner le service :\n' +
          '- Supabase : base de données et authentification ;\n' +
          '- notre hébergeur web : affichage du site et exécution de l’application ;\n' +
          '- OpenRouter, qui transmet vos photos au modèle d’intelligence artificielle chargé de les lire (actuellement Google Gemini) ;\n' +
          '- Google : connexion avec un compte Google, si vous la choisissez ;\n' +
          '- Creem : paiements par carte, en tant que revendeur officiel ;\n' +
          '- WhatsApp et notre messagerie e-mail : échanges avec le support.\n\n' +
          'Ces prestataires sont situés en dehors du Maroc (Union européenne, États-Unis). Vos données y sont donc transférées, avec les garanties contractuelles qu’ils proposent.',
      },
      s5: {
        title: 'Cookies et stockage local',
        body:
          'QatliA n’utilise que des cookies et un stockage local nécessaires à son fonctionnement :\n' +
          '- cookies de session, pour vous garder connecté ;\n' +
          '- votre langue, votre thème et votre unité d’affichage ;\n' +
          '- les coordonnées de votre entreprise pour les devis, gardées dans votre navigateur seulement.\n\n' +
          'Aucun cookie publicitaire ni de mesure d’audience. La page de paiement Creem utilise ses propres cookies.',
      },
      s6: {
        title: 'Durée de conservation',
        body:
          '- Compte, projets et devis : tant que votre compte est ouvert, puis supprimés dans les 30 jours suivant sa fermeture.\n' +
          '- Photos : non conservées par QatliA après l’analyse.\n' +
          '- Paiements et historique des crédits : pendant la durée imposée par les obligations comptables et fiscales.\n' +
          '- Messages de support : le temps de traiter votre demande et son suivi.',
      },
      s7: {
        title: 'Sécurité',
        body:
          'Les échanges sont chiffrés (HTTPS). Chaque compte n’accède qu’à ses propres données, et les opérations sensibles (crédits, paiements) ne sont faites que par nos serveurs. Aucun système n’est infaillible : prévenez-nous si vous constatez un problème.',
      },
      s8: {
        title: 'Vos droits',
        body:
          'Vous pouvez demander à accéder à vos données, à les corriger, à les supprimer, à vous opposer à un traitement ou à recevoir une copie de vos projets. La suppression du compte se fait sur simple demande à {email} ou par WhatsApp. Nous répondons sous 30 jours.\n\n' +
          'Si vous estimez que vos droits ne sont pas respectés, vous pouvez saisir la CNDP (Commission nationale de contrôle de la protection des données à caractère personnel, cndp.ma) ou l’autorité de protection des données de votre pays.',
      },
      s9: {
        title: 'Public concerné',
        body:
          'QatliA s’adresse aux professionnels et aux adultes. Il n’est pas destiné aux personnes de moins de 18 ans.',
      },
      s10: {
        title: 'Modifications',
        body:
          'Nous mettrons cette politique à jour si nos pratiques ou nos prestataires changent. La date de mise à jour figure en haut de la page.',
      },
    },
  },
  refund: {
    title: 'Politique de remboursement',
    summary: 'Quand et comment les crédits non utilisés sont remboursés.',
    sections: {
      s1: {
        title: 'Le principe',
        body:
          'Vous avez {days} jours après un paiement pour demander le remboursement des crédits achetés que vous n’avez pas encore utilisés.\n\n' +
          'Le montant remboursé est proportionnel aux crédits non utilisés : prix payé × crédits du pack non utilisés ÷ crédits du pack. Si vous n’avez utilisé aucun crédit du pack, vous êtes remboursé intégralement.',
      },
      s2: {
        title: 'Comment les crédits utilisés sont comptés',
        body:
          'Les crédits sont consommés dans l’ordre où vous les avez reçus : d’abord les {freeCredits} crédits offerts à l’inscription, puis chaque achat, du plus ancien au plus récent.\n\n' +
          'Les crédits remboursés sont retirés de votre solde.',
      },
      s3: {
        title: 'Ce qui n’est pas remboursable',
        body:
          '- les crédits déjà utilisés ;\n' +
          '- les crédits offerts à l’inscription ;\n' +
          '- une demande faite plus de {days} jours après le paiement ;\n' +
          '- les crédits obtenus par fraude ou en violation de nos conditions générales.',
      },
      s5: {
        title: 'Un crédit décompté par erreur',
        body:
          'Si un crédit a été décompté à tort (panne, double décompte), écrivez-nous : nous le recréditons, quel que soit le délai écoulé.',
      },
      s6: {
        title: 'Faire une demande',
        body:
          'Écrivez-nous à {email} ou sur WhatsApp au {whatsapp}, avec l’adresse e-mail de votre compte et le reçu Creem ou votre numéro de commande (QIA-…).\n\n' +
          'Nous répondons sous 3 jours ouvrés. Une fois la demande acceptée :\n' +
          '- paiement par carte : le remboursement est émis par Creem sur la carte utilisée ; le délai d’apparition sur votre compte dépend de votre banque ;\n' +
          '- paiement manuel en dirhams : le remboursement est fait par virement ou par le même moyen que votre paiement, sous 14 jours.\n\n' +
          'Avant d’ouvrir une contestation auprès de votre banque, contactez-nous : c’est presque toujours plus rapide.',
      },
    },
  },
};

export type LegalCatalog = typeof legalFr;
