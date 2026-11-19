# Lecture des fiches de débit envoyées au bot WhatsApp

Date : 2026-11-19 · Statut : en revue

## Pourquoi

Sur les 73 prospects arrivés par la pub du 15 au 18 novembre, 4 ont envoyé une photo, et 2 de ces photos étaient des fiches de débit écrites à la main. Aujourd'hui le bot leur répond par un texte qui renvoie vers l'atelier (`COPY.imageHint`) : le prospect doit tout recommencer sur le site, et la plupart ne le font pas.

Le but : qu'un prospect qui envoie sa fiche voie tout de suite que QatliA l'a comprise et combien de panneaux il lui faut, puis s'inscrive pour avoir le plan complet. La lecture photo existe déjà sur le site (`/api/vision`) ; il s'agit de la brancher sur le bot.

Le succès se mesure aux inscriptions dont la provenance est `whatsapp · photo` (voir « Mesure »).

## Ce que voit le prospect

1. Il envoie une photo de sa fiche dans WhatsApp.
2. Le bot répond tout de suite « 📸 Je lis votre fiche… » (la lecture prend 10 à 20 s).
3. Puis, en darija ou en français selon la règle de langue du bot :

   > ✅ 14 pièces lues · 3 panneaux 278×208 · 8 % de chute
   > Côté G 41,8 × 38 ×7 · Étagère 53,1 × 48 ×4 · … (+9 autres)
   > 👉 Voir le plan complet : https://qatlia.ma/w/k7m2qx9d…

4. Le lien ouvre l'atelier avec les pièces et le panneau déjà en place. Le plan complet et le PDF viennent **après l'inscription**, par le mécanisme existant (`src/lib/pending-work.ts` : le travail d'un visiteur est gardé pendant l'inscription).

## Décisions prises avec le propriétaire

- **Le résumé est dans la conversation ; le plan complet et le PDF seulement dans l'application, après inscription.** Aucun PDF n'est envoyé dans WhatsApp.
- **Panneau** : celui écrit sur la fiche s'il y en a un, sinon le panneau par défaut de l'atelier, `DEFAULT_STOCK_SHEET` (278 × 208 cm, MDF, `src/lib/cutting/binpacking.ts`). La réponse nomme toujours le panneau utilisé, pour qu'un artisan qui travaille avec un autre format comprenne le chiffre.
- **Une seule photo lue par numéro WhatsApp, définitivement.** À partir de la deuxième, le bot répond que la suite se fait dans l'application (avec le lien de sa première fiche s'il existe, sinon le lien de l'atelier).
- **Le lien porte un code court ; les pièces sont stockées chez nous** (option A). Rejetées : les pièces écrites dans le lien (lien de plusieurs centaines de caractères qui ressemble à du spam, modifiable, pas de suivi d'ouverture) ; garder la photo et la relire dans l'atelier après inscription (deux appels IA payés, et une image qui porte souvent le nom du client gardée chez nous).

## Objectifs

- Lire la photo avec exactement la même lecture que le site (même prompt, même normalisation).
- Répondre le résumé (pièces lues, panneaux, chute, panneau utilisé, premières lignes) et un lien vers l'atelier pré-rempli.
- Limiter la dépense : 1 lecture réussie par numéro, plafond global par jour.
- Mesurer : ouvertures du lien et inscriptions venues d'une photo.

## Non-objectifs (cette version)

- PDF ou image du plan envoyés dans WhatsApp.
- Fusion de plusieurs photos (fiche sur deux pages) : une photo, un résultat.
- Messages vocaux, documents PDF envoyés au bot.
- Utiliser dans l'atelier le panneau lu sur une photo prise **sur le site** : la lecture partagée le renvoie, l'interface du site n'en fait rien pour l'instant.

## Anti-objectifs (échec même si « ça marche »)

- Le bot devient un scanner gratuit et illimité (contournement du crédit payé sur le site).
- La photo est conservée chez nous.
- Un chiffre (panneaux, chute) présenté sans dire quel panneau a servi.
- Le plan complet obtenu sans inscription.
- La lecture du site change de comportement ou de facturation.

## Contraintes

- Production en ligne avec de vrais clients : PR seulement, suite de tests complète, comparer les échecs avec `main`.
- L'envoi des réponses passe par YCloud (Meta refuse l'envoi à notre app, code 10 — `docs/whatsapp-bot.md`). **Le téléchargement du média n'est pas encore vérifié** : à essayer d'abord avec l'API Graph (`GET /{version}/{media-id}` puis l'URL rendue, avec `WHATSAPP_ACCESS_TOKEN`) ; si Meta refuse aussi, passer par l'API média de YCloud. C'est la première étape du chantier, avant tout le reste, et c'est une porte : si ni Graph ni une recherche par identifiant chez YCloud ne rendent l'image, on s'arrête et on revient vers le propriétaire. Ajouter un second webhook entrant (YCloud) n'est pas dans ce chantier. *(Choix de Claude.)*
- Le webhook traite les messages pendant la requête (comme l'assistant IA aujourd'hui). Meta peut renvoyer un message si la réponse tarde ; le `wamid` UNIQUE de `whatsapp_messages` empêche déjà un second traitement. Donner au webhook `maxDuration = 60`.
- Next 14.2 : pas de `after()`. Pas de nouvelle dépendance pour un traitement en arrière-plan.
- Secrets jamais dans le dépôt ni la conversation ; ils vont dans Vercel.

