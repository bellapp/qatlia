# Bot WhatsApp QatliA

Ce document est destiné au propriétaire. Il décrit ce qu'il faut faire côté Meta pour que le bot WhatsApp de QatliA puisse fonctionner. Aucune ligne de code n'est à écrire : tout se fait dans les tableaux de bord Meta et Vercel.

## Ce que fait le bot

Le bot répond aux messages WhatsApp reçus sur le numéro de QatliA (06 00 93 75 23) :

- un nouveau contact reçoit un **accueil court** qui commence par la seule chose à faire : « envoyez-moi ici la photo de votre fiche de débit », puis « ou envoyez un vocal » (cette ligne disparaît si les vocaux sont coupés), le lien de la démo et les 3 boutons. Un premier message écrit en lettres arabes (y compris le message arabe pré-rempli par la pub) reçoit l'accueil en darija seulement ; tout autre premier message reçoit les deux langues, celle du contact en premier. L'accueil précédent, long et sans cette invitation, faisait partir 59 % des prospects de la pub sans une seconde réponse (80 conversations, 14-20/11/2026) ;

- les choix 1, 2 et 3 reçoivent des réponses fixes (les mêmes textes que les réponses rapides) ;
- le texte libre est traité par l'IA, qui s'appuie uniquement sur les informations du code de QatliA (prix, offres, FAQ) ;
- un **vocal est écouté** : le bot le transcrit et y répond comme à un texte tapé (voir « Messages vocaux ») ;
- les vidéos, documents, localisations et contacts sont passés à un humain ;
- le bot répond en français ou en arabe selon la langue du prospect. Un premier contact venu de la publicité reçoit la darija par défaut, comme la pub : le message que WhatsApp pré-remplit (« Bonjour ! Puis-je en savoir plus… ») suit la langue du téléphone et ne dit rien de la personne. Le message pré-rempli en arabe, lui, vient d'un téléphone en arabe : il met la darija, même pour un contact connu en français. Le bot passe au français dès que la personne écrit en français ;
- une personne déjà accueillie qui revient par la publicité reçoit de nouveau le menu à boutons (pas une présentation écrite par l'IA) ;
- juste après l'accueil, le bot envoie **une photo d'exemple de fiche de débit** (`public/whatsapp/exemple-fiche.jpg`, servie à `qatlia.ma/whatsapp/exemple-fiche.jpg`) avec la légende « 📸 بحال هادي: لائحة البياسات (الطول × العرض × العدد)… » : beaucoup de prospects ne savent pas ce qu'est une « ورقة القياسات » et certains envoient un dessin du meuble. Si l'image ne part pas, l'échec est seulement noté (`send_failed`) : l'accueil, lui, est déjà parti. Pour changer l'exemple, remplacer ce fichier par une autre photo JPEG de moins de 5 Mo **avec un profil couleur intégré** (YCloud l'exige) ;
- une photo de fiche de débit est **lue par le bot**, une seule fois par numéro (voir « Lecture photo ») : il répond le nombre de pièces, de panneaux et la chute, avec un lien qui ouvre l'atelier sur ces pièces. Une photo que le bot n'arrive pas à lire reçoit un message qui demande une photo plus nette, avec le lien de l'atelier ; quand la lecture n'est pas possible (plafond atteint, lecture coupée), la photo reçoit le lien direct de l'atelier (`qatlia.ma/wa/atelier`) ;
- **en coexistence, le bot ne répond qu'aux personnes venues de la publicité** (Click-to-WhatsApp). Les clients existants qui écrivent à la ligne de support continuent de n'avoir que vous comme interlocuteur. Avec `WHATSAPP_BOT_SCOPE=all`, le bot répond à tout le monde ;
- **chaque passage à un humain** (vocal que le bot n'a pas compris, choix 3, réponse envoyée depuis l'app, question hors des informations de QatliA) fait taire le bot pour ce contact pendant 24 h.

Le bot peut être éteint à tout moment avec la variable `WHATSAPP_BOT_ENABLED` : tant qu'elle n'est pas égale à `true`, il enregistre les messages entrants mais n'envoie rien.

## Les deux modes : coexistence ou redirect

Le même numéro peut être utilisé de deux façons. La variable `WHATSAPP_HANDOFF_MODE` indique laquelle.

