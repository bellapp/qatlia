# Jusqu'à 4 fiches de mesure par projet — Conception

Date : 2026-11-17. Base de lecture : `main` à `6ddadc4` (PR #67).

## Pourquoi

Un client a des projets dont la liste de pièces ne tient pas sur une seule feuille. Il l'écrit sur plusieurs feuilles, jusqu'à quatre. Pour lui c'est **une seule fiche de mesure**, simplement trop longue pour une page.

Aujourd'hui l'atelier ne tient qu'une fiche par projet : une deuxième photo **remplace** les pièces de la première (`src/app/(site)/atelier/page.tsx`, `runScan`, `setPieces(normalizePiecesWithColors(newPieces))`). Le client ne peut donc pas obtenir un plan de coupe pour tout son projet.

## Ce que le propriétaire a décidé

1. **Jusqu'à 4 fiches par projet.**
2. **Les pièces des 4 fiches se fondent dans une seule liste et un seul plan de coupe**, « comme si on avait une grande fiche ».
3. **Règle de crédits B : un crédit par projet.** La première fiche lue coûte 1 crédit ; les 3 suivantes du même projet sont comprises. La promesse du site « 1 crédit par analyse complète » reste vraie.
4. **Chaque fiche est lue comme la première, avec la méthode actuelle**, jugée fiable. Le texte donné à l'IA dans `/api/vision` ne change pas, et rien n'est transmis d'une fiche à la suivante.

Tout le reste de ce document est un choix du rédacteur, marqué *(choix)* quand il change ce que l'artisan voit ou paie.

## Buts

- Photographier ou importer jusqu'à 4 fiches dans un même projet ; chaque fiche ajoute ses pièces à la suite.
- Un seul plan de coupe, un seul PDF, une seule entrée d'historique pour le projet.
- Les 4 images restent consultables en grand dans l'atelier et dans l'historique. L'espace admin montre les vignettes, comme aujourd'hui (il n'a pas d'accès aux images privées, et n'en reçoit pas).
- 1 crédit pour le projet, la limite de 4 étant tenue par le serveur.
- Retirer une fiche lue par erreur sans retaper les autres.

## Hors périmètre

- Plus de 4 fiches par projet.
- Fusionner deux lignes identiques venues de deux fiches : elles restent deux lignes, pour que l'artisan puisse comparer avec son papier.
- Afficher le numéro de fiche dans le PDF, le devis ou les exports. Le PDF ne change pas.
- Lire les photos depuis le bot WhatsApp (il renvoie déjà vers l'atelier).
- Afficher dans l'espace admin le nombre de lectures comprises (non débitées).
- Alléger la liste de l'historique (lot 4 du plan « historique », toujours ouvert).
- Corriger le texte légal sur la conservation des photos (voir « Constat à part »).
- Adapter la lecture aux feuilles de suite sans en-têtes. La lecture actuelle repère les chants et la quantité par l'en-tête de leur colonne ; une feuille 2, 3 ou 4 écrite sans en-têtes peut donc perdre ses chants. Décision n° 4 : on garde la méthode actuelle. Si le cas se présente chez un client, ce sera un chantier à part, avec ses photos pour le tester.

## À éviter absolument

- **Débiter plus d'un crédit** pour les fiches 2 à 4 d'un projet dont la première vient d'être payée.
- **Laisser lire plus de 4 fiches pour un crédit**, même avec deux envois simultanés ou un navigateur modifié.
- **Perdre les pièces déjà lues** quand une fiche suivante est illisible, refusée ou en erreur.
- **Changer quoi que ce soit pour un projet à une seule fiche** : même écran utile, même prix, mêmes projets déjà enregistrés qui se rouvrent comme avant.
- Faire payer une photo illisible : comme aujourd'hui, elle ne coûte ni crédit ni lecture.

## Façons de faire étudiées

| | Comment | Pour | Contre |
|---|---|---|---|
| **1. Compteur gardé par le serveur** (retenu) | La première fiche débite le crédit et ouvre un groupe de 4 lectures valable 24 h. Les suivantes présentent le numéro du groupe ; le serveur incrémente le compteur en une seule instruction. | La limite de 4 est sûre. L'artisan ajoute ses fiches une par une, quand il veut dans la fenêtre. | Une migration, une table. |
| 2. Compteur dans le laissez-passer du navigateur | Étendre le laissez-passer signé des recalculs (`analysis-pass.ts`) avec un nombre de lectures. | Aucune table. | Le laissez-passer est sans état : le même se rejoue, donc lectures gratuites sans limite pendant 24 h. |
| 3. Les 4 photos en un seul appel | Une requête, un appel IA avec 4 images, un débit. | Aucun compteur. | L'artisan doit avoir ses 4 photos d'avance ; une photo floue fait tout échouer ; 4 pages pleines dépassent le plafond de réponse (`max_tokens: 8000`) et approchent la limite de 60 s. |

Le propriétaire parle du résultat et laisse la technique : la façon 1 est le choix du rédacteur.

## Ce que voit l'artisan

Zone de scan de l'atelier, après deux fiches lues :

```
[ 📷 Ajouter une fiche ]   [ 🖼 Importer ]
      Lecture IA · jusqu'à 4 fiches par analyse

Fiches lues  2 / 4
┌────┐  Fiche 1 · 23 pièces                    ✕
└────┘
┌────┐  Fiche 2 · 18 pièces                    ✕
└────┘
```

- **Avant la première fiche**, la zone est celle d'aujourd'hui, avec en plus la mention « jusqu'à 4 fiches par analyse ».
- **La première fiche d'un projet remplace la liste à l'écran**, comme aujourd'hui (elle efface les pièces d'exemple). *(choix)*
- **Les fiches 2 à 4 ajoutent leurs pièces à la fin**, dans l'ordre de lecture. Les pièces sans nom continuent la numérotation (« Pièce 24 », pas « Pièce 1 »).
- **Chaque fiche a sa vignette** : un appui l'ouvre en grand ; dans la visionneuse, des flèches passent d'une fiche à l'autre.
- **Retirer une fiche (✕)** demande confirmation, puis enlève son image et toutes les pièces venues d'elle, même corrigées à la main. Les pièces ajoutées à la main restent. Les fiches suivantes sont renumérotées. Retirer une fiche ne rend pas la lecture : le serveur compte les lectures, pas les fiches présentes. *(choix)*
- **À 4 fiches**, les deux boutons sont inactifs et un message le dit : « 4 fiches sur 4. Retirez-en une ou commencez un nouveau débit. »
- **Importer accepte plusieurs photos d'un coup** ; elles sont lues l'une après l'autre, dans l'ordre choisi, jusqu'à remplir les places libres. Les photos en trop sont ignorées et un message le dit. L'appareil photo reste à une photo à la fois. *(choix)*
- **Dans la liste des pièces**, dès que le projet a deux fiches, chaque pièce lue porte une petite marque « F1 » à « F4 ». Avec une seule fiche, aucune marque. *(choix)*
- **Fiche illisible ou erreur** : le message d'erreur actuel s'affiche, les fiches et les pièces déjà là ne bougent pas.
- **Après un ajout**, le plan affiché se comporte comme après toute modification de pièce aujourd'hui : l'artisan relance le calcul, gratuit dans la fenêtre de 24 h.
- **« Nouveau débit »** vide les 4 fiches et oublie le groupe de lectures.
- **Projet rouvert depuis l'historique** : ses fiches reviennent avec leurs vignettes. Y ajouter une fiche est possible s'il en a moins de 4 ; elle est comprise si le groupe de lectures **de ce projet** est encore valable, sinon elle coûte 1 crédit et ouvre un nouveau groupe. *(choix)*

Historique : la carte et la ligne du tableau montrent la vignette de la fiche 1, avec une pastille « 4 fiches » quand il y en a plusieurs ; la visionneuse fait défiler les fiches. Espace admin (fiche client) : toutes les vignettes du projet.

## Crédits : la règle exacte

- Un **groupe de lectures** = 4 lectures de photo réussies, pendant 24 h (`ANALYSIS_WINDOW_HOURS`), pour un artisan. Constante nouvelle dans `src/lib/billing/policy.ts` : `MAX_SCANS_PER_ANALYSIS = 4`.
- Le groupe est ouvert par une **lecture payée**. La lecture payée compte pour 1.
- Une lecture **comprise** (2ᵉ à 4ᵉ) ne débite rien et n'écrit rien dans le journal des crédits : les statistiques admin « analyses photo » continuent de compter les analyses payées.
- Un projet saisi à la main puis optimisé a payé son analyse par l'optimisation ; s'il reçoit ensuite une photo, cette photo coûte 1 crédit comme aujourd'hui et ouvre un groupe. *(choix : seule une lecture payée ouvre un groupe)*
- Seule une lecture payée délivre un nouveau laissez-passer de recalcul. Une lecture comprise n'allonge pas les 24 h de recalculs gratuits. *(choix)*
- **Le groupe suit le projet à l'écran, pas le navigateur.** *(choix)* Son numéro vit dans l'état de l'atelier avec les fiches, et il est enregistré avec le projet (`options_json.scanGroup`, un UUID validé). Il n'est pas gardé dans une clé globale du navigateur. Conséquences :
  - **« Nouveau débit »** l'oublie : la fiche suivante est une première fiche, payée.
  - **Rouvrir un projet de l'historique** remplace le groupe en cours par celui du projet rouvert (ou par aucun). Le groupe du projet A ne couvre jamais une fiche ajoutée au projet C.
  - **Recharger la page** vide l'atelier comme aujourd'hui (il ne garde pas de brouillon) et le groupe avec. Un projet déjà optimisé se retrouve dans l'historique, avec son groupe.
  - **Retirer la seule fiche puis la rephotographier**, sans quitter le projet : la reprise est comprise s'il reste des lectures.
- Le serveur ne peut pas vérifier qu'une fiche appartient bien « au même projet » : le projet n'a pas d'identifiant serveur avant sa première optimisation. Un artisan peut donc lire 4 fiches de chantiers différents pour 1 crédit en 24 h, en les ajoutant au même projet puis en retirant les précédentes. C'est le risque accepté avec la règle B ; la limite de 4 lectures et de 24 h est, elle, tenue par le serveur.

### Déroulé dans `/api/vision`

Le corps accepte un champ facultatif `scanGroup` (UUID).

1. Session, validation, frein anti-rafale : inchangés.
2. Si `scanGroup` est donné et que le groupe appartient à l'artisan, a moins de 24 h et moins de 4 lectures : la lecture est **couverte**, on saute la vérification du solde. Sinon : vérification du solde comme aujourd'hui (refus 402 à zéro).
3. Appel IA. Échec ou rien de lisible : rien n'est consommé, ni crédit ni lecture.
4. Lecture réussie et couverte : incrément du groupe, en une instruction qui échoue si le groupe est plein ou périmé. Si l'incrément échoue (deux envois en course), on retombe sur le cas payé.
5. Lecture réussie et payée : `consume_credit` comme aujourd'hui, puis ouverture d'un nouveau groupe. Solde insuffisant : 402, résultat non montré, comme aujourd'hui.
6. Réponse : les champs actuels, plus `scanGroup` (numéro du groupe en cours) et `scansLeft` (lectures restantes). `creditsCharged` vaut 0 pour une lecture comprise.

**Si la migration n'est pas encore passée en production**, ou si l'ouverture du groupe échoue : la réponse ne porte pas de `scanGroup`, chaque fiche est payée au prix d'aujourd'hui, et l'erreur est journalisée. Le code peut donc être déployé avant ou après la migration sans casse.

### Base de données

Migration `018_scan_groups.sql`. `FULL_DATABASE_SETUP.sql` n'est plus tenu à jour (il n'a ni le bucket `scans` ni les migrations 016 et 017) : on n'y touche pas.

- Table `scan_groups` : `id` UUID, `user_id` → `profiles`, `reads_used` entier de 1 à 4 (défaut 1), `created_at`. Sécurité par ligne activée, aucune politique : seul le rôle de service y touche, comme le bucket `scans`.
- Fonction `open_scan_group(p_user_id)` → UUID du groupe créé.
- Fonction `claim_scan_read(p_user_id, p_group_id)` → incrémente si le groupe est à l'artisan, a moins de 24 h et moins de 4 lectures ; répond succès ou échec, sans lever d'erreur.
- Une lecture seule (« le groupe a-t-il de la place ? ») pour l'étape 2 ; la décision reste l'incrément de l'étape 4.
- Droits d'exécution au seul `service_role`, comme `consume_credit` (migration 005).

`consume_credit` n'est pas modifiée.

## Ce qui est enregistré avec le projet

- `options_json.scans` : liste ordonnée de 1 à 4 fiches, chacune `{ thumb?, path? }`. `thumb` est la vignette ; `path` est le chemin de l'image 1600 px dans le bucket privé.
- **Le poids des vignettes d'un projet ne dépasse pas celui d'aujourd'hui.** *(choix)* `GET /api/projects` renvoie tout `options_json` de chaque projet, sans pagination, et chaque relance d'optimisation crée une entrée de plus : quatre vignettes au plafond actuel feraient 600 000 caractères par entrée et pourraient faire échouer l'historique du client même qui demande ce chantier. Donc : avec une seule fiche, vignette de 600 px comme aujourd'hui ; avec plusieurs, des vignettes plus petites, de sorte que **leur somme** reste sous `SCAN_THUMB_MAX_CHARS`. Le serveur vérifie la somme ; une vignette qui la ferait dépasser est écartée (son entrée reste). Les vignettes sont refaites quand le nombre de fiches change, à partir de ce que l'atelier a en mémoire (l'image lue, sinon la vignette existante). La taille exacte est laissée à celui qui construit.
- La position dans la liste est le numéro de la fiche. Chaque pièce lue garde le numéro de sa fiche dans un champ facultatif. Une entrée dont la vignette ou le chemin est refusé reste dans la liste, vide, pour que les numéros des pièces restent justes.
- **Anciens projets** : `scanThumb` et `scanPath` se lisent comme une liste d'une fiche. Une seule fonction de lecture sert partout (atelier, historique, admin, lien signé). Les nouveaux enregistrements n'écrivent que `scans`. *(choix : pas de double écriture ; un onglet resté ouvert sur l'ancienne version ne verra pas les images d'un projet neuf, sans rien abîmer)*
- Validation : `pickProjectHistoryMetadata` (`src/lib/projects/history-metadata.ts`) apprend `scans` et `scanGroup` : au plus 4 entrées, chaque vignette par `sanitizeScanThumb` puis le contrôle de la somme, chaque chemin par `isOwnScanPath`, le groupe comme un UUID. Rien n'entre brut.

