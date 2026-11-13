# Bot WhatsApp QatliA

Ce document est destiné au propriétaire. Il décrit ce qu'il faut faire côté Meta pour que le bot WhatsApp de QatliA puisse fonctionner. Aucune ligne de code n'est à écrire : tout se fait dans les tableaux de bord Meta et Vercel.

## Ce que fait le bot

Le bot répond aux messages WhatsApp reçus sur le numéro de QatliA (06 00 93 75 23) :

- les choix 1, 2 et 3 reçoivent des réponses fixes (les mêmes textes que les réponses rapides) ;
- le texte libre est traité par l'IA, qui s'appuie uniquement sur les informations du code de QatliA (prix, offres, FAQ) ;
- les vocaux, vidéos, documents, localisations et contacts sont passés à un humain ;
- le bot répond en français ou en arabe selon la langue du prospect ;
- **en coexistence, le bot ne répond qu'aux personnes venues de la publicité** (Click-to-WhatsApp). Les clients existants qui écrivent à la ligne de support continuent de n'avoir que vous comme interlocuteur. Avec `WHATSAPP_BOT_SCOPE=all`, le bot répond à tout le monde ;
- **chaque passage à un humain** (vocal, choix 3, réponse envoyée depuis l'app, question hors des informations de QatliA) fait taire le bot pour ce contact pendant 24 h.

Le bot peut être éteint à tout moment avec la variable `WHATSAPP_BOT_ENABLED` : tant qu'elle n'est pas égale à `true`, il enregistre les messages entrants mais n'envoie rien.

## Les deux modes : coexistence ou redirect

Le même numéro peut être utilisé de deux façons. La variable `WHATSAPP_HANDOFF_MODE` indique laquelle.

- **`coexistence` (mode visé, valeur par défaut).** Le numéro 06 00 93 75 23 reste dans l'app WhatsApp Business et il est aussi branché à l'API. Vous voyez toutes les conversations dans l'app et vous pouvez répondre à tout moment. Quand vous écrivez à un contact depuis l'app, le bot se tait pour ce contact pendant 24 h.
- **`redirect` (repli si Meta refuse la coexistence pour ce numéro).** Le bot tourne sur un **second numéro**, dédié à l'API. La publicité doit alors pointer vers ce second numéro. Quand un prospect demande un humain, le bot envoie le lien `wa.me` du numéro humain et **ne se tait pas**.

Le choix entre les deux se fait à l'étape 2 de la mise en place ci-dessous.

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

- [ ] **1. Appliquer la migration.** Appliquer `supabase/migrations/015_whatsapp_bot.sql` sur Supabase.
- [ ] **2. Fusionner et configurer le webhook.** Fusionner la PR, attendre le déploiement, puis configurer le webhook (étape 6 de la mise en place ci-dessus). Meta doit afficher « Vérifié ».
- [ ] **3. Tester le bot éteint.** Avec `WHATSAPP_BOT_ENABLED=false`, envoyer un message depuis un autre numéro : une ligne apparaît dans la table `whatsapp_messages`, et rien n'est envoyé.
- [ ] **4. Désactiver le message d'accueil et le message d'absence** de l'app WhatsApp Business (téléphone → Outils professionnels). Pourquoi : en coexistence, ces messages automatiques arrivent comme des échos, et le bot croirait qu'un humain a répondu et se tairait pendant 24 h.
- [ ] **5. Allumer le bot.** Passer `WHATSAPP_BOT_ENABLED=true` dans Vercel et redéployer, puis tester depuis un autre téléphone. Le test commence en appuyant sur la publicité (Click-to-WhatsApp), sinon le bot ne répond pas en coexistence.
  1. Vérifier dans Supabase que `whatsapp_contacts.referral` n'est pas vide pour ce contact. S'il est vide, Meta ne transmet pas la provenance de la publicité sur ce numéro : mettre `WHATSAPP_BOT_SCOPE=all` dans Vercel et redéployer.
  2. Tester dans cet ordre, avec le même contact : l'accueil (via la publicité), `1`, `2`, une question libre en français, une question en darija.
  3. Tester ensuite le passage à un humain **en dernier**, chaque fois depuis un numéro neuf (en appuyant de nouveau sur la publicité), car chaque passage à un humain fait taire le bot pour ce contact pendant 24 h : un vocal ; puis `3` ; puis, après l'accueil, une réponse envoyée depuis l'app et vérifier que le bot se tait.
- [ ] **6. Retour arrière immédiat.** Mettre `WHATSAPP_BOT_ENABLED=false` dans Vercel, redéployer, puis réactiver le message d'accueil dans l'app WhatsApp Business.
- [ ] **7. Où lire les conversations.** Dans Supabase, table `whatsapp_messages`. Une boîte de réception web est hors périmètre de la v1.