- **`coexistence` (mode visé, valeur par défaut).** Le numéro 06 00 93 75 23 reste dans l'app WhatsApp Business et il est aussi branché à l'API. Vous voyez toutes les conversations dans l'app et vous pouvez répondre à tout moment. Quand vous écrivez à un contact depuis l'app, le bot se tait pour ce contact pendant 24 h.
- **`redirect` (repli si Meta refuse la coexistence pour ce numéro).** Le bot tourne sur un **second numéro**, dédié à l'API. La publicité doit alors pointer vers ce second numéro. Quand un prospect demande un humain, le bot envoie le lien `wa.me` du numéro humain et **ne se tait pas**.

Le choix entre les deux se fait à l'étape 2 de la mise en place ci-dessous.

## Numéro en production

État au 14 novembre 2026 : le bot tourne en mode `redirect` sur un numéro dédié. Le 06 00 93 75 23 reste le numéro humain, dans l'app WhatsApp Business.

| Élément | Valeur |
| --- | --- |
| Numéro du bot | +212 7 26 26 36 86 (SIM Inwi), nom affiché « QatliA » |
| Compte WhatsApp (WABA) | QatliA, ID `1154142957108260`, dans le portefeuille business QatliA |
| ID du numéro (`WHATSAPP_PHONE_NUMBER_ID`) | `1475318458992904` |
| App Meta | Qatlia bot, ID `2912965159085885`, publiée (mode live) |
| Utilisateur système | `qatlia-bot`, accès total à l'app et au compte WhatsApp QatliA |

**Pourquoi YCloud.** Meta refusait d'ajouter un numéro directement au portefeuille QatliA (erreur #2494070 : entreprise non vérifiée et portefeuille récent). L'inscription est passée par YCloud (fournisseur officiel, plan gratuit), avec l'option « Create and connect a new WhatsApp Business Platform account » et le compte WhatsApp QatliA déjà existant. Le compte YCloud doit rester connecté : le supprimer pourrait déconnecter le numéro.

**Code PIN de vérification en deux étapes.** Un code PIN à 6 chiffres a été défini le 14 novembre 2026 en enregistrant le numéro avec notre app. Meta le demande pour enregistrer de nouveau le numéro ou le déplacer vers un autre fournisseur. Sa valeur n'est **jamais** écrite dans ce dépôt : elle est rangée hors du dépôt, dans `C:\Users\zbook\qatlia-whatsapp-pin.txt`, à recopier dans un gestionnaire de mots de passe.

**Envoi des réponses.** Notre app reçoit bien les messages du numéro, mais Meta lui refuse l'envoi (code 10, « Application does not have permission for this action ») : seul YCloud, par qui le numéro a été inscrit, peut envoyer. Les réponses du bot doivent donc passer par l'API de YCloud.

## Variables d'environnement

Les noms ci-dessous sont exacts. Les valeurs ne doivent jamais être écrites dans ce dépôt ni dans une conversation : elles se saisissent uniquement dans Vercel.

| Variable | Rôle |
| --- | --- |
| `WHATSAPP_PHONE_NUMBER_ID` | Identifiant du numéro WhatsApp dans Meta |
| `WHATSAPP_APP_SECRET` | Secret de l'app Meta (sert à vérifier la signature des messages reçus) |
| `WHATSAPP_ACCESS_TOKEN` | Jeton permanent de l'utilisateur système |
| `WHATSAPP_VERIFY_TOKEN` | Chaîne aléatoire que vous choisissez, utilisée pour la vérification du webhook |
| `WHATSAPP_GRAPH_VERSION` | Version courante de l'API Graph (défaut `v23.0`, à confirmer à l'étape 4) |
| `WHATSAPP_BOT_ENABLED` | `true` pour allumer le bot, toute autre valeur l'éteint |
| `WHATSAPP_HANDOFF_MODE` | `coexistence` (défaut) ou `redirect` |
| `WHATSAPP_BOT_SCOPE` | `ads` (par défaut) : en coexistence, le bot ne répond qu'aux contacts venus de la publicité. `all` : il répond à tout le monde. Sans effet en mode `redirect`, où le bot répond toujours à tout le monde |
| `WHATSAPP_BOT_MODEL` | Facultative. Modèle IA utilisé (défaut : `OPENROUTER_MODEL`, puis `google/gemini-3.7-flash`) |
| `OPENROUTER_API_KEY` | Existe déjà (utilisée aussi par le scan) : rien à faire |
| `YCLOUD_API_KEY` | Facultative. Clé API YCloud (YCloud → Developers → API Keys). Avec `WHATSAPP_FROM_NUMBER`, les réponses du bot partent par YCloud au lieu de l'API Meta : c'est obligatoire quand le numéro a été inscrit par YCloud |
| `WHATSAPP_FROM_NUMBER` | Facultative. Numéro du bot au format international (`+212726263686`), utilisé comme expéditeur par YCloud |
| `WHATSAPP_PHOTO_DAILY_CAP` | Facultative. Nombre de photos que le bot peut lire sur 24 h, tous numéros confondus (défaut `300`). `0` coupe la lecture photo : les photos reçoivent alors le lien de l'atelier |
| `WHATSAPP_VOICE_ENABLED` | Facultative. `false` coupe l'écoute des vocaux : ils reçoivent de nouveau « Je ne peux pas encore ouvrir ce type de message… » et passent à un humain. Allumée par défaut (il faut aussi `OPENROUTER_API_KEY`) |
| `WHATSAPP_VOICE_MODEL` | Facultative. Modèle OpenRouter qui transcrit les vocaux (défaut `google/gemini-3.7-flash`). Il doit comprendre l'audio ; il est séparé de `WHATSAPP_BOT_MODEL` pour cette raison |