### Images en taille lisible

- L'envoi (`POST /api/scans`) ne change pas : une image par appel. Son frein (10 par minute) laisse passer 4 envois.
- Comme aujourd'hui, l'enregistrement du projet n'attend pas les images. Ensuite les images neuves sont envoyées, puis **un seul** `PATCH /api/projects/[id]` rattache tous les chemins par position. Un seul, parce que ce PATCH relit puis réécrit `options_json` : quatre en parallèle s'écraseraient.
- Une image dont l'envoi échoue laisse sa fiche avec la vignette seule ; les autres sont rattachées.
- Un projet ré-enregistré (chaque relance d'optimisation crée une entrée, comme aujourd'hui) réutilise les chemins déjà connus, sans renvoyer les images.
- `GET /api/projects/[id]/scan` accepte `?n=1..4` (défaut 1) et signe le lien de cette fiche. Le cache de liens de la visionneuse est par projet et par fiche.
- L'ancien `PATCH { scanPath }` continue de fonctionner pour les onglets restés sur l'ancienne version.

## Textes

Tout nouveau texte existe en français, anglais et arabe, et tient en sens droite-à-gauche. Les phrases qui décrivent ce que couvre un crédit sont mises à jour pour dire « jusqu'à 4 photos de fiches d'un même projet » : la phrase `policy` de la page des crédits (`fr.ts:750`, `en.ts:676`, `ar.ts:677`), les conditions (`legal/*`, article sur les crédits), le bot WhatsApp (`src/lib/whatsapp/copy.ts`, `assistant.ts`). La phrase `policy` écrit aujourd'hui « 1 crédit » et « 24 h » en dur ; le chiffre 4 y est passé en paramètre depuis la constante, pas recopié.