## Conception

### 1. Lecture partagée

Extraire de `src/app/api/vision/route.ts` la partie « appel au modèle + extraction JSON + normalisation » dans un module serveur (par ex. `src/lib/vision/read-cut-list.ts`) :

- entrée : l'image en data URL ;
- sortie : `{ status: 'ok', pieces, sheet? } | { status: 'unreadable' } | { status: 'unavailable' } | { status: 'error', rateLimited }`.

`/api/vision` l'utilise sans changer son comportement : même prompt qu'aujourd'hui, mêmes réponses (pas de champ `sheet`), mêmes codes, même facturation (les tests existants le prouvent). Le mode démo hors production reste dans la route.

Le bot appelle la même lecture avec une option qui ajoute au prompt **une consigne de plus** : lire le format du panneau s'il est écrit sur la fiche (« panneau 280×207 », « لوحة 244×122 »…), le rendre dans `sheet` (hauteur, largeur, en cm) et ne pas le compter comme une pièce. Le site garde donc exactement sa lecture actuelle ; l'étendre au site sera une décision à part. *(Choix de Claude.)*

### 2. Stockage : migration 019

Une table `public.whatsapp_photo_reads`, accès par le rôle service seulement (RLS activé, aucune policy — comme les tables 016) :

| colonne | rôle |
|---|---|
| `id` uuid | clé |
| `wa_id` text | numéro du prospect |
| `status` text | `reading`, `ok`, `failed` |
| `code` text UNIQUE, nullable | code du lien, aléatoire (≥ 10 caractères base32, non devinable) ; posé quand `ok` |
| `pieces` jsonb, `sheet` jsonb | le résultat, purgés à l'expiration |
| `summary` jsonb | pièces, panneaux, chute (pour la réponse et le suivi) |
| `created_at`, `expires_at` (+7 jours), `opened_at` | |

- **Une lecture par numéro, sans course** : index unique partiel sur `wa_id` où `status in ('reading','ok')`. Le bot réserve sa lecture en insérant une ligne `reading` ; si l'insertion viole l'index, le numéro a déjà sa lecture (ou une en cours). Échec de lecture → `failed`, ce qui libère le numéro. Une ligne `reading` de plus de 2 minutes est considérée comme échouée.
- **Échecs par numéro** : au plus 3 lectures `failed` par numéro sur 24 h ; au-delà, `imageHint` sans appel IA. Sinon un seul numéro qui envoie des images quelconques épuiserait le plafond global pour tout le monde. *(Choix de Claude.)*
- **Plafond global** : nombre de lignes créées sur les dernières 24 h (tous statuts, car un échec coûte aussi un appel IA) comparé à `WHATSAPP_PHOTO_DAILY_CAP` (défaut 300 ; `0` coupe la fonction). Approximatif sous forte concurrence, c'est acceptable.
- **Expiration** : après 7 jours, `pieces`, `sheet` et `summary` passent à null (au plus tard à la prochaine lecture du lien, ou par une purge opportuniste) ; la ligne reste, pour que la règle « une photo par numéro » tienne.
- **La photo n'est jamais stockée** : elle ne vit qu'en mémoire pendant la lecture.

Migration absente → le bot garde la réponse d'aujourd'hui (`imageHint`), comme pour la 016.

### 3. Le bot