## Mise en place

À faire dans l'ordre. Cochez chaque case une fois l'étape terminée.

- [ ] **1. Créer l'app Meta.** Dans Meta Business Suite, vérifier l'entreprise (si Meta le demande), puis créer une app Meta de type « Business » avec le produit WhatsApp.
- [ ] **2. Brancher le numéro en coexistence.** Lancer l'inscription de **coexistence** avec le numéro 06 00 93 75 23 (scan d'un QR code depuis l'app WhatsApp Business).
  - Si Meta accepte : le mode est `coexistence`.
  - Si Meta refuse le numéro ou le pays : noter « mode redirect », acheter ou dédier un second numéro à l'API, et prévoir de changer la destination de la publicité vers ce numéro.
- [ ] **3. Créer un jeton permanent.** Créer un **utilisateur système** et lui générer un **jeton permanent** avec les permissions `whatsapp_business_messaging` et `whatsapp_business_management`. Ne pas utiliser le jeton temporaire du tableau de bord : il expire en 24 h. Ce jeton sera la valeur de `WHATSAPP_ACCESS_TOKEN`.
- [ ] **4. Relever les valeurs.** Noter, dans un endroit privé (jamais dans le dépôt) :
  - `WHATSAPP_PHONE_NUMBER_ID`
  - le secret de l'app, pour `WHATSAPP_APP_SECRET`
  - la version courante de l'API Graph, pour `WHATSAPP_GRAPH_VERSION`
  - une chaîne aléatoire de votre choix, pour `WHATSAPP_VERIFY_TOKEN`