## Livraison

Trois PR, dans cet ordre, pour que le client ne paie jamais 4 crédits en attendant :

1. **Décompte côté serveur.** Migration, `policy.ts`, `/api/vision` (champ `scanGroup`). Invisible tant que l'atelier ne l'envoie pas.
2. **Atelier à plusieurs fiches.** Ajout au lieu de remplacement, vignettes, retrait, marques F1–F4, import multiple, limite de 4, enregistrement de `scans` (vignettes), lecture des anciens projets, textes.
3. **Images en grand ×4.** Envoi et rattachement des 4 images, lien signé par fiche, flèches dans la visionneuse, pastille dans l'historique, vignettes dans l'admin.

Après la PR 2 et avant la PR 3, seule la fiche 1 d'un projet enregistré s'ouvre en taille lisible ; les autres s'ouvrent en petite vignette, marquée « réduite » par la visionneuse actuelle. La PR 3 doit donc suivre la PR 2 de près.

## Contraintes

Celles du plan « historique » (`docs/superpowers/plans/2026-11-14-historique-projets.md`, section Global Constraints) valent ici : production en ligne, une PR par lot et jamais de push sur `main` ; `npx tsc --noEmit` et `npm run test:node` avant chaque PR en comparant les échecs à ceux de `main` ; travail dans `.claude/worktrees/` ; l'application ne démarre pas en local, donc rendu vérifié côté serveur et specs `e2e/` écrites mais notées non lancées ; `tests/claims-audit.test.js` refuse un pourcentage dans une chaîne de `src/`.

