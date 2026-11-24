# Alerte « il reste peu de crédits »

Date : 2026-11-24. Taille : petit changement.

## But

Inciter les clients à acheter des crédits avant d'être bloqués. Aujourd'hui rien ne les prévient avant zéro, et à zéro le message d'erreur de la photo n'a pas de bouton d'achat.

## Approches

- **A. Prévenir à temps (choisie par l'utilisateur, 2026-11-24).** Ne coûte rien, ne touche ni aux prix ni aux paiements. Risque : agacer, d'où le message que l'on peut fermer.
- **B. Offrir un bonus à l'achat.** Écartée pour l'instant : coûte des crédits et peut habituer les clients à attendre le bonus.
- Seuil en pourcentage : écarté. 20 % donnent 4 crédits sur 20, mais 80 sur 400.

## Ce que le client voit

Seuil : `LOW_CREDITS_THRESHOLD = 5`, écrit une seule fois dans `src/lib/billing/policy.ts`.

| Solde | Badge du solde | Message |
|---|---|---|
| plus de 5 | comme aujourd'hui | aucun |
| 1 à 5 | fond orange plein | « Il vous reste N crédits. » + « Acheter des crédits » + fermer |
| 0 | fond rouge plein | « Vous n'avez plus de crédits. » + « Acheter des crédits », sans fermer |
| inconnu (pas connecté, en chargement) | comme aujourd'hui | aucun |

- **Badge** : il est aujourd'hui orange sur fond clair, d'où le fond plein pour se distinguer. Visible sur l'atelier, l'historique, les panneaux et « Mon compte ».
- **Message** : dans l'atelier, sous l'en-tête, et sur « Usage des crédits » (sans fermer : le client est venu voir son solde).
- **Fermer** : le message reste caché tant que le solde ne dépasse pas 5. Il revient après un nouvel achat suivi d'une nouvelle baisse, et toujours à 0. Mémorisé dans le navigateur (`localStorage`) ; s'il est indisponible, le message réapparaît simplement à la visite suivante.
- **À zéro** : le bouton « Acheter des crédits » s'ajoute au message d'erreur de la photo, et remplace « Recharger » dans celui de l'optimisation. Une erreur « crédits insuffisants » met aussi le solde affiché à jour.
- Un débit déjà payé reste modifiable gratuitement pendant 24 h : le message à zéro ne dit donc jamais que le client est bloqué.

## Contraintes

- Français, anglais, arabe ; mots simples ; pluriels par `plural`.
- Application Android : mêmes couleurs et même phrase, mais aucun bouton ni texte d'achat (`data-sells`, `storeAppCopyKey`).
- Lisible en mode clair et en mode sombre.
- Aucune promesse d'économie ; aucun changement de prix, de paiement ou de base de données.

## Hors du périmètre

Bonus, e-mails, messages WhatsApp, notifications.

## Laissé au développeur

Le découpage en composants et le nom de la clé de stockage.