- [ ] **5. Ajouter les variables sur Vercel (Production).** Ajouter toutes les variables du tableau ci-dessus, avec :
  - `WHATSAPP_BOT_ENABLED=false` (le bot reste éteint pour l'instant) ;
  - `WHATSAPP_HANDOFF_MODE` selon le résultat de l'étape 2 (`coexistence` ou `redirect`).
- [ ] **6. Configurer le webhook (après le déploiement de la PR).** Dans l'app Meta, section WhatsApp, Configuration :
  - URL de rappel : `https://qatlia.ma/api/whatsapp/webhook`
  - jeton de vérification : la valeur de `WHATSAPP_VERIFY_TOKEN`
  - s'abonner aux champs `messages` et `smb_message_echoes`.

> L'étape 6 ne peut se faire qu'une fois la PR déployée, car l'adresse du webhook n'existe pas avant.

## Passage en production

À faire seulement une fois la mise en place terminée. Cochez chaque case une fois l'étape terminée.

- [ ] **1. Appliquer la migration.** Appliquer `supabase/migrations/016_whatsapp_bot.sql` sur Supabase.
- [ ] **2. Fusionner et configurer le webhook.** Fusionner la PR, attendre le déploiement, puis configurer le webhook (étape 6 de la mise en place ci-dessus). Meta doit afficher « Vérifié ».
- [ ] **3. Tester le bot éteint.** Avec `WHATSAPP_BOT_ENABLED=false`, envoyer un message depuis un autre numéro : une ligne apparaît dans la table `whatsapp_messages`, et rien n'est envoyé.
- [ ] **4. Désactiver le message d'accueil et le message d'absence** de l'app WhatsApp Business (téléphone → Outils professionnels). Pourquoi : en coexistence, ces messages automatiques arrivent comme des échos, et le bot croirait qu'un humain a répondu et se tairait pendant 24 h.
- [ ] **5. Allumer le bot.** Passer `WHATSAPP_BOT_ENABLED=true` dans Vercel et redéployer, puis tester depuis un autre téléphone. Le test commence en appuyant sur la publicité (Click-to-WhatsApp), sinon le bot ne répond pas en coexistence.
  1. Vérifier dans Supabase que `whatsapp_contacts.referral` n'est pas vide pour ce contact. S'il est vide, Meta ne transmet pas la provenance de la publicité sur ce numéro : mettre `WHATSAPP_BOT_SCOPE=all` dans Vercel et redéployer. Attention : le bot répondra alors aussi aux clients existants qui écrivent à la ligne de support.
  2. Tester dans cet ordre, avec le même contact : l'accueil (via la publicité, avec ses 3 boutons), un appui sur le bouton « Démo », `2` tapé au clavier, une question libre en français, une question en darija.
  3. Tester ensuite le passage à un humain **en dernier**, chaque fois depuis un numéro neuf (en appuyant de nouveau sur la publicité et en attendant l'accueil), car chaque passage à un humain fait taire le bot pour ce contact pendant 24 h : après l'accueil, un vocal ; puis `3` ; puis, après l'accueil, une réponse envoyée depuis l'app et vérifier que le bot se tait.
- [ ] **6. Retour arrière immédiat.** Mettre `WHATSAPP_BOT_ENABLED=false` dans Vercel, redéployer, puis réactiver le message d'accueil dans l'app WhatsApp Business.
- [ ] **7. Où lire les conversations.** Dans Supabase, table `whatsapp_messages`. Une boîte de réception web est hors périmètre de la v1.

## Lecture photo

**Avant de déployer : appliquer `supabase/migrations/019_whatsapp_photo_reads.sql`** dans Supabase (SQL Editor). Sans elle, le bot continue d'envoyer le lien de l'atelier pour chaque photo.

Quand un prospect envoie la photo de sa fiche :

1. le bot répond « 📸 Je lis votre fiche… » ;
2. il télécharge la photo (API Graph, avec `WHATSAPP_ACCESS_TOKEN`) et la lit avec la même lecture que le scan du site, plus le format du panneau s'il est écrit sur la fiche ;
3. il calcule le plan sur ce panneau, ou sur le panneau par défaut de l'atelier (278 × 208), et répond par **une image du plan** (`qatlia.ma/w/<code>/plan.png`) :
   - l'image montre le premier panneau, ses pièces en couleur, **sans aucune cote**, avec « 1 / N » et QatliA ;
   - la légende donne les pièces lues, les panneaux, la chute et le panneau utilisé, puis « 👆 Voici le début de votre plan… » avec le lien `qatlia.ma/w/<code>` ;
   - avant l'envoi, la route du webhook télécharge l'image (8 s au plus). Si elle n'est pas dessinée, ou si YCloud la refuse, le bot envoie l'ancienne réponse texte (avec les premières lignes) ;
   - l'image porte un profil couleur sRGB (`src/lib/png-srgb.ts`), exigé par YCloud ; la télécharger ne compte jamais comme une ouverture du lien. La page du lien la donne aussi comme image d'aperçu (`og:image`) ;
4. le lien ouvre l'atelier avec les pièces, le panneau et **le plan déjà dessiné, en aperçu gratuit** (calculé sur le serveur à partir des pièces stockées). Sans compte, un bandeau invite à s'inscrire ; PDF, devis, DXF, PNG et JSON mènent aussi à l'inscription (l'aperçu ne sort jamais en fichier : connecté mais encore en aperçu, par exemple sans crédit, ces boutons relancent l'optimisation payante). Le message du bot annonce « lien valable 24 h ». **À l'inscription ou à la connexion** (ou si le visiteur est déjà connecté), l'atelier lance tout seul l'optimisation normale : 1 crédit, ré-optimisations gratuites 24 h, PDF disponible. Le lien expire au bout de 24 h.

Règles :

- **une lecture réussie par numéro, définitivement**. Les photos suivantes reçoivent le lien de la première fiche et l'invitation à continuer dans l'atelier ;
- une lecture ratée (photo illisible, pas une fiche) libère le numéro, jusqu'à 3 échecs par numéro sur 24 h ;
- garde-fous : 10 s par requête Meta, 30 s pour la lecture IA, 300 pièces au plus (au-delà, la fiche se fait dans l'atelier) ; une ligne sans cote lisible est ignorée, un format de panneau hors 30–400 cm est remplacé par le panneau par défaut ;
- « liens ouverts » ne compte pas l'aperçu que WhatsApp génère en recevant le message ;
- le contenu des lectures expirées est effacé à chaque nouvelle lecture, même si le lien n'est jamais rouvert ;
- plafond global : `WHATSAPP_PHOTO_DAILY_CAP` lectures sur 24 h (réussies ou non, chacune coûte un appel IA) ;
- **la photo n'est jamais stockée**. Les pièces, le panneau et le résumé sont gardés 24 h derrière le code (le lien expire alors), puis effacés ; la ligne reste pour la règle « une photo par numéro ».

Suivi :

```sql
-- lectures des 7 derniers jours, par statut
select status, count(*) from whatsapp_photo_reads
where created_at > now() - interval '7 days' group by 1;

-- liens ouverts
select count(*) filter (where opened_at is not null) as ouverts, count(*) filter (where status = 'ok') as lus
from whatsapp_photo_reads;

-- inscriptions venues d'une photo (provenance « whatsapp · photo »)
select count(*) from auth.users where raw_user_meta_data->>'signup_campaign' = 'photo';
```

## Messages vocaux

Quand un prospect envoie un vocal (après l'accueil, comme un texte) :

1. le bot le télécharge (API Graph, comme les photos) : notes vocales WhatsApp (Ogg/Opus), MP3 ou AAC, 1 Mo au plus (environ 8 minutes) ;
2. Gemini le transcrit mot pour mot par OpenRouter (`WHATSAPP_VOICE_MODEL`) : darija et arabe en lettres arabes, français en lettres latines ;
3. la transcription est enregistrée comme texte du message dans `whatsapp_messages`, la langue du contact suit celle du vocal, et l'assistant répond exactement comme à une question tapée (mêmes informations, même plafond de 20 réponses par jour, même passage au conseiller).

Si le bot n'a pas pu l'écouter (format non pris, fichier trop long, silence, erreur, plus de 10 vocaux du même numéro sur 24 h), il répond « Je n'ai pas bien compris votre message vocal 🙏 Écrivez-moi votre question en quelques mots, ou un conseiller vous répond très vite. » et passe la main à un humain, comme avant.

**Le vocal n'est jamais stocké** : seule sa transcription l'est. Les logs Vercel ne contiennent qu'un code de raison (`[whatsapp] voice: not heard (empty)`, `… OpenRouter answered 400`), jamais le contenu ni le numéro.

Premier test après le déploiement : ouvrir les logs Vercel en direct (ils ne sont gardés que quelques minutes), envoyer un vocal depuis un numéro déjà accueilli, et vérifier la réponse. Si un code `OpenRouter answered 4xx` apparaît, le modèle ne prend pas ce format : mettre `WHATSAPP_VOICE_ENABLED=false` le temps de corriger.

Suivi :

```sql
-- vocaux des 7 derniers jours : transcrits (body rempli) ou non
select count(*) filter (where body is not null) as transcrits, count(*) as recus
from whatsapp_messages where kind = 'audio' and direction = 'user' and created_at > now() - interval '7 days';
```

## Suivi

**Envois ratés.** Un envoi refusé ou coupé est retenté une fois (jamais après un délai dépassé, pour ne pas envoyer deux fois le même message). S'il échoue encore, le texte est enregistré avec `kind = 'send_failed'` : les logs Vercel ne sont gardés que quelques minutes, la table le garde. Pour voir les prospects restés sans réponse :

```sql
select wa_id, created_at, left(body, 60) as debut
from whatsapp_messages
where kind = 'send_failed'
order by created_at desc;
```

**Inscriptions venues de WhatsApp.** Le bot envoie des liens courts : `qatlia.ma/wa` (site en français), `qatlia.ma/wa/ar` (site en arabe), `qatlia.ma/wa/atelier` (atelier). Chacun redirige (307, `next.config.mjs`) vers sa page avec `utm_source=whatsapp` ; le site retient la provenance puis retire les `utm_…` de la barre d'adresse, si bien que le prospect ne voit jamais « whatsapp ». Le lien d'une fiche photo (`qatlia.ma/w/<code>`) ne porte aucun tag : la page enregistre elle-même `whatsapp · bot · photo`. La première visite marquée est retenue dans le navigateur pendant 30 jours, puis enregistrée dans le compte à l'inscription (`signup_source`, visible dans la fiche client de l'admin, champ « Provenance »). Avec Google, le compte est créé au retour de Google (`/auth/callback`) : la provenance y arrive par un cookie (`qatlia-acq`) et n'est écrite que dans un compte créé dans les 10 dernières minutes, jamais dans un compte ancien qui se reconnecte.

```sql
select raw_user_meta_data->>'signup_source' as provenance, count(*)
from auth.users
where created_at > now() - interval '30 days'
group by 1;
```