Dans `decide` (`src/lib/whatsapp/router.ts`), un message `image` devient une décision « lire la photo » au lieu de `imageHint`, sous les mêmes règles de mode et de portée que les autres messages (contact déjà passé à un humain → rien, etc.).

**Une photo l'emporte sur l'accueil** : aujourd'hui le premier message reçoit le menu d'accueil (étape 4 de `decide`) avant que la règle image (étape 6) soit vue. Une photo envoyée comme premier message, ou portant le referral de la pub, est lue au lieu de recevoir le menu ; le contact est alors marqué accueilli, pour ne pas recevoir le menu juste après. Ce sont exactement les prospects visés. *(Choix de Claude.)* La route du webhook exécute :

1. réserve la lecture (ligne `reading`) ; numéro déjà servi → message « la suite dans l'application » (avec son lien s'il est encore valide) ; plafond atteint ou fonction coupée → `imageHint` ;
2. envoie « 📸 Je lis votre fiche… » ;
3. télécharge le média (type image, taille raisonnable, ≤ 5 Mo) et le passe en data URL ;
4. lecture partagée ; pas une fiche ou illisible → `failed` + `imageHint` (aujourd'hui) ;
5. optimisation côté serveur avec le module de calcul existant (`src/lib/cutting/binpacking.ts`, mode 2D, matériau MDF), panneau lu ou `DEFAULT_STOCK_SHEET` → nombre de panneaux et chute ;
6. enregistre `ok` + code + résultat, envoie le résumé et le lien.

Le payload (`src/lib/whatsapp/payload.ts`) doit garder l'`id` et le `mime_type` de l'image (aujourd'hui seule la légende est lue). Les textes vont dans `src/lib/whatsapp/copy.ts`, en français et en arabe, avec la règle « كريدي » déjà en place.

### 4. Le lien `/w/[code]`

- `https://qatlia.ma/w/<code>?utm_source=whatsapp&utm_medium=bot&utm_campaign=photo`.
- La page lit la ligne par son code (service role, côté serveur), marque `opened_at` à la première ouverture, puis donne les pièces et le panneau à l'atelier par le mécanisme qu'il connaît déjà pour reprendre un travail (brouillon d'atelier `src/lib/atelier-draft.ts` ou équivalent), et y redirige. Nom du projet : « Fiche WhatsApp ».
- Code inconnu ou expiré → page simple « Ce lien a expiré » avec un bouton vers l'atelier.
- Le visiteur voit ses pièces sans compte ; « Optimiser » lui demande de s'inscrire, et le travail est gardé (`pending-work`). Après inscription, l'optimisation coûte 1 crédit pris sur les crédits offerts : pas de passe d'analyse, puisqu'il n'y a pas eu de lecture payée sur le site. C'est voulu.

### 5. Mesure

- Inscriptions : la provenance (PR #77/#78) note `whatsapp · photo`. Limite connue : la première visite gagne, donc un prospect déjà venu par un autre lien du bot reste `whatsapp` sans campagne.
- `docs/whatsapp-bot.md` : section « Lecture photo » avec la migration à appliquer, `WHATSAPP_PHOTO_DAILY_CAP`, et les requêtes SQL de suivi (lectures par statut et par jour, liens ouverts, inscriptions `photo`).

## Tests attendus

- Lecture partagée : extraction et normalisation (cas existants de `/api/vision` déplacés), panneau lu ou absent.
- `/api/vision` : comportement inchangé.
- Webhook : photo lue → deux envois (attente, résumé avec lien) ; deuxième photo du même numéro → message « dans l'application », aucun appel IA ; plafond atteint ; lecture en échec → `imageHint` et numéro libéré ; média introuvable ; migration absente.
- Optimisation du résumé : panneau par défaut, panneau lu, pièce plus grande que le panneau.
- `/w/[code]` : code valide, expiré, inconnu ; `opened_at` posé une seule fois.

## Laissé au constructeur

- Noms des fichiers et des fonctions, forme exacte du code, longueur du code (≥ 10 caractères).
- Formulation des messages, en français et en darija : elle sera relue par le propriétaire dans la PR.
- Comment l'atelier reçoit le travail venu de `/w/[code]`, tant que c'est par un mécanisme de reprise existant et sans changer le comportement de l'atelier pour les autres cas.
- Le choix Graph ou YCloud pour le média, selon l'essai de la première étape.
