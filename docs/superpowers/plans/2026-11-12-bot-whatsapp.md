# Bot WhatsApp QatliA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Répondre automatiquement, jour et nuit, aux prospects qui écrivent sur le WhatsApp de QatliA (surtout ceux venus de la pub Click-to-WhatsApp) : accueil, réponses fixes aux choix 1/2/3, réponses libres par IA en français, arabe ou darija, et passage de relais au propriétaire dès qu'un humain doit répondre.

**Architecture:** Meta envoie chaque message reçu à un webhook Next.js (`/api/whatsapp/webhook`). La route vérifie la signature, découpe le payload en événements, déduplique par identifiant de message dans Supabase, puis un routeur pur décide de l'action (accueil, menu, relais, IA, silence). Les réponses partent par l'API Graph (`fetch`), les réponses libres viennent d'OpenRouter, déjà utilisé par le scan. Quand le propriétaire répond lui-même depuis l'app WhatsApp Business (mode coexistence), Meta renvoie un « écho » et le bot se tait 24 h pour ce contact.

**Tech Stack:** Next.js 14.2 (App Router, route handlers), Supabase (`@supabase/supabase-js`, clé service-role), Postgres, zod 4, `node:crypto`, `fetch`, OpenRouter (chat completions), tests `node:test` (`tests/*.test.js` avec `tests/helpers/load-ts-module.js` et `stub-module.js`).

**Spec:** aucune. Le propriétaire a demandé un plan direct (« oui, fait un plan ») après la discussion du 2026-11-12 sur l'automatisation des messages de la pub. La section **Décisions de conception** tient lieu de spec ; ce sont les choix du rédacteur, à valider par le propriétaire avant exécution.

## Décisions de conception

