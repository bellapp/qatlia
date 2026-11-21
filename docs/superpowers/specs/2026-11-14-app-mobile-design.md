# QatliA sur Android et iPhone — conception

Date : 2026-11-14. Statut : à valider par le propriétaire.

Relu contre le code de `origin/main` le 2026-11-21 (commit `6140900`). Les passages corrigés à cette occasion portent la mention « (relevé du 21) ».

Dans ce document, « décidé par le propriétaire » désigne ce qu'il a dit dans la conversation. Tout le reste est un choix du rédacteur, marqué **(choix du rédacteur)**, que le propriétaire peut corriger. Six points attendent sa réponse (quatre du 14 novembre, deux ajoutés au relevé du 21) ; ils sont regroupés dans « Questions ouvertes ».

## Intention

Mettre QatliA dans le Play Store, puis dans l'App Store, pour que les menuisiers l'installent comme une application de téléphone ordinaire.

**Décidé par le propriétaire :** l'app doit être mise en production à l'échelle de l'Afrique et du Moyen-Orient, pas seulement au Maroc.

**Dit par le propriétaire le 2026-11-21 :** des gens demandent l'app. C'est ce qui déclenche le chantier. Il n'a pas précisé qui ni par quel canal. Hypothèse du rédacteur sur le reste : un artisan cherche un outil dans le store de son téléphone et fait davantage confiance à une app installée qu'à un site, et les stores sont le moyen le moins coûteux d'atteindre des menuisiers hors du Maroc.

## Ce qui existe aujourd'hui

