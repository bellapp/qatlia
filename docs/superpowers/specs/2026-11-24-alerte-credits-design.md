# Alerte « il reste peu de crédits »

Date : 2026-11-24. Taille : petit changement.

## But

Inciter les clients à acheter des crédits avant d'être bloqués. Aujourd'hui rien ne les prévient avant zéro, et à zéro le message d'erreur de la photo n'a pas de bouton d'achat.

## Approches

- **A. Prévenir à temps (choisie par l'utilisateur, 2026-11-24).** Ne coûte rien, ne touche ni aux prix ni aux paiements. Risque : agacer, d'où le message que l'on peut fermer.
- **B. Offrir un bonus à l'achat.** Écartée pour l'instant : coûte des crédits et peut habituer les clients à attendre le bonus.
- Seuil : 10 % sous 100 crédits (demande de l'utilisateur, 2026-11-24). Un pourcentage pour tous est écarté : 10 % de 400 alerteraient à 40.

## Ce que le client voit

Seuil, calculé à un seul endroit (`src/lib/billing/policy.ts`), sur le **solde de départ** :

- solde de départ = le solde juste après le dernier ajout de crédits (achat ou ajout par l'admin), lu dans `credit_transactions.balance_after` ; sans aucun ajout, les crédits offerts à l'inscription (`SIGNUP_FREE_CREDITS`, 20) ;
- moins de 100 : 10 %, arrondi au-dessus (20 → 2, 30 → 3, 80 → 8) ;
- 100 et plus : 10 crédits fixes (proposition, à confirmer par l'utilisateur) ;
- solde de départ illisible : seul l'état 0 est affiché.

| Solde | Badge du solde | Message |
|---|---|---|
| au-dessus du seuil | comme aujourd'hui | aucun |
| de 1 au seuil | fond orange plein | « Il vous reste N crédits. » + « Acheter des crédits » + fermer |
| 0 | fond rouge plein | « Vous n'avez plus de crédits. » + « Acheter des crédits », sans fermer |
| inconnu (pas connecté, en chargement) | comme aujourd'hui | aucun |

- **Badge** : il est aujourd'hui orange sur fond clair, d'où le fond plein pour se distinguer. Visible sur l'atelier, l'historique, les panneaux et « Mon compte ».
- **Message** : dans l'atelier, sous l'en-tête, et sur « Usage des crédits » (sans fermer : le client est venu voir son solde).
- **Fermer** : le message reste caché tant que le solde ne dépasse pas le seuil. Il revient après un nouvel achat suivi d'une nouvelle baisse, et toujours à 0. Mémorisé dans le navigateur (`localStorage`) ; s'il est indisponible, le message réapparaît simplement à la visite suivante.
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