S'y ajoute : la migration 018 doit être passée à la main sur la base de production par le propriétaire. La PR 1 le rappelle dans sa description.

## Cas à vérifier en revue

1. Deux fiches envoyées en même temps sur un groupe à 3 lectures : une seule est comprise, l'autre est payée ou refusée à solde nul.
2. Solde à zéro, groupe ouvert avec de la place : la fiche suivante est lue sans refus 402.
3. Groupe d'un autre artisan, groupe périmé, identifiant inventé : traités comme absence de groupe.
4. Fiche 3 illisible : fiches 1 et 2 intactes, aucune lecture consommée.
5. Retrait de la fiche 2 sur 3 : ses pièces partent, celles de la fiche 3 deviennent F2, leur image suit.
6. Projet enregistré avant ce changement : il se rouvre avec son image, se ré-enregistre au nouveau format sans la perdre.
7. Chemin d'image d'un autre artisan glissé dans `scans` : ignoré, jamais stocké ni signé.
8. Migration absente : les fiches sont lues et payées une à une, sans erreur à l'écran.
9. Projet A en cours avec un groupe ouvert, puis projet C rouvert depuis l'historique : la fiche ajoutée à C n'utilise pas le groupe de A.
10. Projet de 4 fiches enregistré : la somme de ses vignettes tient sous le plafond d'une vignette d'aujourd'hui.

## Laissé à celui qui construit

- Le découpage du code. `atelier/page.tsx` fait plus de 2 500 lignes : la logique des fiches (ajout, retrait, renumérotation, lecture des anciens formats) a sa place dans un module pur sous `src/lib/projects/`, et la zone de scan dans un composant.
- Le nom du champ qui porte le numéro de fiche sur une pièce, et la vérification qu'il traverse `/api/optimize` et l'enregistrement sans gêner.
- La forme interne du gardien d'images (`createScanKeeper`) pour quatre images.
- Le dessin exact des vignettes, de la pastille et des flèches, dans le style existant.

## Constat à part

Les mentions légales disent que les photos ne sont pas gardées : « QatliA ne les enregistre pas » et « Photos : non conservées par QatliA après l'analyse » (`src/i18n/messages/legal/fr.ts`, lignes 132 et 171). Depuis le lot « image du scan » (migration 017), l'image 1600 px est gardée dans un bucket privé. Ce n'est pas causé par ce chantier, mais il fera garder jusqu'à 4 images par projet. À traiter par une décision du propriétaire, hors de ces trois PR.