- QatliA est un site Next.js 14 (App Router) servi sur `https://qatlia.ma`, avec routes API, Supabase pour les comptes et la base, Stripe/Creem et paiement manuel (virement, cash) pour les crédits.
- Le site est déjà une PWA : `public/manifest.json` (ouverture sur `/atelier`, plein écran), `public/sw.js` (pages réseau d'abord, cache en secours), enregistrement dans `src/components/PwaRegister.tsx`.
- La saisie des pièces se fait sans compte ; la photo et l'optimisation demandent une connexion (`src/lib/pending-work.ts`). La photo passe par `<input type="file" capture="environment">`.
- Connexion : e-mail + mot de passe, ou Google (`signInWithOAuth`, retour sur `/auth/callback`). Depuis le 21 novembre, l'inscription commence par Google et le formulaire e-mail est replié (relevé du 21).
- Le bot WhatsApp est devenu la principale porte d'entrée : il lit la photo d'une fiche et répond par un lien `qatlia.ma/w/<code>`, valable 24 h, qui ouvre l'atelier sur les pièces lues (relevé du 21).
- Une barre commune (`src/components/WorkspaceNav.tsx`) relie l'atelier, l'historique et une nouvelle page `/panels` de configuration des panneaux (relevé du 21).
- Les photos de fiches sont conservées : jusqu'à 4 par projet, dans le bucket privé `scans` du stockage Supabase (relevé du 21).
- Un nouveau compte reçoit 20 crédits : la colonne `profiles.credits` vaut 20 par défaut et le déclencheur `handle_new_user` crée le profil (migration 010). Rien ne se souvient d'un compte supprimé.
- Un client ne peut pas supprimer son compte lui-même : cela se fait sur demande par e-mail ou WhatsApp (pages confidentialité et conditions). Depuis le 18 novembre, un admin peut supprimer un compte depuis la fiche client (`src/app/api/admin/clients/[id]/route.ts`) : la route supprime l'utilisateur Supabase, laisse les cascades faire le reste, puis vide ses photos du bucket `scans`. Elle refuse tout compte qui a déjà payé ou qui a une commande manuelle ouverte (relevé du 21).
- Deux mises en page racines : `src/app/(site)/layout.tsx` et `src/app/(ar)/layout.tsx`.
- L'interface existe en français, arabe (droite à gauche) et anglais, ce qui couvre déjà la région visée.
- Chaque compte a une devise parmi dirham, euro et dollar (`src/lib/currency.ts`, colonne `profiles.currency`, migration 017, décision du propriétaire du 15 novembre). Elle est attribuée selon le pays à la première visite — dirham au Maroc, euro en Europe, dollar ailleurs — et le client peut la changer. Les devis et les PDF la suivent. Le 14 novembre, ce document disait que le dirham était la seule devise : ce n'est plus vrai (relevé du 21).
- Les crédits s'achètent par carte en dollars via Creem, par carte en dirhams via Stripe, ou par virement et cash au Maroc.
- Le site n'envoie aucun e-mail en dehors de ceux de Supabase pour la connexion : aucun service d'envoi n'est installé.
- Les conditions indiquent que QatliA est « édité à titre individuel depuis le Maroc ».
- Mesure du 2026-11-14 sur `qatlia.ma/atelier` en 360 × 800 : pas de défilement horizontal de la page, mise en page déjà adaptée. Points faibles : le tableau des pièces est serré (noms tronqués à deux lettres, icônes d'action d'environ 16 px), 87 contrôles sur 90 font moins de 36 px de haut ou de large, la barre d'onglets est coupée à droite. Cette mesure est périmée : depuis, la barre de l'atelier a été remplacée par la barre commune, les réglages de coupe ont changé de place, et le défilement du plan au doigt a été corrigé. Elle est à refaire avant le lot 5 (relevé du 21).

## Objectifs

1. Une app « QatliA » installable depuis le Play Store, qui s'ouvre en plein écran sur l'atelier, sans barre d'adresse.
2. Dans l'app, tout ce qui marche sur le site marche : connexion e-mail et Google, photo, optimisation, export PDF/DXF, historique, devis, trois langues (fr, ar, en).
3. L'app n'offre aucun achat et n'invite à aucun paiement. Les crédits achetés ailleurs (virement, cash, carte sur le site) s'affichent et se consomment dans l'app.
4. L'atelier est confortable au doigt sur un téléphone de 360 px de large.
5. L'app est disponible dans les pays d'Afrique et du Moyen-Orient, et un menuisier de ces pays y travaille dans sa devise.
6. Ensuite, la même chose sur iPhone.

## Hors périmètre

- Réécriture native, notifications push, optimisation hors ligne (le moteur tourne sur le serveur).
- Achats intégrés Google ou Apple.
- Nouveaux moyens de paiement pour la région (mobile money, passerelles locales). C'est un sujet commercial à part ; voir « Paiement ».
- Catalogues de panneaux et tarifs propres à chaque pays : hors du Maroc, l'artisan saisit ses dimensions et ses prix.
- Mises en page spécifiques tablette, Huawei AppGallery.
- Mesure d'usage propre à l'app : les statistiques d'installation du Play Console suffisent pour décider de la suite.

## Ce qui serait un échec

- Un client du site web ne peut plus acheter de crédits parce que le « mode app » s'est activé dans son navigateur.
- L'app est refusée ou retirée d'un store pour avoir orienté vers un paiement externe.
- Une régression en production : qatlia.ma a des clients réels.

## Contraintes

- **Règles des stores sur le paiement.** Google (règles de paiement, section 4) et Apple (3.1.1, 3.1.3) interdisent, hors store américain, les boutons, liens et appels à l'action vers un autre moyen de paiement. Consommer dans l'app des crédits acquis ailleurs est admis tant que l'app n'y invite pas.
- **Risque propre à Apple.** L'exception « app compagnon gratuite sans achat » (3.1.3(f)) ne cite que VoIP, stockage cloud, e-mail et hébergement. Apple peut exiger l'achat intégré pour les crédits à la revue.
- **Vente dans l'app impossible depuis le Maroc.** Le tableau des pays de Google Play indique que le Maroc accepte l'inscription comme développeur mais pas comme marchand. Un compte développeur marocain ne peut donc pas vendre de crédits par le paiement Google Play, même s'il le voulait.
- **Suppression de compte.** Google et Apple (5.1.1(v)) exigent qu'un utilisateur puisse lancer la suppression de son compte depuis l'app. Google demande aussi une adresse web publique qui l'explique.
- **Compte Play personnel récent.** Un compte développeur personnel créé après novembre 2023 doit faire tourner un test fermé avec 12 testeurs inscrits pendant 14 jours avant de publier. Compter environ trois semaines entre le premier envoi et la mise en ligne. Un compte d'organisation (numéro D-U-N-S requis) en est dispensé. Source : guides tiers concordants, à confirmer dans le Play Console.
- **Stockage partagé avec le navigateur.** Une app Android de type TWA tourne dans le navigateur par défaut du téléphone s'il sait le faire (Chrome le plus souvent, parfois Samsung Internet) et partage ses cookies et son `localStorage`.
- **Schéma de production incertain.** Les migrations sont collées à la main dans l'éditeur SQL de Supabase, et la migration 005 indique que 001 à 004 ont pu être appliquées partiellement. Le dépôt ne dit donc pas avec certitude quelles clés étrangères existent en production.
- **Projet.** Production en ligne : tout passe par PR, suite de tests complète, échecs comparés à `main` (10 échecs CRLF connus). Pas de `.env.local` sur ce poste : l'interface ne se vérifie pas en local, elle se vérifie sur l'aperçu de la PR ou en production. Chaque texte d'interface existe en fr, ar et en (`tests/i18n-coverage.test.js`).
- **Poste de travail.** Windows, pas de Mac.

## Approches

**A. Une seule enveloppe native (Capacitor) pour les deux stores, qui affiche qatlia.ma.** Un seul mécanisme. Mais dès Android il faut résoudre deux problèmes propres aux vues web embarquées : Google y bloque sa connexion, et le téléchargement des PDF/DXF n'y fonctionne pas sans code natif.

**B. Android en PWA empaquetée (TWA), puis iPhone avec Capacitor.** Sur Android l'app tourne dans le navigateur du téléphone : connexion Google, photo et téléchargements se comportent comme sur le site, avec très peu de code. L'iPhone vient ensuite avec les chantiers de A. Deux mécanismes à entretenir.

**C. Réécriture native (React Native).** Écartée : des mois de travail et l'atelier (une page de plus de 3 000 lignes au 21 novembre) à maintenir en double.

**Décidé par le propriétaire : B, Android d'abord.** Raison donnée par le rédacteur et acceptée : présence sur le Play Store à faible risque, et mesure de la demande avant le chantier iPhone, plus long et incertain à la revue.

## Paiement

**Décidé par le propriétaire :** pas de paiement Google ou Apple. Le client paie comme aujourd'hui, par virement ou cash au Maroc, et reçoit ses crédits.

Conséquence : l'app a un **mode app** dans lequel elle ne vend rien. Ce n'est pas seulement un choix : un compte développeur marocain ne peut pas vendre par Google Play (voir Contraintes).

**Hors du Maroc,** le virement et le cash n'existent pas. Le seul paiement possible est la carte sur qatlia.ma, en dollars, via Creem, et l'app n'a pas le droit de le dire. Trois conséquences :

- Un artisan étranger qui installe l'app utilise ses 20 crédits offerts, puis ne trouve dans l'app aucune indication pour continuer.
- Le seul canal autorisé pour le lui dire est hors de l'app : un e-mail envoyé à son adresse de compte (Apple l'autorise explicitement ; la règle de Google ne vise que l'app et sa fiche), le support WhatsApp, le site.
- Deux risques commerciaux ne sont pas traités ici : que Creem refuse des cartes de certains pays, et que beaucoup d'artisans africains paient par mobile money plutôt que par carte.

## Phase 1 — Android

Six lots, dans cet ordre **(choix du rédacteur)** :

| Ordre | Lot | Qui | Dépend de |
|---|---|---|---|
| 0 | Compte Play et app créée dans le Play Console | propriétaire | — |
| 1 | Mode app | PR sur le site | — |
| 2 | Enveloppe Android | PR + envoi au test interne | 0, 1 |
| 3 | Test fermé lancé (si compte personnel) | propriétaire | 2 |
| 4 | Suppression du compte | PR sur le site | réponses aux questions ouvertes |
| 5 | Confort au doigt | PR sur le site | — |
| 6 | Fiche du store et demande de production | propriétaire | tous |

Le lot 0 passe en premier parce que la preuve de propriété du domaine demande une empreinte que seul le Play Console fournit. Les lots 4 et 5 se font pendant les 14 jours du test fermé : un déploiement du site met l'app à jour sans nouvel envoi au store.

### Lot 0 — Compte Play

Le propriétaire crée le compte développeur (25 $, vérification d'identité), crée l'app `com.qatlia.app` dans le Play Console et active la signature par Google Play. Il transmet l'empreinte SHA-256 de la clé de signature.

### Lot 1 — Mode app

Le site sait s'il est affiché dans l'app du store et, dans ce cas, retire tout ce qui vend.

**Détection (choix du rédacteur).** L'app s'ouvre sur `/atelier?app=android`. Un petit script en tête de page, sur le modèle de `localeInitScript` dans `src/i18n/index.ts`, active le mode si l'adresse porte ce paramètre ou si `document.referrer` vaut exactement `android-app://com.qatlia.app` (avec ou sans barre finale). Il mémorise le résultat dans `sessionStorage` et pose `data-app="android"` sur `<html>` avant le premier affichage. Le script est présent dans les deux mises en page racines. Un seul module, par exemple `src/lib/store-app.ts`, expose la réponse au reste du code.

Le référent doit être comparé au nom exact de l'app : n'importe quelle app Android qui ouvre un lien (Gmail, par exemple) envoie un référent `android-app://…`, et un client du site qui ouvre son e-mail de confirmation ne doit pas basculer en mode app.

Trois propriétés à respecter, quelle que soit l'implémentation :
- le mode ne fuit pas vers le navigateur : rien dans un cookie ni dans `localStorage` ;
- aucun lien d'achat n'apparaît, même un instant, avant l'hydratation React ;
- hors de l'app, le site se comporte exactement comme aujourd'hui.

Le serveur ne connaît pas le mode, puisqu'aucun cookie ne le porte. Les redirections ci-dessous se font donc dans le navigateur, à deux niveaux : le script de tête de page pour un chargement complet, et une garde React pour les navigations internes (les deux déconnexions font `router.push('/')`, les pastilles d'en-tête sont des `<Link href="/credits">`).

**Ce qui change en mode app :**

| Endroit | Aujourd'hui | En mode app |
|---|---|---|
| `/credits`, `/credits/success` | page d'achat | redirige vers `/account` |
| `/` et `/ar` (pages d'accueil avec tarifs) | landing | redirige vers `/atelier` |
| Atelier, pastille de solde (`atelier/page.tsx` ~l. 1805) | lien vers `/credits` | affiche le solde, mène à `/account` |
| Atelier, erreur « plus de crédits » à l'optimisation (~l. 2356) | message + lien « Recharger » | message seul |
| Atelier, erreur de lecture photo `atelier.visionError.insufficientCredits` | « Rechargez votre compte » | texte sans invitation à recharger |
| `AccountMenu`, page compte (2 liens), page historique (1 lien), page panneaux `/panels` (1 lien, ajoutée au relevé du 21) | liens vers `/credits` | masqués |
| Lien vers la page remboursement, y compris les renvois entre pages légales (`LegalPage.tsx`) | visible | masqué |

- Le solde et l'historique des mouvements de crédits restent visibles sur `/account`.
- Le contact support WhatsApp et e-mail reste dans le menu du compte : c'est de l'assistance générale, avec son message prérempli actuel, qui ne parle pas d'achat.
- La mention des 20 crédits offerts à l'inscription reste.
- **Pages légales (choix du rédacteur) :** confidentialité et conditions restent accessibles avec leur texte actuel, qui décrit le paiement par carte, virement et cash. Un texte légal n'est pas une invitation à payer ; le risque de refus est jugé faible. Si Google le relève, on servira une version allégée en mode app.

**Conséquence assumée :** un utilisateur de l'app qui n'a plus de crédits lit « Vous n'avez plus de crédits » sans indication de la marche à suivre. C'est le prix du refus des achats intégrés.

**Vérification :** ouvrir `/atelier?app=android` dans un navigateur sur l'aperçu de la PR et parcourir chaque ligne du tableau, y compris après une déconnexion ; puis ouvrir `/atelier` dans un autre onglet et constater que rien n'a changé.

### Lot 2 — Enveloppe Android

- **Outil (choix du rédacteur) :** Bubblewrap, l'outil de Google qui fabrique une TWA à partir du manifeste. Projet dans `mobile/android/` du dépôt. La clé d'envoi ne va jamais dans le dépôt.
- **Identifiant (décidé par le propriétaire le 2026-11-21, définitif une fois publié) :** `com.qatlia.app`. Nom affiché : « QatliA ».
- **Ouverture :** `https://qatlia.ma/atelier?app=android`. Couleurs reprises du manifeste (fond `#060B14`, thème `#F5A623`). Orientation libre. Repli en onglet personnalisé du navigateur, pas en vue web embarquée.
- **Preuve de propriété du domaine :** `public/.well-known/assetlinks.json` avec les empreintes de la clé de signature Play (lot 0) et de la clé d'envoi. Sans elle, l'app affiche une barre d'adresse.
- **Icônes :** une icône adaptative dédiée avec zone de sécurité. L'icône 512 actuelle est déclarée à la fois « any » et « maskable », ce qui la fait rogner sur certains lanceurs.
- **Liens entrants (choix du rédacteur) :** l'app n'intercepte que les liens vers `/atelier`, `/history` et `/account`. Un lien `qatlia.ma/credits` reçu par WhatsApp, un lien de confirmation d'inscription ou un lien vers l'accueil s'ouvrent donc dans le navigateur, où l'achat reste possible. Android ne sait qu'autoriser des chemins, pas en exclure un. Bubblewrap n'a pas de réglage pour cela : c'est une retouche du `AndroidManifest.xml` généré, à réappliquer après chaque `bubblewrap update`, et à consigner dans un script ou une note du dossier. La page `/panels` rejoint cette liste. Les liens `/w/<code>` du bot WhatsApp n'existaient pas le 14 novembre : voir la question ouverte 5 (relevé du 21).
- **Hors ligne (choix du rédacteur) :** une page déjà visitée continue de s'afficher depuis le cache, comme aujourd'hui. Seul le dernier recours change : aujourd'hui c'est la page d'accueil en cache, avec ses tarifs ; ce sera un écran « Pas de connexion » avec un bouton Réessayer. Cela modifie `public/sw.js` et fait monter le nom du cache, ce qui recharge les onglets ouverts (mécanisme déjà prévu dans le fichier).
- **Mises à jour :** un déploiement du site met l'app à jour immédiatement. Le store n'est sollicité que pour l'enveloppe : icône, nom, et la mise à niveau annuelle exigée par Google.

**Vérification sur de vrais téléphones,** avec l'app installée depuis le test interne du Play Console, dont au moins un Samsung dont le navigateur par défaut est Samsung Internet :

- pas de barre d'adresse ;
- connexion e-mail ; connexion Google avec retour dans l'app, toujours en mode app ;
- photo d'une fiche, optimisation, téléchargement et ouverture d'un PDF ;
- aucun chemin vers un achat, y compris après déconnexion ;
- un lien `qatlia.ma/credits` tapé dans WhatsApp s'ouvre dans le navigateur avec la page d'achat ;
- un lien `qatlia.ma/atelier` tapé dans WhatsApp s'ouvre dans l'app, en mode app ;
- en mode avion : l'atelier déjà visité s'affiche, une page jamais visitée montre l'écran « Pas de connexion ».

Si le mode app ne s'active pas sur Samsung Internet, le constructeur le signale avant d'aller plus loin : la détection devra être revue.

### Lot 3 — Test fermé

Si le compte est personnel : le propriétaire inscrit 12 testeurs, qui restent inscrits 14 jours. Le lot 1 doit être en production avant ce premier envoi, pour qu'aucune version distribuée par Google ne montre d'achat.

### Lot 4 — Suppression du compte

Bouton « Supprimer mon compte » sur `/account`, pour tous les utilisateurs, web compris.

**Avant d'écrire le code,** le propriétaire exécute dans l'éditeur SQL de Supabase une requête fournie par le constructeur, qui liste toutes les clés étrangères vers `auth.users` et `public.profiles` avec leur règle de suppression, et indique si le stockage Supabase contient des fichiers d'utilisateurs. Le constructeur demande aussi si les aperçus de PR utilisent la base de production : la route est destructrice et se teste sur un compte jetable.

Ce que le dépôt montre déjà :
- la plupart des tables partent avec le compte (`ON DELETE CASCADE`) : profil, projets, mouvements de crédits, paiements manuels, panneaux enregistrés, prix, notes admin ;
- `manual_payments.decided_by` (migration 006) et `image_extractions.user_id` (migration 001, table inutilisée par le code) n'ont pas de cascade : la suppression d'un compte admin qui a validé des paiements échouerait ;
- `admin_audit_log` et `admin_client_notes.updated_by` gardent des identifiants d'utilisateur sans clé étrangère ;
- le stockage contient des fichiers d'utilisateurs : les photos de fiches, dans le bucket `scans`, rangées par identifiant de compte (relevé du 21) ;
- la suppression par un admin existe déjà et fait l'essentiel du travail (utilisateur Supabase, cascades, photos). Le bouton du client peut s'appuyer sur la même logique. Une différence compte : la route admin refuse tout compte qui a payé, alors que les stores exigent qu'un client qui a payé puisse aussi supprimer son compte. C'est la question ouverte 3 (relevé du 21).

**Comportement (choix du rédacteur, sauf mention) :**

- Une étape de confirmation explicite annonce ce qui est perdu : projets, panneaux enregistrés, prix, crédits restants. Les crédits restants ne sont pas remboursés après suppression ; la confirmation et les conditions le disent.
- La suppression est immédiate. Une route serveur vérifie la session puis supprime l'utilisateur Supabase avec la clé service-role.
- La suppression est refusée tant qu'un paiement manuel du compte est en attente de validation, avec un message qui renvoie au support. Un compte admin ne peut pas se supprimer lui-même par ce bouton.
- **Archive des paiements — question ouverte 3.** Proposition : avant la suppression, les paiements du compte (`manual_payments` validés et achats de `credit_transactions`) sont copiés dans une table d'archive sans identité : montant, date, moyen, numéro de commande `QIA-…`. Les champs libres (`payment_reference`, `operator_note`), qui contiennent souvent un nom, ne sont pas copiés. Les indicateurs du back office (`admin_kpis`) lisent aussi l'archive, pour que le chiffre d'affaires passé ne baisse pas à chaque suppression.
- **Réinscription — question ouverte 2.** Proposition : on garde une empreinte irréversible de l'e-mail des comptes supprimés ; un nouveau compte créé avec le même e-mail démarre à 0 crédit au lieu de 20. La page confidentialité le mentionne.
- Une page publique, ou une section ancrée de `/privacy`, explique comment supprimer son compte ; son adresse est demandée par le Play Console.
- Les pages confidentialité et conditions (« sur simple demande », « supprimés dans les 30 jours ») sont mises à jour dans les trois langues.

La forme de la confirmation (saisie d'un mot, mot de passe) est laissée au constructeur.

### Lot 5 — Confort au doigt

Pas de refonte : l'atelier est déjà adapté au téléphone.

Le constructeur commence par un relevé en 360 × 800 et 412 × 915, en français et en arabe (droite à gauche), de cinq écrans : atelier avant optimisation, atelier avec un plan affiché, historique, compte, connexion. Il corrige ensuite ce qui gêne, jusqu'à ces critères :

- aucune page ne défile horizontalement ;
- les actions principales (optimiser, photo, ajouter une pièce, exporter) et les actions de ligne du tableau des pièces font au moins 44 px de zone tactile ;
- le nom d'une pièce se lit en entier ou sur au moins une dizaine de caractères ;
- les champs de dimensions ouvrent le clavier numérique ;
- le plan de coupe se lit sur le téléphone, avec zoom ;
- le clavier ne masque pas le champ en cours de saisie.

La manière d'y arriver (lignes empilées, tableau repensé sous un seuil de largeur) est laissée au constructeur. Le rendu sur ordinateur ne change pas.

### Lot 6 — Fiche du store et production

Étapes faites par le propriétaire, à partir d'une liste préparée dans le dépôt :

- fiche en français et en arabe : nom, description courte et longue, icône 512, bannière 1024 × 500, au moins quatre captures de téléphone ;
- formulaires : sécurité des données (e-mail, nom, photos de fiches envoyées pour la lecture IA et conservées avec le projet, numéro WhatsApp si le client est passé par le bot), classification du contenu, public visé, adresse de la politique de confidentialité, adresse de suppression de compte ;
- identifiants d'un compte de test crédité, pour l'examinateur de Google ;
- demande de production.

Les textes de la fiche, la bannière et les captures sont préparés par le constructeur. Ni la fiche ni les captures ne mentionnent de prix ou de moyen de payer.

**Pays (choix du rédacteur) :** Maroc à la première mise en production, région ouverte à la phase 1b. Catégorie : Productivité.

### Critère de fin de la phase 1

L'app est publiée en production sur le Play Store au Maroc, la liste de vérification du lot 2 passe sur la version du store, un compte de test se supprime depuis l'app, et le site web se comporte comme avant pour un visiteur dans son navigateur.

## Phase 1b — Ouverture à l'Afrique et au Moyen-Orient

Ouvrir un pays dans le Play Console est une case à cocher. Ce qui demande du travail, c'est qu'un artisan du Caire ou de Dakar ne se retrouve pas devant des prix en dirhams et une impasse quand ses crédits sont épuisés.

**Ordre (choix du rédacteur) :** la région s'ouvre quand les lots 7 et 8 sont en production. Ils peuvent se faire pendant les 14 jours du test fermé ; s'ils sont prêts à temps, la première mise en production est directement régionale. Ouvrir avant expose l'app à de mauvaises notes sur le store de la part d'utilisateurs qui ne peuvent ni lire leurs prix ni recharger.

### Lot 7 — Devise de l'atelier

**État au relevé du 21 : fait en grande partie, d'une autre manière.** Chaque compte a déjà une devise parmi dirham, euro et dollar, attribuée selon le pays. Un artisan du Caire ou de Dakar travaille donc en dollars, pas en dirhams. Ce qui reste de ce lot dépend de la question ouverte 6 : si le dollar suffit pour la région, le lot est clos ; sinon il consiste à ajouter des devises locales à la liste existante. Les points ci-dessous décrivent le lot tel qu'il était prévu le 14 novembre.

- Chaque compte a une devise, choisie parmi une liste, qui remplace « MAD » partout où le produit affiche un montant de l'artisan : prix des panneaux et des chants, coût d'un plan, devis, rapports PDF, dans les trois langues.
- Le dirham reste la valeur par défaut ; les comptes existants ne voient aucun changement.
- La devise est un libellé : aucun taux de change, aucune conversion des prix déjà saisis.
- Les tarifs catalogue des panneaux, relevés au Maroc, ne sont proposés qu'aux comptes en dirhams. Les autres saisissent leurs prix.
- Le prix des crédits n'est pas concerné : il reste en dollars par carte et en dirhams au Maroc.

La liste des devises dépend de la question ouverte 4. La devise proposée à l'inscription (déduite de la langue, du pays, ou demandée) est laissée au constructeur.

### Lot 8 — E-mail de solde bas

- Quand le solde d'un compte passe sous un seuil, puis quand il atteint zéro, le compte reçoit un e-mail dans sa langue, avec un lien vers la page crédits du site. Un seul envoi par seuil et par recharge.
- Cet e-mail part pour tous les comptes, web compris : il sert aussi les clients marocains.
- Il demande un service d'envoi d'e-mails et la configuration du domaine `qatlia.ma` pour l'expédition, ce qui est une nouvelle dépendance et un nouveau prestataire à citer dans la page confidentialité.
- L'e-mail ne cite pas de nombre de crédits par action.

Le seuil, le service d'envoi et le moment exact de l'envoi sont laissés au constructeur.

### Lot 9 — Fiche régionale

- Le propriétaire ouvre dans le Play Console les pays retenus à la question ouverte 4.
- La fiche du store gagne une version anglaise ; les versions française et arabe cessent de parler du Maroc seul.
- Les pages légales restent régies par le droit marocain ; leur texte le dit déjà et réserve les droits du pays du consommateur.

### Critère de fin de la phase 1b

L'app s'installe depuis le Play Store dans les pays retenus ; un compte de test réglé sur une autre devise produit un devis et un PDF sans « MAD » ; un compte de test dont le solde tombe à zéro reçoit l'e-mail et peut recharger par carte depuis le lien.

## Phase 2 — iPhone (esquisse)

Elle fera l'objet de sa propre conception quand la phase 1 sera en ligne : ce que la revue Google et les premiers utilisateurs auront appris la modifiera. Ce qui est déjà connu :

- **Enveloppe :** Capacitor, qui affiche `qatlia.ma`. Le mode app et la suppression de compte resservent tels quels ; seule la détection change.
- **Connexion :** Apple exige « Se connecter avec Apple » dès que Google est proposé (4.8). Retirer Google de l'app iPhone bloquerait les clients inscrits avec Google, donc **(choix du rédacteur)** on ajoute Apple et on garde Google, ouvert dans le navigateur du système avec retour dans l'app.
- **Fichiers :** téléchargement et partage des PDF/DXF par du code natif.
- **Au-delà du site emballé (4.2) :** partage natif, écran hors ligne natif. Un refus reste possible.
- **Crédits :** si Apple exige l'achat intégré, il faudra choisir entre l'ajouter sur iPhone seulement, à un prix qui absorbe la commission, et renoncer à l'App Store. Décision du propriétaire, à ce moment-là.
- **Moyens :** programme développeur Apple (99 $/an), compilation dans le cloud sur une machine macOS louée, un iPhone pour les essais.

## Questions ouvertes

1. **Compte Play.** *Réponse partielle du 2026-11-21 (capture du Play Console) : le compte existe, il est personnel, son nom de développeur est « DotProDev ». D'après les e-mails de Google (identité vérifiée le 10 août 2026, aucun message plus ancien), le compte date d'août 2026 : le test fermé de 12 testeurs pendant 14 jours s'applique, et le lot 3 a bien lieu. Restent à décider qui réunit les 12 testeurs, et à faire la déclaration de statut de commerçant que Google exige avant février 2027.* Question d'origine : Existe-t-il déjà ? Est-il personnel ou d'organisation ? Les conditions disent que QatliA est édité à titre individuel, ce qui laisse supposer un compte personnel. S'il est personnel, qui réunit les 12 testeurs ? La réponse fixe le calendrier et l'existence du lot 3.
2. **Réinscription après suppression.** Sans garde-fou, un client peut supprimer son compte et se réinscrire avec le même compte Google pour retrouver 20 crédits, indéfiniment. Proposition du rédacteur : l'empreinte d'e-mail décrite au lot 4.
3. **Archive des paiements.** Proposition du rédacteur : l'archive sans identité décrite au lot 4. L'alternative est de tout effacer avec le compte, ce qui fait disparaître les virements et le cash de la base.
4. **Pays visés en premier.** Quels pays d'Afrique et du Moyen-Orient ouvrir d'abord ? La réponse fixe la liste des devises du lot 7 et les pays cochés au lot 9. Proposition du rédacteur, faute d'indication : Algérie, Tunisie, Égypte, Arabie saoudite, Émirats, Sénégal, Côte d'Ivoire.
5. **Liens du bot WhatsApp (relevé du 21).** Quand l'app est installée, un lien `qatlia.ma/w/<code>` reçu sur WhatsApp doit-il s'ouvrir dans l'app ou dans le navigateur ? Dans l'app, l'artisan reste dans QatliA mais ne peut pas y acheter de crédits ; dans le navigateur, rien ne change par rapport à aujourd'hui. Proposition du rédacteur : dans l'app, parce que c'est le chemin que suivent la plupart des nouveaux clients.
6. **Devise hors Maroc et Europe (relevé du 21).** Le dollar suffit-il pour l'Afrique et le Moyen-Orient, ou faut-il des devises locales (dinar, livre égyptienne, riyal, franc CFA) ? La réponse dit si le lot 7 est clos.

## Laissé au constructeur

- L'implémentation exacte de la détection du mode app, dans le respect des trois propriétés du lot 1.
- La forme de la confirmation de suppression de compte, le schéma de la table d'archive et celui de l'empreinte d'e-mail.
- Le sort des deux clés étrangères sans cascade et des identifiants gardés dans le journal admin, une fois le relevé de production connu.
- Les corrections d'ergonomie du lot 5, à l'intérieur des critères.
- L'exclusion ou non de `/.well-known/` du `matcher` de `src/middleware.ts`.
- Les versions minimales d'Android et la configuration Bubblewrap au-delà de ce qui est fixé ici.
- Le découpage en PR à l'intérieur d'un lot.

## Sources

- App Store Review Guidelines, lues le 2026-11-14 : https://developer.apple.com/app-store/review/guidelines/
- Règles de paiement Google Play, lues le 2026-11-14 : https://support.google.com/googleplay/android-developer/answer/9858738
- Pays acceptés par Google Play pour les développeurs et les marchands, lu le 2026-11-14 : https://support.google.com/googleplay/android-developer/table/3539140