1. **Pas de SDK, pas de nouvelle dépendance.** Signature avec `node:crypto`, API Graph et OpenRouter avec `fetch`. Le modèle IA passe par OpenRouter comme le scan (`src/app/api/vision/route.ts:215-321`) ; un modèle Claude peut y être choisi via `WHATSAPP_BOT_MODEL`. (Correction de ce qui a été dit dans la discussion : l'IA n'est pas appelée directement chez Anthropic.)
2. **Même numéro, deux modes.** Mode `coexistence` (cible) : le numéro 06 00 93 75 23 reste dans l'app WhatsApp Business **et** est branché à l'API ; le propriétaire voit tout dans l'app et peut répondre à tout moment. Mode `redirect` (repli si Meta refuse la coexistence pour ce numéro) : le bot tourne sur un **second numéro** dédié à l'API, la pub pointe vers lui, et le relais consiste à envoyer le lien `wa.me` du numéro humain. Variable `WHATSAPP_HANDOFF_MODE`.
3. **Relais humain (coexistence).** Le bot se tait pour un contact pendant `HANDOFF_HOURS = 24` h quand : le propriétaire envoie un message depuis l'app (écho `smb_message_echoes`), le prospect choisit 3, le prospect envoie un vocal, une vidéo, un document, une localisation ou un contact, l'IA demande le relais, ou le plafond quotidien est atteint. En mode `redirect`, le bot envoie le lien et **ne se tait pas**.
4. **Le message d'accueil et le message d'absence de l'app WhatsApp Business doivent être désactivés** au passage en production : sinon le prospect reçoit deux accueils, et leurs échos feraient taire le bot.
5. **Réponses fixes pour 1, 2, 3** (mêmes textes que les réponses rapides, lien YouTube en premier pour l'aperçu). Seul le texte libre va à l'IA.
6. **Les faits viennent du code.** Le prompt est construit depuis `src/lib/billing/policy.ts`, `src/lib/billing/catalog.ts` et la FAQ « Ce que QatliA fait (et ne promet pas) » (`fr.faq2`). L'IA ne cite aucun prix, chiffre ou fonctionnalité absent de ces sources, et jamais de pourcentage d'économie de chutes.
7. **Langue.** `lang` du contact = `'ar'` si son dernier texte contient des lettres arabes, sinon `'fr'`. Les réponses fixes suivent `lang` ; l'IA répond dans la langue du message (darija en lettres latines comprise). L'accueil est bilingue.
8. **Plafonds.** `MAX_ASSISTANT_REPLIES_PER_DAY = 20` réponses IA par contact sur 24 h glissantes, texte entrant tronqué à `MAX_INBOUND_CHARS = 1000`, historique envoyé à l'IA : `HISTORY_MESSAGES = 10` derniers messages, délai IA `ASSISTANT_TIMEOUT_MS = 15000`, réponse IA tronquée à `MAX_REPLY_CHARS = 700`.
9. **Interrupteur.** `WHATSAPP_BOT_ENABLED` différent de `'true'` : le webhook répond 200, enregistre les messages entrants, n'envoie rien.
10. **Hors périmètre v1 :** relances payantes par modèle de message (templates), boîte de réception web, statistiques, transcription des vocaux, lecture des photos de fiches par le bot (on redirige vers l'atelier), boutons interactifs.

## Fichiers

| Fichier | Rôle | Tâche |
|---|---|---|
| `docs/whatsapp-bot.md` | Mise en place côté Meta + passage en production | 0, 7 |
| `supabase/migrations/015_whatsapp_bot.sql` | Tables `whatsapp_contacts`, `whatsapp_messages` | 1 |
| `src/lib/whatsapp/config.ts` | Lecture des variables d'environnement | 2 |
| `src/lib/whatsapp/signature.ts` | Vérification `X-Hub-Signature-256` | 2 |
| `src/lib/whatsapp/payload.ts` | Payload Meta → événements typés | 2 |
| `src/lib/whatsapp/copy.ts` | Textes fixes FR/AR | 3 |
| `src/lib/whatsapp/router.ts` | Décision pure : que faire de ce message | 3 |
| `src/lib/whatsapp/assistant.ts` | Prompt + appel OpenRouter | 4 |
| `src/lib/whatsapp/store.ts` | Lecture/écriture Supabase | 5 |
| `src/lib/whatsapp/send.ts` | Envoi via l'API Graph | 5 |
| `src/app/api/whatsapp/webhook/route.ts` | GET (vérification) + POST (traitement) | 6 |

Le numéro 015 est choisi parce que 011 est pris par la PR #30 (`011_panel_presets.sql`) et 012–014 par le plan superadmin.

## Global Constraints

- La production (qatlia.ma) a de vrais clients : PR uniquement, jamais de push sur `main`. Avant la PR : `npm run test:node`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, et comparaison des échecs avec `main`.
- Travailler dans une branche `feat/whatsapp-bot` créée depuis `main` (worktree conseillé) : les modifications non commitées de `src/app/api/vision/route.ts` et `tests/vision-edge-marks.test.js` appartiennent à la PR #31 et ne doivent pas être touchées.
- Migration additive et idempotente (`IF NOT EXISTS`), RLS activé, aucune policy, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, `GRANT ALL ... TO service_role`. Ne touche pas `FULL_DATABASE_SETUP.sql`. Le propriétaire l'applique sur Supabase **avant** de fusionner.
- Table absente (`PGRST205`) ou configuration absente : le webhook répond 200 sans rien envoyer et journalise `[whatsapp]` ; jamais de 500 (Meta réessaierait en boucle).
- La clé service-role, le jeton WhatsApp et le secret d'app ne quittent jamais le serveur ; `src/lib/whatsapp/*` n'est importé que par la route.
- Aucune nouvelle dépendance npm.
- Variables d'environnement (noms exacts) : `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_GRAPH_VERSION` (défaut `'v23.0'`, à confirmer à la tâche 0), `WHATSAPP_BOT_ENABLED`, `WHATSAPP_HANDOFF_MODE` (`'coexistence'` | `'redirect'`, défaut `'coexistence'`), `WHATSAPP_BOT_MODEL` (défaut : `OPENROUTER_MODEL`, puis `'google/gemini-3.7-flash'`), `OPENROUTER_API_KEY` (existante).
- Messages de commit en français, style du dépôt (`feat(whatsapp): …`), terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Message en arabe ou avec emoji** : la signature est calculée sur le corps brut (`await request.text()`), jamais sur un JSON re-sérialisé, sinon tout message arabe est rejeté. → Task 2 (test avec corps arabe), Task 6.
2. **Meta renvoie le même message** (réessai après délai) : une seule réponse part. → Task 5 (`claimInbound` sur doublon), Task 6.
3. **Le propriétaire répond depuis l'app** : le bot se tait 24 h pour ce contact, puis reprend. → Task 3, Task 6.
4. **OpenRouter en panne, lent ou réponse non-JSON** : le prospect reçoit le message de repli et le relais est activé ; jamais de silence, jamais de 500. → Task 4, Task 6.
5. **Message vocal** (très courant au Maroc) : réponse « écrivez votre question ou un conseiller vous répond » et relais, pas de silence. → Task 3.

---

### Task 0: Mise en place côté Meta (propriétaire, sans code)

Bloquante : rien n'est fusionné tant que ce point n'est pas tranché. Le développeur rédige `docs/whatsapp-bot.md` ; le propriétaire exécute.

**Files:**
- Create: `docs/whatsapp-bot.md`

- [ ] **Step 1: Rédiger `docs/whatsapp-bot.md`, section « Mise en place »**, avec cette liste à cocher :
  1. Dans Meta Business Suite, vérifier l'entreprise (si demandé) et créer une app Meta de type « Business » avec le produit WhatsApp.
  2. Lancer l'inscription de **coexistence** avec le numéro 06 00 93 75 23 (scan d'un QR code depuis l'app WhatsApp Business). Si Meta refuse le numéro ou le pays : noter « mode redirect », acheter/dédier un second numéro à l'API, et prévoir de changer la destination de la pub vers ce numéro.
  3. Créer un **utilisateur système** avec un **jeton permanent** (permissions `whatsapp_business_messaging`, `whatsapp_business_management`). Ne pas utiliser le jeton temporaire du tableau de bord : il expire en 24 h.
  4. Relever : `WHATSAPP_PHONE_NUMBER_ID`, le secret de l'app (`WHATSAPP_APP_SECRET`), la version courante de l'API Graph (`WHATSAPP_GRAPH_VERSION`), et choisir une chaîne aléatoire `WHATSAPP_VERIFY_TOKEN`.
  5. Ajouter ces variables sur Vercel (Production), avec `WHATSAPP_BOT_ENABLED=false` et `WHATSAPP_HANDOFF_MODE` selon le point 2.
  6. Après déploiement de la PR : dans l'app Meta → WhatsApp → Configuration, URL de rappel `https://qatlia.ma/api/whatsapp/webhook`, jeton de vérification = `WHATSAPP_VERIFY_TOKEN`, abonner les champs `messages` et `smb_message_echoes`.
- [ ] **Step 2: Commit**

```bash
git add docs/whatsapp-bot.md
git commit -m "docs(whatsapp): mise en place du bot côté Meta"
```

---

### Task 1: Migration 015

**Files:**
- Create: `supabase/migrations/015_whatsapp_bot.sql`
- Test: `tests/whatsapp-sql.test.js` (même approche que `tests/credits-sql-privileges.test.js`, avec `tests/helpers/sql-inspect.js`)

**Interfaces:**
- Produces:
  - `public.whatsapp_contacts(wa_id text PRIMARY KEY, profile_name text, lang text NOT NULL DEFAULT 'fr' CHECK (lang IN ('fr','ar')), greeted_at timestamptz, handoff_until timestamptz, referral jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`
  - `public.whatsapp_messages(id bigserial PRIMARY KEY, wamid text UNIQUE, wa_id text NOT NULL REFERENCES public.whatsapp_contacts(wa_id) ON DELETE CASCADE, direction text NOT NULL CHECK (direction IN ('user','bot','human')), kind text NOT NULL, body text, created_at timestamptz NOT NULL DEFAULT now())`
  - Index `whatsapp_messages_wa_id_created_at_idx ON (wa_id, created_at DESC)`.

- [ ] **Step 1: Write the failing test** `tests/whatsapp-sql.test.js` : le fichier crée les deux tables avec `IF NOT EXISTS`, `wamid` est `UNIQUE`, `ENABLE ROW LEVEL SECURITY` sur les deux tables, aucun `CREATE POLICY`, `REVOKE ALL` envers `PUBLIC, anon, authenticated` et `GRANT ALL` à `service_role` sur les deux tables et la séquence, et aucune mention de `add_credits`, `consume_credit`, `ensure_profile`.
- [ ] **Step 2: Run** `node --test tests/whatsapp-sql.test.js` → FAIL (fichier introuvable).
- [ ] **Step 3: Écrire la migration** selon le bloc Interfaces.
- [ ] **Step 4: Run** `node --test tests/whatsapp-sql.test.js` → PASS.
- [ ] **Step 5: Commit** `feat(whatsapp): tables des contacts et messages du bot (migration 015)`.

---

### Task 2: Configuration, signature, payload

**Files:**
- Create: `src/lib/whatsapp/config.ts`, `src/lib/whatsapp/signature.ts`, `src/lib/whatsapp/payload.ts`
- Test: `tests/whatsapp-webhook-parsing.test.js`

**Interfaces:**
- Produces:
  - `type HandoffMode = 'coexistence' | 'redirect'`
  - `interface WhatsAppConfig { appSecret: string; verifyToken: string; accessToken: string; phoneNumberId: string; graphVersion: string; enabled: boolean; handoffMode: HandoffMode; model: string; openrouterKey: string | null }`
  - `getWhatsAppConfig(env?: Record<string, string | undefined>): WhatsAppConfig | null` — `null` si l'un de `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` manque ou est un placeholder (`isPlaceholder` de `@/lib/billing/config`). `enabled` vrai seulement pour la chaîne `'true'`. `handoffMode` invalide → `'coexistence'`.
  - `verifySignature(rawBody: string, header: string | null, appSecret: string): boolean` — HMAC-SHA256 de `rawBody` (UTF-8) avec `appSecret`, comparé en hex à la partie après `sha256=` par `timingSafeEqual` (longueurs différentes → `false`, en-tête absent ou mal formé → `false`).
  - `type InboundKind = 'text' | 'image' | 'audio' | 'video' | 'document' | 'location' | 'contacts' | 'sticker' | 'reaction' | 'other'`
  - `interface InboundEvent { type: 'inbound'; wamid: string; waId: string; profileName: string | null; kind: InboundKind; text: string | null; referral: Record<string, unknown> | null }` — `text` = `text.body` pour un texte, la légende (`caption`) pour une image, sinon `null`.
  - `interface EchoEvent { type: 'echo'; waId: string; text: string | null }` — `waId` = destinataire (`to`) du message envoyé depuis l'app.
  - `parseWebhook(body: unknown, phoneNumberId: string): Array<InboundEvent | EchoEvent>` — parcourt `entry[].changes[]` ; `field === 'messages'` → un `InboundEvent` par `value.messages[]`, `profileName` tiré de `value.contacts[]` dont `wa_id` correspond ; `field === 'smb_message_echoes'` → un `EchoEvent` par `value.message_echoes[]` ; ignore `statuses`, tout autre champ, et tout `value.metadata.phone_number_id` différent de `phoneNumberId`. Payload invalide → `[]` (validation zod, jamais d'exception).

- [ ] **Step 1: Write the failing tests** dans `tests/whatsapp-webhook-parsing.test.js` :
  - `verifySignature` accepte la signature calculée avec `crypto.createHmac('sha256', 's3cret')` d'un corps contenant `"مرحبا 👋"` ; refuse le même corps re-sérialisé avec un espace ajouté ; refuse `null`, `'sha256='`, `'md5=abc'`, et une signature hex de mauvaise longueur.
  - `parseWebhook` sur un payload texte avec `referral: { source_type: 'ad', source_id: '123' }` → un `InboundEvent` avec `kind: 'text'`, `text`, `profileName`, `referral` conservé.
  - Payload ne contenant que `statuses` → `[]`. Payload d'un autre `phone_number_id` → `[]`. `parseWebhook(null, 'x')` → `[]`.
  - Payload `audio` → `kind: 'audio'`, `text: null`. Payload `image` avec `caption: 'ma fiche'` → `kind: 'image'`, `text: 'ma fiche'`. Type inconnu (`'unsupported'`) → `kind: 'other'`.
  - Payload `smb_message_echoes` avec `message_echoes: [{ from: '<notre numéro>', to: '212611111111', type: 'text', text: { body: 'Bonjour' } }]` → `[{ type: 'echo', waId: '212611111111', text: 'Bonjour' }]`.
  - `getWhatsAppConfig({})` → `null` ; config complète avec `WHATSAPP_BOT_ENABLED: 'TRUE'` → `enabled: false` ; `WHATSAPP_HANDOFF_MODE: 'x'` → `'coexistence'` ; sans `WHATSAPP_BOT_MODEL` mais avec `OPENROUTER_MODEL: 'm'` → `model: 'm'`.
- [ ] **Step 2: Run** `node --test tests/whatsapp-webhook-parsing.test.js` → FAIL (modules introuvables).
- [ ] **Step 3: Implémenter** les trois modules selon le bloc Interfaces (modules purs : pas d'I/O).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(whatsapp): vérification de signature et lecture du webhook Meta`.

---

### Task 3: Textes fixes et routeur

**Files:**
- Create: `src/lib/whatsapp/copy.ts`, `src/lib/whatsapp/router.ts`
- Test: `tests/whatsapp-router.test.js`

**Interfaces:**
- Consumes: `InboundEvent`, `HandoffMode` (Task 2).
- Produces:
  - `type Lang = 'fr' | 'ar'`
  - `const DEMO_VIDEO_URL = 'https://youtu.be/dQE_PzXUAR0'`
  - `const COPY: { greeting: string; howItWorks: Record<Lang, string>; pricing: Record<Lang, string>; advisor: Record<Lang, string>; redirect: Record<Lang, string>; imageHint: Record<Lang, string>; mediaHandoff: Record<Lang, string>; fallback: Record<Lang, string> }`
  - `detectLang(text: string | null, previous: Lang): Lang` — `'ar'` si le texte contient un caractère `؀-ۿ`, `'fr'` s'il contient au moins 3 lettres latines, sinon `previous`.
  - `menuChoice(text: string | null): 1 | 2 | 3 | null` — accepte `1`, ` 2 `, `3.`, `1)`, `1️⃣`, `١`/`٢`/`٣` ; tout autre texte → `null`.
  - `interface ContactState { waId: string; lang: Lang; greetedAt: Date | null; handoffUntil: Date | null }`
  - `type Decision = { action: 'silent' } | { action: 'send'; text: string; markGreeted: boolean; handoff: boolean } | { action: 'assistant' }`
  - `decide(input: { event: InboundEvent; contact: ContactState; now: Date; assistantRepliesLast24h: number; handoffMode: HandoffMode }): Decision`
  - `const HANDOFF_HOURS = 24`, `const MAX_ASSISTANT_REPLIES_PER_DAY = 20`

  Règles de `decide`, la première qui s'applique (`L` = `contact.lang`, `handoff` vaut `true` seulement en mode `coexistence`) :
  1. `contact.handoffUntil > now` → `silent`.
  2. `kind` ∈ `sticker`, `reaction`, `other` → `silent`.
  3. `menuChoice(text) === 1` → `send howItWorks[L]` ; `=== 2` → `send pricing[L]` ; `=== 3` → `send advisor[L]` (+ en mode `redirect` : `redirect[L]` concaténé après une ligne vide), `handoff`. `markGreeted: true` dans les trois cas.
  4. `contact.greetedAt === null` → `send greeting`, `markGreeted: true`, `handoff: false`.
  5. `kind === 'image'` → `send imageHint[L]`.
  6. `kind` ∈ `audio`, `video`, `document`, `location`, `contacts` → `send mediaHandoff[L]` (+ `redirect[L]` en mode `redirect`), `handoff`.
  7. `kind === 'text'` et `assistantRepliesLast24h >= MAX_ASSISTANT_REPLIES_PER_DAY` → `send advisor[L]` (+ `redirect[L]` en mode `redirect`), `handoff`.
  8. `kind === 'text'` → `assistant`.

  Textes exacts de `COPY` :

```text
greeting =
Bonjour 👋 Merci pour votre intérêt !
QatliA optimise la découpe de vos panneaux : prenez en photo votre fiche de mesure et recevez le plan de coupe en PDF en quelques secondes.
🎥 Démo en 1 min : https://youtu.be/dQE_PzXUAR0
👉 Essai gratuit, sans carte bancaire : https://qatlia.ma
Répondez :
1️⃣ Comment ça marche
2️⃣ Tarifs
3️⃣ Parler à un conseiller
Ou posez directement votre question ✍️

مرحبا 👋 QatliA كيعطيك مخطط تقطيع الألواح من صورة ورقة القياسات فثواني.
👉 جرّب مجانا: https://qatlia.ma
جاوب بـ 1 / 2 / 3 ولا سول سؤالك مباشرة

howItWorks.fr =
Voici comment ça marche en 1 minute 🎥
https://youtu.be/dQE_PzXUAR0

1. Créez votre compte sur https://qatlia.ma
2. Prenez en photo votre fiche de mesure
3. Lancez l'optimisation, et vous obtenez le plan de coupe et le PDF pour l'atelier.

howItWorks.ar =
شوف كيفاش كيخدم فدقيقة 🎥
https://youtu.be/dQE_PzXUAR0

1. دير حساب فـ https://qatlia.ma
2. صوّر ورقة القياسات
3. ضغط على التحسين، وغادي يعطيك مخطط التقطيع وتقرير PDF للورشة.

pricing.fr =
Vous commencez gratuitement avec des crédits offerts à l'inscription, sans carte bancaire. Ensuite, vous achetez des crédits seulement quand vous en avez besoin, sans abonnement. Les recalculs sur un même projet sont gratuits pendant 24 h.
Détails : https://qatlia.ma

pricing.ar =
كتبدا بالمجان بكريديات مهداة ملي كتسجل، بلا بطاقة بنكية. من بعد كتشري الكريديات غير ملي تحتاجهم، بلا اشتراك. إعادة الحساب فنفس المشروع مجانية لمدة 24 ساعة.
التفاصيل: https://qatlia.ma

advisor.fr =
Avec plaisir ! Un conseiller vous répond très vite. En attendant, dites-nous ce que vous fabriquez (cuisines, placards, meubles…) et quels panneaux vous utilisez.

advisor.ar =
مرحبا! مستشار غادي يجاوبك قريب. قول لينا شنو كتصاوب (كوزينات، بلاكارات، أثاث…) وشنو نوع الألواح اللي كتخدم بيها.

redirect.fr =
Écrivez directement à notre conseiller ici : https://wa.me/212600937523

redirect.ar =
كتب للمستشار ديالنا مباشرة هنا: https://wa.me/212600937523

imageHint.fr =
Merci pour la photo ! Pour obtenir votre plan de coupe, créez votre compte sur https://qatlia.ma puis prenez votre fiche de mesure en photo dans l'atelier : l'IA lit les pièces pour vous.

imageHint.ar =
شكرا على الصورة! باش تاخد مخطط التقطيع، دير حساب فـ https://qatlia.ma وصوّر ورقة القياسات فالورشة، والذكاء الاصطناعي غادي يقرا القطع.

mediaHandoff.fr =
Je ne peux pas encore écouter ni ouvrir ce type de message. Écrivez-moi votre question, ou un conseiller vous répond très vite.

mediaHandoff.ar =
مازال ما نقدرش نسمع ولا نحل هاد النوع ديال الرسائل. كتب ليا سؤالك، ولا مستشار غادي يجاوبك قريب.

fallback.fr =
Merci pour votre message ! Un conseiller vous répond très vite.

fallback.ar =
شكرا على رسالتك! مستشار غادي يجاوبك قريب.
```

  Les liens `wa.me` viennent de `supportWhatsAppUrl()` (`src/lib/support.ts`), pas d'une chaîne en dur.

- [ ] **Step 1: Write the failing tests** dans `tests/whatsapp-router.test.js` (un `ContactState` de base : `lang: 'fr'`, `greetedAt` défini, `handoffUntil: null`) :
  - Nouveau contact (`greetedAt: null`), texte `'Bonjour ! Puis-je en savoir plus à ce sujet ?'` → `send greeting`, `markGreeted: true`, `handoff: false`.
  - Nouveau contact, texte `'1'` → `howItWorks.fr` (pas l'accueil).
  - `'1️⃣'`, `' 2 '`, `'٣'` → choix 1, 2, 3 ; `'12'`, `'1 panneau'` → `assistant`.
  - Dans `howItWorks.fr` et dans `greeting`, `indexOf(DEMO_VIDEO_URL) < indexOf('https://qatlia.ma')`.
  - `'3'` en `coexistence` → `advisor.fr`, `handoff: true` ; en `redirect` → texte contenant `'https://wa.me/212600937523'`, `handoff: false`.
  - `handoffUntil` = now + 1 h → `silent` pour un texte et pour `'1'` ; `handoffUntil` = now − 1 min → `assistant`.
  - `kind: 'audio'` → `mediaHandoff.fr`, `handoff: true` ; `kind: 'reaction'` → `silent` ; `kind: 'image'` → `imageHint.fr`.
  - `assistantRepliesLast24h: 20` et texte libre → `advisor.fr`, `handoff: true`.
  - `lang: 'ar'` et `'2'` → `pricing.ar`.
  - `detectLang('سلام', 'fr')` → `'ar'` ; `detectLang('salam bghit n3ref', 'ar')` → `'fr'` ; `detectLang('1', 'ar')` → `'ar'`.
- [ ] **Step 2: Run** `node --test tests/whatsapp-router.test.js` → FAIL.
- [ ] **Step 3: Implémenter** `copy.ts` (textes ci-dessus, liens wa.me via `supportWhatsAppUrl()`) et `router.ts` (modules purs).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(whatsapp): réponses fixes et routeur du bot`.

---

### Task 4: Assistant IA

**Files:**
- Create: `src/lib/whatsapp/assistant.ts`
- Test: `tests/whatsapp-assistant.test.js`

**Interfaces:**
- Consumes: `CREDIT_PACKS`, `formatMAD` (`@/lib/billing/catalog`), `SIGNUP_FREE_CREDITS`, `ANALYSIS_WINDOW_HOURS`, `VISION_CREDIT_COST` (`@/lib/billing/policy`), le catalogue français (`import { fr } from '@/i18n/messages/fr'`, clés `fr.hero.subtitle` et `fr.faq2.q1..a6`), `supportWhatsAppUrl` (`@/lib/support`).
- Produces:
  - `interface HistoryItem { direction: 'user' | 'bot' | 'human'; body: string }`
  - `interface AssistantReply { reply: string; handoff: boolean }`
  - `buildSystemPrompt(): string`
  - `askAssistant(input: { history: HistoryItem[]; message: string; model: string; apiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<AssistantReply | null>` — `null` en cas d'erreur réseau, de statut non-2xx, de délai dépassé (`ASSISTANT_TIMEOUT_MS = 15000`, via `AbortController`) ou de JSON illisible.
  - `const MAX_REPLY_CHARS = 700`, `const HISTORY_MESSAGES = 10`, `const MAX_INBOUND_CHARS = 1000`

  Contenu imposé du prompt système (en français) :
  - Rôle : assistant WhatsApp de QatliA, outil en ligne d'optimisation de découpe de panneaux pour menuisiers au Maroc.
  - Faits, tous injectés depuis le code : `hero.subtitle` ; crédits offerts à l'inscription (`SIGNUP_FREE_CREDITS`) ; `VISION_CREDIT_COST` crédit par analyse complète ; recalculs gratuits pendant `ANALYSIS_WINDOW_HOURS` h ; exports gratuits ; chaque pack de `CREDIT_PACKS` (nom, nombre de crédits, prix via `formatMAD`) ; achat : se connecter sur https://qatlia.ma → menu du compte → « Acheter des crédits » ; démo : `DEMO_VIDEO_URL` ; les six questions/réponses de `faq2`.
  - Règles : répondre dans la langue et l'écriture du dernier message (français, arabe, darija en lettres arabes ou latines) ; 5 lignes courtes maximum, ton simple et chaleureux ; renvoyer vers https://qatlia.ma pour essayer ; ne jamais inventer une fonctionnalité, un prix, une remise, un délai ou un pourcentage d'économie de chutes absent des faits ; `handoff: true` si la question sort des faits, si la personne demande un humain, négocie un prix, signale un problème de paiement ou de compte, ou se plaint.
  - Format de sortie : uniquement `{"reply": "...", "handoff": true|false}`.

  Requête : `POST https://openrouter.ai/api/v1/chat/completions`, en-têtes `Authorization: Bearer <apiKey>`, `HTTP-Referer: https://qatlia.ma`, `X-Title: QatliA WhatsApp`, corps `{ model, messages: [system, ...history (user → 'user', bot/human → 'assistant'), user message], response_format: { type: 'json_object' }, max_tokens: 400, temperature: 0.3 }`. Les `HISTORY_MESSAGES` derniers éléments seulement ; `message` tronqué à `MAX_INBOUND_CHARS`. Lecture du JSON : même tolérance que `extractJson` du scan (bloc ```json, premier `{` au dernier `}`) ; `reply` vide → `null` ; `reply` tronquée à `MAX_REPLY_CHARS`.

- [ ] **Step 1: Write the failing tests** dans `tests/whatsapp-assistant.test.js` avec un `fetchImpl` simulé :
  - `buildSystemPrompt()` contient `String(SIGNUP_FREE_CREDITS)`, le nom et `formatMAD(priceMAD)` de chaque pack, `'https://youtu.be/dQE_PzXUAR0'`, et le texte de `faq2.a5`.
  - Réponse `{"reply":"Bonjour","handoff":false}` → `{ reply: 'Bonjour', handoff: false }` ; la requête envoyée a `model` égal à l'entrée, un premier message `role: 'system'`, et au plus `HISTORY_MESSAGES + 2` messages quand l'historique en compte 30.
  - Réponse entourée de ```json → lue correctement.
  - Statut 500 → `null` ; `fetchImpl` qui rejette → `null` ; texte `'désolé'` sans JSON → `null` ; `reply: ''` → `null`.
  - `fetchImpl` qui ne répond jamais avec `timeoutMs: 50` → `null` en moins de 1 s.
  - `reply` de 2 000 caractères → longueur `MAX_REPLY_CHARS`.
- [ ] **Step 2: Run** `node --test tests/whatsapp-assistant.test.js` → FAIL.
- [ ] **Step 3: Implémenter** `assistant.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(whatsapp): réponses libres par IA, bornées aux faits du produit`.

---

### Task 5: Stockage Supabase et envoi

**Files:**
- Create: `src/lib/whatsapp/store.ts`, `src/lib/whatsapp/send.ts`
- Test: `tests/whatsapp-store-send.test.js`

**Interfaces:**
- Consumes: `ContactState`, `Lang` (Task 3), `HistoryItem` (Task 4), `WhatsAppConfig` (Task 2), `getSupabaseAdminConfig` (`@/lib/billing/config`).
- Produces (`store.ts`, chaque fonction reçoit un `SupabaseClient` en premier argument pour être testable) :
  - `class WhatsAppTablesMissingError extends Error` — levée quand Supabase renvoie `PGRST205` ou `42P01`.
  - `upsertContact(db, input: { waId: string; profileName: string | null; referral: Record<string, unknown> | null }): Promise<ContactState>` — crée la ligne si absente ; n'écrase jamais `referral` déjà présent, ni `greeted_at`, ni `handoff_until`.
  - `claimInbound(db, input: { wamid: string; waId: string; kind: string; body: string | null }): Promise<boolean>` — insère la ligne `direction: 'user'` ; `false` sur violation d'unicité `23505` (doublon Meta), `true` sinon.
  - `recordOutbound(db, input: { waId: string; wamid: string | null; direction: 'bot' | 'human'; kind: string; body: string | null }): Promise<void>`
  - `updateContact(db, waId: string, patch: { lang?: Lang; greetedAt?: Date; handoffUntil?: Date | null }): Promise<void>`
  - `recentHistory(db, waId: string, limit: number): Promise<HistoryItem[]>` — ordre chronologique, sans le message en cours.
  - `countAssistantReplies(db, waId: string, since: Date): Promise<number>` — lignes `direction = 'bot'` et `kind = 'assistant'`.
- Produces (`send.ts`) :
  - `sendText(config: WhatsAppConfig, to: string, body: string, fetchImpl?: typeof fetch): Promise<string | null>` — `POST https://graph.facebook.com/<graphVersion>/<phoneNumberId>/messages`, `Authorization: Bearer <accessToken>`, corps `{ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body, preview_url: true } }` ; renvoie `messages[0].id`, ou `null` sur erreur (journalisée `[whatsapp] send failed` avec le statut, jamais le jeton).

- [ ] **Step 1: Write the failing tests** dans `tests/whatsapp-store-send.test.js` avec un faux client Supabase (objet chaînable qui enregistre les appels) et un `fetchImpl` simulé :
  - `claimInbound` : première insertion → `true` ; erreur `{ code: '23505' }` → `false` ; erreur `{ code: 'PGRST205' }` → rejette avec `WhatsAppTablesMissingError`.
  - `upsertContact` sur un contact existant avec `greeted_at` et `referral` → la requête n'envoie ni `greeted_at`, ni `handoff_until`, ni `referral`.
  - `countAssistantReplies` filtre sur `direction = 'bot'`, `kind = 'assistant'`, `created_at >= since`.
  - `sendText` : URL `https://graph.facebook.com/v23.0/PNID/messages`, corps avec `preview_url: true`, renvoie `'wamid.X'` ; statut 401 → `null` et le jeton n'apparaît dans aucun `console.error`.
- [ ] **Step 2: Run** `node --test tests/whatsapp-store-send.test.js` → FAIL.
- [ ] **Step 3: Implémenter** `store.ts` et `send.ts`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(whatsapp): stockage des conversations et envoi par l'API Graph`.

---

### Task 6: Route du webhook

**Files:**
- Create: `src/app/api/whatsapp/webhook/route.ts`
- Test: `tests/whatsapp-webhook-route.test.js` (charger la route avec `loadTsModule`, remplacer `@/lib/whatsapp/store`, `@/lib/whatsapp/send`, `@/lib/whatsapp/assistant` et `@supabase/supabase-js` avec `stubModule`, comme `tests/credits-routes.test.js`)

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: `GET(request: Request): Promise<Response>`, `POST(request: Request): Promise<Response>`, `export const dynamic = 'force-dynamic'`, `export const maxDuration = 30`.

  **GET** : config absente → 404. `hub.mode === 'subscribe'` et `hub.verify_token === verifyToken` → 200, corps = `hub.challenge` en `text/plain`. Sinon → 403.

  **POST**, dans cet ordre :
  1. `rawBody = await request.text()`. Config absente → 200 `'ok'` (journalisé).
  2. `verifySignature(rawBody, x-hub-signature-256, appSecret)` faux → 401.
  3. `JSON.parse(rawBody)` (erreur → 200) puis `parseWebhook(body, phoneNumberId)`.
  4. Pour chaque événement, séquentiellement, dans un `try/catch` par événement (une erreur journalisée n'empêche pas les suivants) :
     - **Écho** : `upsertContact`, `recordOutbound(direction 'human', kind 'echo')`, et en mode `coexistence` `updateContact(handoffUntil = now + HANDOFF_HOURS)`.
     - **Entrant** : `upsertContact` ; `claimInbound` → `false` : passer au suivant. `lang = detectLang(text, contact.lang)`, enregistré s'il change. Bot désactivé (`enabled: false`) → passer au suivant. `decide(...)` avec `assistantRepliesLast24h = countAssistantReplies(now − 24 h)`.
       - `silent` → rien.
       - `send` → `sendText`, `recordOutbound(direction 'bot', kind 'fixed')`, `updateContact` avec `greetedAt` si `markGreeted`, `handoffUntil` si `handoff`.
       - `assistant` → `askAssistant` avec `recentHistory(HISTORY_MESSAGES)`. `null` → envoyer `COPY.fallback[lang]` (+ `redirect[lang]` en mode `redirect`) et relais en mode `coexistence`. Sinon envoyer `reply` (`kind 'assistant'`) ; si `handoff`, ajouter en mode `redirect` un second message `redirect[lang]`, en mode `coexistence` poser `handoffUntil`. Pas de clé OpenRouter → traité comme `null`.
  5. `WhatsAppTablesMissingError` → journaliser `[whatsapp] migration 015 non appliquée`, arrêter, 200.
  6. Toujours répondre 200 `'ok'` une fois la signature validée.

- [ ] **Step 1: Write the failing tests** dans `tests/whatsapp-webhook-route.test.js` :
  - GET avec le bon jeton → 200, corps `'CHALLENGE'` ; mauvais jeton → 403.
  - POST sans en-tête de signature → 401, aucun envoi.
  - POST signé, nouveau contact, texte en arabe → un `sendText` avec `COPY.greeting`, `updateContact` avec `greetedAt` ; la signature est calculée sur le corps tel qu'envoyé.
  - Même POST rejoué alors que `claimInbound` renvoie `false` → aucun `sendText`, statut 200.
  - Écho puis texte du même contact → aucun `sendText` pour le texte.
  - Texte libre, `askAssistant` → `null` → `sendText` avec `COPY.fallback.fr` et `handoffUntil` posé.
  - Texte libre, `askAssistant` → `{ reply: 'Salam', handoff: false }` → `sendText` avec `'Salam'`, `recordOutbound` avec `kind: 'assistant'`.
  - `WHATSAPP_BOT_ENABLED` absent → message enregistré, aucun `sendText`.
  - `claimInbound` rejette `WhatsAppTablesMissingError` → 200, aucun `sendText`.
  - Payload avec deux messages dont le premier fait échouer `upsertContact` → le second reçoit quand même sa réponse.
- [ ] **Step 2: Run** `node --test tests/whatsapp-webhook-route.test.js` → FAIL.
- [ ] **Step 3: Implémenter** la route. Client Supabase admin créé comme dans `src/app/api/vision/route.ts` (`getSupabaseAdminConfig` + `createClient`).
- [ ] **Step 4: Run** → PASS, puis `npm run test:node`, `npm run lint`, `npx tsc --noEmit`, `npm run build` ; comparer les échecs avec `main`.
- [ ] **Step 5: Commit** `feat(whatsapp): webhook du bot (vérification Meta, routage, relais humain)`.

---

### Task 7: Passage en production et PR

**Files:**
- Modify: `docs/whatsapp-bot.md`

- [ ] **Step 1: Compléter `docs/whatsapp-bot.md`, section « Passage en production »** :
  1. Appliquer `supabase/migrations/015_whatsapp_bot.sql` sur Supabase.
  2. Fusionner la PR, attendre le déploiement, puis configurer le webhook (Task 0, point 6). Meta doit afficher « Vérifié ».
  3. Test avec `WHATSAPP_BOT_ENABLED=false` : envoyer un message depuis un autre numéro ; une ligne apparaît dans `whatsapp_messages`, rien n'est envoyé.
  4. **Désactiver le message d'accueil et le message d'absence** de l'app WhatsApp Business (téléphone → Outils professionnels).
  5. Passer `WHATSAPP_BOT_ENABLED=true` et redéployer. Tester depuis un numéro neuf : accueil, puis `1`, `2`, une question libre en français, une en darija, un vocal, puis `3`. Répondre depuis l'app et vérifier que le bot se tait.
  6. Retour arrière immédiat : `WHATSAPP_BOT_ENABLED=false`, puis réactiver le message d'accueil de l'app.
  7. Où lire les conversations : table `whatsapp_messages` dans Supabase (une boîte de réception web est hors périmètre v1).
- [ ] **Step 2: Commit** `docs(whatsapp): passage en production du bot`.
- [ ] **Step 3: Pousser `feat/whatsapp-bot` et ouvrir la PR** vers `main`, avec dans la description : la migration à appliquer avant fusion, les variables d'environnement, le résultat des quatre commandes de vérification et la comparaison avec `main`.
