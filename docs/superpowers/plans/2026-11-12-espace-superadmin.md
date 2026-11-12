# Espace superadmin QatliA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner au propriétaire de QatliA un back office où il voit tout ce que la base sait de chaque client (identité, solde, achats, consommation, projets), suit toutes les commandes et tous les paiements, lit ses indicateurs et corrige un solde.

**Architecture:** Les pages admin sont des Server Components sous `src/app/(site)/admin/(secure)/`, protégées par un garde qui vérifie la session Supabase contre une liste d'identifiants (`ADMIN_USER_IDS`). Elles lisent la base côté serveur avec la clé service-role, à travers une couche `src/lib/admin/*` ; les agrégats par client et les indicateurs viennent de fonctions SQL `SECURITY DEFINER` réservées à `service_role`. Les écritures (valider un paiement, ajuster des crédits, noter un client) passent par des routes `/api/admin/*` protégées par le même garde et tracées dans un journal d'audit.

**Tech Stack:** Next.js 14.2 (App Router), Supabase (`@supabase/ssr`, `@supabase/supabase-js`), Postgres 17, zod 4, Tailwind 3, tests `node:test` (`tests/*.test.js` avec `tests/helpers/load-ts-module.js` et `stub-module.js`), Playwright.

**Spec:** aucune. Le propriétaire a demandé un plan direct, avec une seule consigne : « le maximum d'informations pour chaque client ». La section **Décisions de conception** ci-dessous tient lieu de spec ; ce sont les choix du rédacteur du plan, à valider par le propriétaire avant exécution.

## Décisions de conception

1. **Accès par compte, pas par code partagé.** Est admin tout utilisateur Supabase dont l'`id` figure dans la variable d'environnement `ADMIN_USER_IDS` (UUID séparés par des virgules). L'`id` est choisi plutôt que l'email parce qu'il ne peut pas être usurpé par une inscription. Variable absente ou vide : personne n'est admin.
2. **Transition sans coupure.** La page actuelle `/admin` (code secret `ADMIN_PANEL_SECRET`) reste intacte pendant le lot 1. Elle est remplacée au lot 2, une fois que le propriétaire a confirmé qu'il ouvre `/admin/clients` en production avec son compte.
3. **Trois lots, trois PR**, chacun livrable seul : (1) clients, (2) paiements et indicateurs, (3) actions.
4. **Fiche client = tout ce que la base enregistre déjà**, plus trois ajouts : une note privée avec téléphone et étiquettes par client, le montant réel des paiements par carte (à partir du lot 2 ; les paiements antérieurs affichent le prix catalogue précédé de « ≈ »), un journal des actions admin.
5. **Ce que la fiche ne montre pas :** le contenu des devis des clients (noms et prix de leurs propres clients). La fiche indique seulement qu'un devis existe.
6. **Interface admin en français uniquement**, chaînes en dur, même style que la page actuelle (`bg-[#0B1220]`, accent ambre). Le dossier admin est exclu du test de couverture i18n, qui échoue déjà aujourd'hui sur `admin/page.tsx`.
7. **La confirmation d'un paiement manuel reste un geste manuel** (demande du propriétaire, 2026-11-12) : il vérifie lui-même le virement ou l'encaissement, puis clique sur « Valider — créditer ». Aucun rapprochement bancaire automatique, aucune preuve de paiement à téléverser.
8. **Hors périmètre :** suspension de compte, export CSV, graphiques, journal des exports PDF/DXF (rien ne les enregistre aujourd'hui), plusieurs niveaux de rôle admin.

## Ce que la base sait d'un client (inventaire)

| Source | Champs utilisés |
|---|---|
| `auth.users` | `email`, `created_at`, `last_sign_in_at`, `email_confirmed_at`, `phone`, `raw_app_meta_data->>'provider'`, `raw_user_meta_data->>'full_name'`, `banned_until` |
| `public.profiles` | `full_name`, `locale`, `credits`, `updated_at` |
| `public.credit_transactions` | `type`, `amount`, `balance_after`, `description`, `reason`, `stripe_payment_id`, `created_at` |
| `public.manual_payments` | toutes les colonnes |
| `public.projects` | `id`, `name`, `material`, `sheet_width`, `sheet_height`, `created_at`, `options_json` |
| `public.panel_presets` | nombre de lignes par `user_id` |

Le grand livre `credit_transactions` se lit ainsi (première règle qui s'applique) :

| Ordre | Condition | `kind` |
|---|---|---|
| 1 | `stripe_payment_id` commence par `manual:` | `manual_payment` |
| 2 | commence par `creem:` | `card_creem` |
| 3 | commence par `cs:` | `card_stripe` |
| 4 | `reason = 'refund'` ou clé commençant par `optimize_refund_` | `refund` |
| 5 | clé commençant par `admin:` ou `type = 'adjustment'` | `admin_adjustment` |
| 6 | `type = 'usage'` et `reason = 'vision'` | `scan` |
| 7 | `type = 'usage'` et `reason = 'optimize'` | `optimization` |
| 8 | sinon | `other` |

Les remboursements d'optimisation sont enregistrés avec `type = 'purchase'` : ils ne sont ni un achat ni un revenu.

## Global Constraints

- La production (qatlia.ma) a de vrais clients : PR uniquement, jamais de push sur `main`. Avant chaque PR : `npm run test:node`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, et comparaison des échecs avec `main`.
- Chaque migration est additive et idempotente (`IF NOT EXISTS`, `CREATE OR REPLACE`), ne modifie aucune fonction existante (`add_credits`, `consume_credit`, `ensure_profile`) et ne touche pas `FULL_DATABASE_SETUP.sql`.
- Le propriétaire applique la migration sur Supabase **avant** de fusionner la PR qui la lit. Le code doit quand même supporter son absence : une erreur PostgREST `PGRST202` (fonction introuvable) ou `PGRST205` (table introuvable) affiche le bandeau « Migration NNN non appliquée » au lieu d'une erreur 500.
- Toute fonction SQL admin porte `SECURITY DEFINER`, `SET search_path = public, pg_temp`, puis `REVOKE ALL ... FROM PUBLIC, anon, authenticated` et `GRANT EXECUTE ... TO service_role`. Toute table admin a RLS activé, aucune policy, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, `GRANT ALL ... TO service_role`.
- La clé service-role ne quitte jamais le serveur : `src/lib/admin/db.ts` n'est importé que par des Server Components et des route handlers. Aucun fichier sous `src/lib/admin/` autre que `ledger.ts`, `projects.ts` et `format.ts` ne doit être importable depuis un composant client.
- Toute page sous `(secure)` exporte `dynamic = 'force-dynamic'`.
- Toute route `/api/admin/*` : `401 { error: 'UNAUTHORIZED' }` si l'appelant n'est pas admin ; pour les méthodes autres que `GET`, `403 { error: 'BAD_ORIGIN' }` si l'en-tête `Origin` est présent et que son hôte diffère de l'en-tête `Host`.
- Aucune nouvelle dépendance npm.
- Dates affichées dans le fuseau `Africa/Casablanca`, format `fr-FR`.
- Messages de commit en français, style du dépôt (`feat(admin): …`), terminés par `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. `ADMIN_USER_IDS` absente, vide, avec espaces ou UUID en majuscules : absente ou vide ferme tout ; espaces et majuscules sont tolérés. Un client connecté non admin ne reçoit aucune donnée. → Task 1.
2. Migration pas encore appliquée : la page affiche le bandeau, pas une 500. → Tasks 4, 9.
3. Client sans ligne `profiles`, sans aucune transaction, ou avec un `options_json` nul, de type chaîne ou dont `pieces` n'est pas un tableau : la fiche s'affiche avec des zéros. → Tasks 2, 4.
4. Les remboursements (`reason = 'refund'`) ne comptent ni comme achat ni comme revenu. → Tasks 2, 3.
5. Double clic ou nouvelle tentative sur un ajustement de crédits : crédité une seule fois ; un retrait supérieur au solde est refusé. → Task 10.

---

## Structure des fichiers

| Fichier | Rôle | Lot |
|---|---|---|
| `src/lib/admin/auth.ts` | Qui est admin ; garde de page et de route | 1 |
| `src/lib/admin/db.ts` | Client Supabase service-role, erreurs « migration absente » | 1 |
| `src/lib/admin/ledger.ts` | Classement et résumé du grand livre (pur) | 1 |
| `src/lib/admin/projects.ts` | Résumé d'un projet depuis `options_json` (pur) | 1 |
| `src/lib/admin/format.ts` | Dates, montants, libellés (pur) | 1 |
| `src/lib/admin/clients.ts` | Liste des clients, fiche client | 1 |
| `supabase/migrations/012_admin_clients.sql` | `admin_client_notes`, `admin_client_list` | 1 |
| `src/app/(site)/admin/(secure)/layout.tsx` | Garde + navigation | 1 |
| `src/app/(site)/admin/(secure)/clients/page.tsx` | Liste des clients | 1 |
| `src/app/(site)/admin/(secure)/clients/[id]/page.tsx` | Fiche client | 1 |
| `supabase/migrations/013_admin_payments.sql` | Montants carte, `admin_audit_log`, `admin_kpis` | 2 |
| `src/lib/admin/audit.ts` | Écriture du journal d'audit | 2 |
| `src/lib/admin/payments.ts` | Liste unifiée des paiements | 2 |
| `src/lib/admin/kpis.ts` | Lecture des indicateurs | 2 |
| `src/app/api/admin/payments/route.ts` | Décision sur une commande manuelle | 2 |
| `src/app/(site)/admin/(secure)/paiements/page.tsx` + `PaymentActions.tsx` | Paiements | 2 |
| `src/app/(site)/admin/(secure)/page.tsx` | Vue d'ensemble (remplace `admin/page.tsx`) | 2 |
| `supabase/migrations/014_admin_actions.sql` | `admin_adjust_credits` | 3 |
| `src/app/api/admin/clients/[id]/credits/route.ts` | Ajustement de crédits | 3 |
| `src/app/api/admin/clients/[id]/note/route.ts` | Note, téléphone, étiquettes | 3 |
| `src/app/(site)/admin/(secure)/clients/[id]/ClientActions.tsx` | Formulaires de la fiche | 3 |

---

# Lot 1 — Clients (PR 1)

Branche : `feat/admin-clients`, créée depuis `main` à jour.

### Task 1 : Garde admin

**Files:**
- Create: `src/lib/admin/auth.ts`, `src/lib/admin/db.ts`
- Modify: `.env.example` (ajouter `ADMIN_USER_IDS=`), `tests/i18n-coverage.test.js:42-47`
- Test: `tests/admin-auth.test.js`

**Interfaces:**
- Consumes: `createClient` de `@/lib/supabase/server` ; `getSupabaseAdminConfig`, `Env` de `@/lib/billing/config` ; `isUuid` de `@/lib/billing/grant`.
- Produces:
  - `getAdminUserIds(env?: Env): string[]` — UUID valides, en minuscules, sans doublon.
  - `isAdminUserId(userId: unknown, env?: Env): boolean`
  - `getAdminUser(): Promise<{ userId: string; email: string | null } | null>` — session via `supabase.auth.getUser()`.
  - `requireAdminPage(returnTo: string): Promise<{ userId: string; email: string | null }>` — sans session : `redirect('/auth/login?redirect=' + encodeURIComponent(returnTo))` ; session non admin : `notFound()`.
  - `authorizeAdminRequest(req: Request): Promise<{ ok: true; admin: { userId: string; email: string | null } } | { ok: false; response: NextResponse }>`
  - `getAdminDb(): SupabaseClient | null` (dans `db.ts`)
  - `isMissingMigration(error: { code?: string; message?: string } | null): boolean` (dans `db.ts`) — vrai pour `PGRST202`, `PGRST205`, `42883`, `42P01`.

- [ ] **Step 1 : écrire les tests qui échouent** dans `tests/admin-auth.test.js`. Stubber `@/lib/supabase/server` (un `state.user` mutable, comme `tests/credits-routes.test.js:93-97`) et `next/navigation` (`redirect` et `notFound` lèvent `new Error('REDIRECT:' + url)` et `new Error('NOT_FOUND')`).

```js
const ADMIN = '11111111-2222-4333-8444-555555555555';
const OTHER = '99999999-8888-4777-8666-555555555555';

test('getAdminUserIds : absente ou vide ne désigne personne', () => {
  assert.deepEqual(auth.getAdminUserIds({}), []);
  assert.deepEqual(auth.getAdminUserIds({ ADMIN_USER_IDS: '  ' }), []);
});
test('getAdminUserIds : tolère espaces et majuscules, écarte ce qui n\'est pas un UUID', () => {
  assert.deepEqual(
    auth.getAdminUserIds({ ADMIN_USER_IDS: ` ${ADMIN.toUpperCase()} , pas-un-uuid,${ADMIN}` }),
    [ADMIN],
  );
});
test('isAdminUserId : refuse un autre compte, null et un objet', () => {
  const env = { ADMIN_USER_IDS: ADMIN };
  assert.equal(auth.isAdminUserId(ADMIN, env), true);
  assert.equal(auth.isAdminUserId(OTHER, env), false);
  assert.equal(auth.isAdminUserId(null, env), false);
  assert.equal(auth.isAdminUserId({}, env), false);
});
test('requireAdminPage : sans session, redirige vers la connexion avec le retour', async () => {
  state.user = null;
  await assert.rejects(auth.requireAdminPage('/admin/clients'), /REDIRECT:\/auth\/login\?redirect=%2Fadmin%2Fclients/);
});
test('requireAdminPage : un client connecté non admin obtient un 404', async () => {
  state.user = { id: OTHER, email: 'client@example.com' };
  await assert.rejects(auth.requireAdminPage('/admin/clients'), /NOT_FOUND/);
});
test('authorizeAdminRequest : 401 sans session et pour un non-admin', async () => { /* status 401, body.error === 'UNAUTHORIZED' */ });
test('authorizeAdminRequest : POST avec un Origin étranger répond 403 BAD_ORIGIN', async () => {
  // headers: { origin: 'https://evil.example', host: 'qatlia.ma' }, session admin
});
test('authorizeAdminRequest : POST même origine et GET sans Origin passent pour l\'admin', async () => { /* ok === true, admin.userId === ADMIN */ });
```

Les trois derniers tests s'exécutent avec `process.env.ADMIN_USER_IDS = ADMIN`, restauré après chaque test.

- [ ] **Step 2 : lancer** `node --test tests/admin-auth.test.js` — attendu : échec, module introuvable.
- [ ] **Step 3 : implémenter** `src/lib/admin/auth.ts` et `src/lib/admin/db.ts` selon les signatures ci-dessus.
- [ ] **Step 4 : relancer** `node --test tests/admin-auth.test.js` — attendu : 8 tests réussis.
- [ ] **Step 5 : exclure le back office du test i18n.** Dans `tests/i18n-coverage.test.js`, filtrer `targets` pour écarter tout chemin contenant le segment `admin` sous `src/app/(site)/` (comparer après `split(path.sep)`), avec un commentaire : interface opérateur, française uniquement. Lancer `node --test tests/i18n-coverage.test.js` — attendu : réussite (ce test échoue aujourd'hui sur `admin/page.tsx`).
- [ ] **Step 6 : commit** `feat(admin): garde d'accès par compte (ADMIN_USER_IDS)`.

### Task 2 : Lecture du grand livre et des projets (modules purs)

**Files:**
- Create: `src/lib/admin/ledger.ts`, `src/lib/admin/projects.ts`, `src/lib/admin/format.ts`
- Test: `tests/admin-ledger.test.js`, `tests/admin-projects.test.js`

**Interfaces:**
- Produces (`ledger.ts`) :
  - `LEDGER_KEY_PREFIXES = { manual: 'manual:', creem: 'creem:', stripe: 'cs:', refund: 'optimize_refund_', admin: 'admin:' } as const`
  - `type LedgerKind = 'manual_payment' | 'card_creem' | 'card_stripe' | 'refund' | 'admin_adjustment' | 'scan' | 'optimization' | 'other'`
  - `interface LedgerRow { id: string; type: string | null; amount: number; balance_after: number | null; description: string | null; reason: string | null; stripe_payment_id: string | null; amount_paid?: number | null; currency?: string | null; created_at: string }`
  - `classifyLedgerEntry(row: LedgerRow): LedgerKind` — table de la section « inventaire ».
  - `interface LedgerSummary { scans: number; optimizations: number; creditsUsed: number; creditsPurchased: number; creditsRefunded: number; creditsAdjusted: number; purchaseCount: number; firstPurchaseAt: string | null; lastPurchaseAt: string | null; lastEntryAt: string | null; freeCredits: number | null }`
  - `summarizeLedger(rows: LedgerRow[], balance: number | null): LedgerSummary` — `creditsUsed` = somme des `-amount` des `scan`, `optimization` et des `other` négatifs ; `creditsPurchased` = somme des trois kinds de paiement ; `freeCredits` = `balance − somme de tous les amount` (crédits offerts à l'inscription), `null` si `balance` est `null`.
- Produces (`projects.ts`) :
  - `interface ProjectSummary { id: string; name: string; material: string; sheetWidth: number; sheetHeight: number; createdAt: string; pieceCount: number; sheetsUsed: number | null; wastePercentage: number | null; scanThumb: string | null; pdfGeneratedAt: string | null; hasQuotation: boolean }`
  - `summarizeProject(row: { id: string; name: string | null; material: string | null; sheet_width: number | string | null; sheet_height: number | string | null; created_at: string; options_json: unknown }): ProjectSummary` — `pieceCount` = somme des `quantity` de `options_json.pieces` (1 par défaut) ; `sheetsUsed` et `wastePercentage` viennent de `options_json.result` ; `scanThumb` n'est accepté que s'il commence par `data:image/`.
- Produces (`format.ts`) : `formatDateTime(iso: string | null): string` (`'—'` pour `null`), `formatRelativeDays(iso: string | null, now: Date): string`, `KIND_LABELS: Record<LedgerKind, string>`, `packLabel(packId: string | null): string`.

- [ ] **Step 1 : écrire les tests qui échouent.**

```js
const row = (over) => ({ id: 'x', type: 'usage', amount: -1, balance_after: 0, description: null,
  reason: null, stripe_payment_id: null, created_at: '2026-11-01T10:00:00Z', ...over });

test('classifyLedgerEntry suit l\'ordre des règles', () => {
  assert.equal(classifyLedgerEntry(row({ type: 'purchase', amount: 80, reason: 'standard', stripe_payment_id: 'manual:abc' })), 'manual_payment');
  assert.equal(classifyLedgerEntry(row({ type: 'purchase', amount: 30, reason: 'starter', stripe_payment_id: 'creem:tran_1' })), 'card_creem');
  assert.equal(classifyLedgerEntry(row({ type: 'purchase', amount: 30, reason: 'starter', stripe_payment_id: 'cs:cs_1' })), 'card_stripe');
  assert.equal(classifyLedgerEntry(row({ type: 'purchase', amount: 1, reason: 'refund', stripe_payment_id: 'optimize_refund_1_ab' })), 'refund');
  assert.equal(classifyLedgerEntry(row({ type: 'adjustment', amount: 10, reason: 'admin_adjustment', stripe_payment_id: 'admin:r1' })), 'admin_adjustment');
  assert.equal(classifyLedgerEntry(row({ reason: 'vision' })), 'scan');
  assert.equal(classifyLedgerEntry(row({ reason: 'optimize' })), 'optimization');
  assert.equal(classifyLedgerEntry(row({ type: null, reason: null })), 'other');
});
test('summarizeLedger : un remboursement n\'est ni un achat ni un revenu', () => {
  const s = summarizeLedger([
    row({ type: 'purchase', amount: 80, stripe_payment_id: 'manual:a', created_at: '2026-11-02T10:00:00Z' }),
    row({ type: 'purchase', amount: 1, reason: 'refund', stripe_payment_id: 'optimize_refund_1' }),
    row({ reason: 'vision' }), row({ reason: 'vision' }), row({ reason: 'optimize' }),
  ], 98);
  assert.deepEqual(
    [s.purchaseCount, s.creditsPurchased, s.creditsRefunded, s.scans, s.optimizations, s.creditsUsed, s.freeCredits],
    [1, 80, 1, 2, 1, 3, 20],
  );
  assert.equal(s.firstPurchaseAt, '2026-11-02T10:00:00Z');
});
test('summarizeLedger : aucun mouvement donne des zéros et des dates nulles', () => {
  const s = summarizeLedger([], 20);
  assert.deepEqual([s.purchaseCount, s.creditsUsed, s.lastEntryAt, s.freeCredits], [0, 0, null, 20]);
});
```

`tests/admin-projects.test.js` :

```js
const base = { id: 'p1', name: 'Cuisine', material: 'mdf', sheet_width: '208.00', sheet_height: '278.00', created_at: '2026-11-01T10:00:00Z' };
test('summarizeProject lit pièces, résultat, scan et devis', () => {
  const s = summarizeProject({ ...base, options_json: {
    pieces: [{ quantity: 2 }, { quantity: 3 }, {}], result: { sheetsUsed: 2, wastePercentage: 12.5 },
    scanThumb: 'data:image/jpeg;base64,AAA', pdfGeneratedAt: '2026-11-01T11:00:00Z', quotation: { clientName: 'X' } } });
  assert.deepEqual([s.pieceCount, s.sheetsUsed, s.wastePercentage, s.hasQuotation, s.sheetWidth], [6, 2, 12.5, true, 208]);
  assert.equal(s.scanThumb, 'data:image/jpeg;base64,AAA');
});
for (const bad of [null, 'texte', 42, [], { pieces: 'non' }, { result: null }]) {
  test(`summarizeProject tolère options_json = ${JSON.stringify(bad)}`, () => {
    const s = summarizeProject({ ...base, options_json: bad });
    assert.deepEqual([s.pieceCount, s.sheetsUsed, s.scanThumb, s.hasQuotation], [0, null, null, false]);
  });
}
test('summarizeProject refuse un scanThumb qui n\'est pas une image data:', () => {
  assert.equal(summarizeProject({ ...base, options_json: { scanThumb: 'javascript:alert(1)' } }).scanThumb, null);
});
```

- [ ] **Step 2 : lancer** `node --test tests/admin-ledger.test.js tests/admin-projects.test.js` — attendu : échec, modules introuvables.
- [ ] **Step 3 : implémenter** les trois modules.
- [ ] **Step 4 : relancer** — attendu : tous réussis.
- [ ] **Step 5 : commit** `feat(admin): lecture du grand livre et des projets`.

### Task 3 : Migration 012 — liste des clients

**Files:**
- Create: `supabase/migrations/012_admin_clients.sql`
- Test: `tests/admin-sql.test.js`

**Interfaces:**
- Consumes: `LEDGER_KEY_PREFIXES` (Task 2).
- Produces:
  - Table `public.admin_client_notes (user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, phone TEXT, tags TEXT[] NOT NULL DEFAULT '{}', note TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by UUID)`.
  - Fonction `public.admin_client_list(p_search TEXT DEFAULT NULL, p_segment TEXT DEFAULT 'all', p_sort TEXT DEFAULT 'created_desc', p_limit INT DEFAULT 50, p_offset INT DEFAULT 0)`, `STABLE`, renvoyant une table :

| Colonne | Type | Définition |
|---|---|---|
| `user_id` | UUID | `auth.users.id` — une ligne par utilisateur, même sans `profiles` |
| `email` | TEXT | `COALESCE(u.email, p.email)` |
| `full_name` | TEXT | `COALESCE(p.full_name, u.raw_user_meta_data->>'full_name')` |
| `locale` | TEXT | `p.locale` |
| `provider` | TEXT | `u.raw_app_meta_data->>'provider'` |
| `credits` | INT | `COALESCE(p.credits, 0)` |
| `signed_up_at` | TIMESTAMPTZ | `u.created_at` |
| `last_sign_in_at` | TIMESTAMPTZ | `u.last_sign_in_at` |
| `scans` | BIGINT | lignes `type='usage' AND reason='vision'` |
| `optimizations` | BIGINT | lignes `type='usage' AND reason='optimize'` |
| `purchases` | BIGINT | lignes dont la clé commence par `manual:`, `creem:` ou `cs:` |
| `credits_purchased` | BIGINT | somme des `amount` de ces mêmes lignes |
| `paid_mad` | NUMERIC | somme de `manual_payments.amount_mad` où `status='granted'` |
| `pending_orders` | BIGINT | `manual_payments` où `status='pending'` |
| `projects` | BIGINT | nombre de `projects` |
| `last_activity_at` | TIMESTAMPTZ | `GREATEST` de `last_sign_in_at`, dernière transaction, dernier projet |
| `phone` | TEXT | `admin_client_notes.phone` |
| `tags` | TEXT[] | `admin_client_notes.tags` |
| `total_count` | BIGINT | `count(*) OVER ()` avant `LIMIT` |

  - `p_search` : `ILIKE '%…%'` sur email, nom, téléphone, ou égalité sur `user_id::text`. Échapper `%` et `_`.
  - `p_segment` : `all` ; `paying` (`purchases > 0`) ; `never_paid` (`purchases = 0`) ; `out_of_credits` (`credits = 0`) ; `inactive_30d` (`last_activity_at < now() - interval '30 days'` ou nul) ; `pending_order` (`pending_orders > 0`). Valeur inconnue : `all`.
  - `p_sort` : `created_desc`, `last_activity_desc`, `credits_asc`, `credits_desc`, `paid_desc`, `scans_desc` ; valeur inconnue : `created_desc`. Tri par `CASE` dans `ORDER BY`, sans SQL dynamique ; `NULLS LAST` ; départage par `user_id`.
  - `p_limit` borné à 1–200, `p_offset` à ≥ 0.
  - Agréger chaque table dans sa propre sous-requête groupée par `user_id` avant la jointure (pas de jointures en éventail).

- [ ] **Step 1 : écrire les tests qui échouent** dans `tests/admin-sql.test.js`, avec `splitStatements`, `tablesWithRlsEnabled`, `effectivePrivileges`, `livePolicies` de `tests/helpers/sql-inspect.js` :

```js
const sql = fs.readFileSync('supabase/migrations/012_admin_clients.sql', 'utf8');
const statements = splitStatements(sql).map((s) => s.replace(/\s+/g, ' '));

test('012 : admin_client_notes est fermée aux rôles clients', () => {
  assert.ok(tablesWithRlsEnabled(sql).has('public.admin_client_notes'));
  assert.deepEqual(livePolicies(sql).filter((p) => p.table === 'public.admin_client_notes'), []);
  for (const role of ['anon', 'authenticated']) {
    assert.deepEqual(effectivePrivileges(sql, 'public.admin_client_notes', role), {});
  }
});
test('012 : admin_client_list est SECURITY DEFINER, search_path figé, service_role seul', () => {
  const fn = statements.find((s) => /CREATE OR REPLACE FUNCTION public\.admin_client_list/i.test(s));
  assert.match(fn, /SECURITY DEFINER/i);
  assert.match(fn, /SET search_path = public, pg_temp/i);
  assert.ok(statements.some((s) => /^REVOKE ALL ON FUNCTION public\.admin_client_list\(TEXT, TEXT, TEXT, INT, INT\) FROM PUBLIC, anon, authenticated$/i.test(s)));
  assert.ok(statements.some((s) => /^GRANT EXECUTE ON FUNCTION public\.admin_client_list\(TEXT, TEXT, TEXT, INT, INT\) TO service_role$/i.test(s)));
  assert.ok(!statements.some((s) => /^GRANT .*admin_client_list.* TO .*(anon|authenticated)/i.test(s)));
});
test('012 : le SQL classe les paiements avec les mêmes préfixes que ledger.ts', () => {
  for (const key of ['manual', 'creem', 'stripe']) assert.ok(sql.includes(`'${LEDGER_KEY_PREFIXES[key]}%'`));
});
test('012 : aucune exécution de SQL dynamique, aucune fonction existante modifiée', () => {
  assert.doesNotMatch(sql, /\bEXECUTE\s+(format|')/i);
  assert.doesNotMatch(sql, /FUNCTION public\.(add_credits|consume_credit|ensure_profile)\b/i);
});
```

- [ ] **Step 2 : lancer** `node --test tests/admin-sql.test.js` — attendu : échec, fichier introuvable.
- [ ] **Step 3 : écrire** `supabase/migrations/012_admin_clients.sql` selon le tableau, avec un en-tête de commentaire dans le style de `006_manual_payments.sql`.
- [ ] **Step 4 : relancer** — attendu : 4 tests réussis.
- [ ] **Step 5 : vérifier sur une vraie base.** Aucun Postgres n'est disponible localement ; demander au propriétaire d'exécuter la migration dans l'éditeur SQL de Supabase, puis `SELECT user_id, email, credits, scans, purchases, paid_mad, total_count FROM public.admin_client_list(NULL, 'all', 'paid_desc', 5, 0);`. Attendu : 5 lignes au plus, `total_count` égal au nombre d'utilisateurs, `paid_mad` égal à la somme des commandes validées du client en tête. Ne pas continuer vers la Task 5 sans ce résultat.
- [ ] **Step 6 : commit** `feat(admin): migration 012, agrégats par client`.

### Task 4 : Couche de données clients

**Files:**
- Create: `src/lib/admin/clients.ts`
- Test: `tests/admin-clients.test.js`

**Interfaces:**
- Consumes: `isMissingMigration` (Task 1) ; `LedgerRow`, `summarizeLedger`, `LedgerSummary` ; `summarizeProject`, `ProjectSummary` (Task 2) ; RPC `admin_client_list` (Task 3) ; `isUuid` de `@/lib/billing/grant`.
- Produces:
  - `CLIENT_SEGMENTS`, `CLIENT_SORTS` (tableaux `as const` des valeurs de la Task 3) et leurs types `ClientSegment`, `ClientSort`.
  - `interface ClientListRow` — les colonnes de la Task 3 en camelCase (`userId`, `lastActivityAt`, `paidMad: number`, …).
  - `parseClientListParams(searchParams: Record<string, string | string[] | undefined>): { search: string; segment: ClientSegment; sort: ClientSort; page: number }` — valeurs inconnues ramenées aux défauts, `page` ≥ 1, `search` rogné à 80 caractères.
  - `listClients(db: SupabaseClient, params: ReturnType<typeof parseClientListParams>): Promise<{ status: 'ok'; rows: ClientListRow[]; total: number; pageSize: 50 } | { status: 'migration_missing' } | { status: 'error' }>`
  - `interface ClientDetail { identity: { userId: string; email: string | null; fullName: string | null; locale: string | null; provider: string | null; phone: string | null; emailConfirmedAt: string | null; signedUpAt: string | null; lastSignInAt: string | null; bannedUntil: string | null }; balance: number | null; summary: LedgerSummary; ledger: LedgerRow[]; ledgerTruncated: boolean; orders: ManualOrderRow[]; paidMad: number; projects: ProjectSummary[]; panelPresetCount: number; note: { phone: string | null; tags: string[]; note: string | null; updatedAt: string | null } | null }`
  - `getClientDetail(db: SupabaseClient, userId: string): Promise<{ status: 'ok'; client: ClientDetail } | { status: 'not_found' } | { status: 'error' }>` — `not_found` si `userId` n'est pas un UUID ou si `db.auth.admin.getUserById` ne renvoie personne. Le grand livre est lu par ordre décroissant, 2000 lignes au plus (`ledgerTruncated` si la limite est atteinte) ; projets : 100 au plus. Les six lectures partent en parallèle (`Promise.all`). L'échec d'une lecture secondaire (`admin_client_notes`, `panel_presets`, `manual_payments`) donne une valeur vide, pas `error`.

- [ ] **Step 1 : écrire les tests qui échouent.** Fabriquer un faux client Supabase : `rpc(name, args)` enregistre l'appel et renvoie `state.rpcResult` ; `from(table)` renvoie un constructeur chaînable (`select`, `eq`, `order`, `limit`, `range`, `maybeSingle`, thenable) qui résout `state.tables[table]` ; `auth.admin.getUserById(id)` renvoie `state.authUser`.

```js
test('parseClientListParams ramène les valeurs inconnues aux défauts', () => {
  assert.deepEqual(parseClientListParams({ segment: 'x', sort: 'DROP', page: '-3', q: ['a', 'b'] }),
    { search: '', segment: 'all', sort: 'created_desc', page: 1 });
  assert.equal(parseClientListParams({ q: 'a'.repeat(200) }).search.length, 80);
});
test('listClients transmet recherche, segment, tri et décalage à la fonction SQL', async () => {
  await listClients(db, { search: 'ali', segment: 'paying', sort: 'paid_desc', page: 3 });
  assert.deepEqual(state.rpcCalls[0], { name: 'admin_client_list',
    args: { p_search: 'ali', p_segment: 'paying', p_sort: 'paid_desc', p_limit: 50, p_offset: 100 } });
});
test('listClients : fonction absente donne migration_missing, pas une exception', async () => {
  state.rpcResult = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
  assert.deepEqual(await listClients(db, defaults), { status: 'migration_missing' });
});
test('getClientDetail : identifiant invalide ou utilisateur absent donne not_found sans lire les tables', async () => {
  assert.deepEqual(await getClientDetail(db, 'pas-un-uuid'), { status: 'not_found' });
  assert.equal(state.fromCalls.length, 0);
});
test('getClientDetail : utilisateur sans profil ni mouvement s\'affiche avec des zéros', async () => {
  state.authUser = { id: UUID, email: 'a@b.ma', created_at: '2026-11-01T00:00:00Z', app_metadata: { provider: 'google' } };
  state.tables = { profiles: null, credit_transactions: [], manual_payments: [], projects: [], panel_presets: [], admin_client_notes: null };
  const r = await getClientDetail(db, UUID);
  assert.equal(r.status, 'ok');
  assert.deepEqual([r.client.balance, r.client.summary.scans, r.client.paidMad, r.client.projects.length, r.client.note],
    [null, 0, 0, 0, null]);
  assert.equal(r.client.identity.provider, 'google');
});
test('getClientDetail : paidMad ne compte que les commandes validées', async () => {
  state.tables.manual_payments = [{ amount_mad: 100, status: 'granted' }, { amount_mad: 50, status: 'pending' }, { amount_mad: 200, status: 'refused' }];
  assert.equal((await getClientDetail(db, UUID)).client.paidMad, 100);
});
test('getClientDetail : table des notes absente ne casse pas la fiche', async () => {
  state.tableErrors = { admin_client_notes: { code: 'PGRST205', message: 'not found' } };
  assert.equal((await getClientDetail(db, UUID)).status, 'ok');
});
```

- [ ] **Step 2 : lancer** `node --test tests/admin-clients.test.js` — attendu : échec, module introuvable.
- [ ] **Step 3 : implémenter** `src/lib/admin/clients.ts`.
- [ ] **Step 4 : relancer** — attendu : 7 tests réussis.
- [ ] **Step 5 : commit** `feat(admin): liste et fiche client, couche de données`.

### Task 5 : Pages clients

**Files:**
- Create: `src/app/(site)/admin/(secure)/layout.tsx`, `src/app/(site)/admin/(secure)/clients/page.tsx`, `src/app/(site)/admin/(secure)/clients/[id]/page.tsx`, `src/app/(site)/admin/(secure)/AdminNav.tsx`, `src/app/(site)/admin/(secure)/MigrationBanner.tsx`
- Test: `e2e/admin.spec.ts`

**Interfaces:**
- Consumes: `requireAdminPage`, `getAdminDb` (Task 1) ; `parseClientListParams`, `listClients`, `getClientDetail`, `CLIENT_SEGMENTS`, `CLIENT_SORTS` (Task 4) ; `classifyLedgerEntry` ; `format.ts` (Task 2).
- Produces: `<MigrationBanner migration="012" />` ; `<AdminNav current="clients" />` avec les entrées `Vue d'ensemble` (`/admin`), `Clients` (`/admin/clients`), `Paiements` (`/admin/paiements`). Au lot 1, seule `Clients` est un lien ; les deux autres pointent vers `/admin`, la page actuelle.

- [ ] **Step 1 : écrire le test e2e qui échoue** dans `e2e/admin.spec.ts` :

```ts
test('un visiteur non connecté est renvoyé vers la connexion', async ({ page }) => {
  await page.goto('/admin/clients');
  await expect(page).toHaveURL(/\/auth\/login\?redirect=%2Fadmin%2Fclients/);
});
test('une fiche client n\'est pas lisible sans session', async ({ page }) => {
  await page.goto('/admin/clients/11111111-2222-4333-8444-555555555555');
  await expect(page).toHaveURL(/\/auth\/login/);
});
```

- [ ] **Step 2 : lancer** `npx playwright test e2e/admin.spec.ts` — attendu : échec (404 sur `/admin/clients`).
- [ ] **Step 3 : écrire le layout.** `layout.tsx` appelle `await requireAdminPage('/admin/clients')`, exporte `dynamic = 'force-dynamic'`, rend l'en-tête (titre « QatliA — Back office », email de l'admin, lien « Site ») et `AdminNav`.
- [ ] **Step 4 : écrire la liste** `clients/page.tsx` (Server Component, `searchParams`). Un formulaire `GET` : champ de recherche `q`, segments en liens (`Tous`, `Payants`, `Jamais payé`, `Solde à zéro`, `Inactifs 30 j`, `Commande en attente`), liste déroulante de tri. Tableau, une ligne par client, chaque ligne lien vers la fiche : nom et email ; inscription ; dernière activité (relative) ; solde ; analyses (`scans`) ; achats (nombre, total MAD) ; projets ; pastille « commande en attente » ; téléphone. Pied : « N clients », pagination précédent/suivant par `page`. États : `migration_missing` → `<MigrationBanner migration="012" />` ; `error` → « Impossible de charger les clients. » ; liste vide → « Aucun client ne correspond. »
- [ ] **Step 5 : écrire la fiche** `clients/[id]/page.tsx`. `not_found` → `notFound()`. Sections, dans l'ordre :
  1. **Identité** — nom, email (lien `mailto:`), téléphone (lien `https://wa.me/` si présent), langue, méthode de connexion, email confirmé, inscrit le, dernière connexion, identifiant.
  2. **Chiffres** — solde ; crédits offerts ; crédits achetés ; crédits consommés ; analyses photo ; optimisations ; nombre d'achats ; total payé (MAD) ; premier et dernier achat ; dernière activité ; panneaux enregistrés.
  3. **Commandes manuelles** — numéro, pack, montant, méthode, statut, créée, décidée, référence, note opérateur.
  4. **Mouvements de crédits** — date, libellé (`KIND_LABELS`), pack, variation, solde après, clé de paiement. Mention « 2000 derniers mouvements » si `ledgerTruncated`.
  5. **Projets** — nom, matériau, panneau, nombre de pièces, panneaux utilisés, chute %, date, PDF généré le, « devis » si `hasQuotation`, miniature du scan dans un `<details>` si `scanThumb`.
  6. **Note** — lecture seule au lot 1 (« Aucune note » si vide).
- [ ] **Step 6 : relancer** `npx playwright test e2e/admin.spec.ts` — attendu : 2 tests réussis.
- [ ] **Step 7 : vérifier à la main.** `npm run dev` avec `ADMIN_USER_IDS` réglée sur son propre compte dans `.env.local` : ouvrir `/admin/clients`, essayer une recherche, chaque segment, chaque tri, la pagination ; ouvrir trois fiches (un client payant, un client sans achat, son propre compte) et comparer deux chiffres de chacune avec Supabase. Vérifier qu'un second compte non admin obtient un 404 et que `/admin` (page actuelle) fonctionne toujours avec le code secret.
- [ ] **Step 8 : contrôles complets** — `npm run test:node`, `npm run lint`, `npx tsc --noEmit`, `npm run build` ; comparer les échecs avec `main`.
- [ ] **Step 9 : commit** `feat(admin): liste des clients et fiche client`, push, PR vers `main`. Le corps de la PR rappelle les deux prérequis de fusion : migration 012 appliquée, `ADMIN_USER_IDS` définie sur Vercel.

---

# Lot 2 — Paiements et indicateurs (PR 2)

Branche : `feat/admin-payments`, créée depuis `main` après fusion de la PR 1. **Prérequis :** le propriétaire confirme qu'il ouvre `/admin/clients` en production avec son compte. Ce lot supprime l'accès par code secret.

### Task 6 : Enregistrer le montant réel des paiements par carte

**Files:**
- Create: `supabase/migrations/013_admin_payments.sql` (première partie)
- Modify: `src/lib/billing/grant.ts` (`CreditGrant`, `buildGrant`, `resolveGrant`), `src/lib/billing/creem.ts` (`buildGrant`, `resolveCreemGrant`), `src/lib/billing/apply-grant.ts`
- Test: `tests/admin-payment-amounts.test.js` ; étendre `tests/creem.test.js`

**Interfaces:**
- Produces:
  - SQL : `ALTER TABLE public.credit_transactions ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10,2)` et `ADD COLUMN IF NOT EXISTS currency TEXT`.
  - `CreditGrant` gagne `amountPaid: number | null` et `currency: string | null` (unité majeure, code ISO en majuscules). Stripe : `amount_total / 100` et `currency` de la session. Creem : `order.amount_paid / 100` et `order.currency`. Valeur absente, non numérique ou négative : `null` pour les deux champs. Le nombre de crédits accordés ne dépend jamais de ces champs.
  - `applyGrant` : après un `add_credits` réussi et non dupliqué, si `amountPaid !== null`, exécute `update({ amount_paid, currency }).eq('stripe_payment_id', grant.idempotencyKey)` dans un `try/catch`. Un échec est journalisé (`console.error`) et **ne change pas** la réponse 200 au fournisseur de paiement.

- [ ] **Step 1 : écrire les tests qui échouent.**

```js
test('Creem : le montant payé et la devise suivent la commande', () => {
  const r = resolveCreemGrant(fixture('checkout-completed-onetime.json'), PRODUCTS);
  assert.deepEqual([r.grant.amountPaid, r.grant.currency], [2.99, 'USD']);
});
test('Stripe : amount_total en centimes devient un montant en unité majeure', () => {
  const r = resolveGrant(session({ amount_total: 10000, currency: 'mad' }));
  assert.deepEqual([r.grant.amountPaid, r.grant.currency], [100, 'MAD']);
});
test('montant absent ou invalide : champs nuls, crédits inchangés', () => {
  for (const amount_total of [undefined, null, 'abc', -5]) {
    const r = resolveGrant(session({ amount_total, currency: 'mad' }));
    assert.deepEqual([r.grant.amountPaid, r.grant.currency, r.grant.credits], [null, null, CREDIT_PACKS.standard.credits]);
  }
});
test('applyGrant : l\'échec de l\'écriture du montant laisse la réponse à 200', async () => {
  state.updateError = { message: 'column amount_paid does not exist' };
  const res = await applyGrant(grant({ amountPaid: 2.99, currency: 'USD' }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).granted, true);
});
test('applyGrant : un événement redélivré n\'écrit pas le montant une seconde fois', async () => {
  state.rpcResult = { data: { success: true, duplicate: true }, error: null };
  await applyGrant(grant({ amountPaid: 2.99, currency: 'USD' }));
  assert.equal(state.updates.length, 0);
});
```

- [ ] **Step 2 : lancer** `node --test tests/admin-payment-amounts.test.js tests/creem.test.js tests/credits-routes.test.js` — attendu : les nouveaux tests échouent, les anciens passent.
- [ ] **Step 3 : implémenter** la migration et les trois modifications.
- [ ] **Step 4 : relancer** la même commande — attendu : tout passe, aucun test existant modifié autrement que par l'ajout des deux champs aux objets attendus.
- [ ] **Step 5 : commit** `feat(billing): enregistrer le montant réel des paiements par carte`.

### Task 7 : Journal d'audit et décision sur commande par compte admin

**Files:**
- Modify: `supabase/migrations/013_admin_payments.sql` (deuxième partie)
- Create: `src/lib/admin/audit.ts`, `src/app/api/admin/payments/route.ts`
- Delete: `src/app/api/credits/manual/admin/route.ts`
- Modify: `.env.example` (retirer `ADMIN_PANEL_SECRET` s'il y figure)
- Test: `tests/admin-payments-route.test.js` ; étendre `tests/admin-sql.test.js`

**Interfaces:**
- Consumes: `authorizeAdminRequest`, `getAdminDb` (Task 1).
- Produces:
  - Table `public.admin_audit_log (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), admin_id UUID NOT NULL, action TEXT NOT NULL, target_user_id UUID, details JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT now())`, index `(target_user_id, created_at DESC)`, fermée comme `admin_client_notes`.
  - `type AuditAction = 'payment_granted' | 'payment_refused' | 'credits_adjusted' | 'note_updated'`
  - `writeAudit(db: SupabaseClient, entry: { adminId: string; action: AuditAction; targetUserId: string | null; details: Record<string, unknown> }): Promise<void>` — ne lève jamais ; un échec est journalisé.
  - `POST /api/admin/payments` — corps `{ order_number: string (4–40), decision: 'grant' | 'refuse', payment_reference?: string (≤120), operator_note?: string (≤500) }`. Même logique que la route supprimée (prise conditionnelle sur `status='pending'`, `add_credits` avec la clé `manual:<id>`, retour à `pending` si le crédit échoue), avec trois différences : autorisation par `authorizeAdminRequest` ; `decided_by` = identifiant de l'admin ; après un crédit réussi, écriture de `amount_paid = amount_mad`, `currency = 'MAD'` sur la ligne du grand livre et appel à `writeAudit`. Réponses inchangées : `200 { success, status }`, `409 NOT_PENDING`, `400 INVALID_DATA`, `500 GRANT_FAILED`.

- [ ] **Step 1 : écrire les tests qui échouent.**

```js
test('refuse un appelant non admin sans toucher à la base', async () => {
  state.user = { id: OTHER };
  const res = await POST(req({ order_number: 'QIA-20261112-AB23', decision: 'grant' }));
  assert.equal(res.status, 401);
  assert.equal(state.fromCalls.length + state.rpcCalls.length, 0);
});
test('l\'ancien code secret n\'ouvre plus rien', async () => {
  state.user = null;
  const res = await POST(req(body, { authorization: 'Bearer ' + 'x'.repeat(32) }));
  assert.equal(res.status, 401);
});
test('valider : crédite avec la clé manual:<id>, renseigne decided_by et écrit l\'audit', async () => {
  // state.claimed = { id: PAY_ID, user_id: CLIENT, pack_id: 'standard', credits: 80, amount_mad: 100 }
  const res = await POST(req({ order_number: 'QIA-20261112-AB23', decision: 'grant' }));
  assert.equal((await res.json()).status, 'granted');
  assert.equal(rpc('add_credits').args.p_stripe_payment_id, `manual:${PAY_ID}`);
  assert.equal(firstUpdate('manual_payments').decided_by, ADMIN);
  assert.deepEqual(audit()[0].action, 'payment_granted');
});
test('commande déjà traitée : 409, aucun crédit', async () => { /* state.claimed = null */ });
test('crédit refusé par la base : la commande revient à pending, réponse 500', async () => { /* rpcResult error */ });
test('refuser : aucun appel à add_credits, audit payment_refused', async () => {});
```

Dans `tests/admin-sql.test.js`, ajouter pour `013` les mêmes assertions de fermeture que la Task 3 sur `public.admin_audit_log`, et vérifier que `credit_transactions` reste sans `INSERT`/`UPDATE`/`DELETE` pour `anon` et `authenticated` après 013 (rejouer 001, 004, 005, 013 dans l'ordre).

- [ ] **Step 2 : lancer** `node --test tests/admin-payments-route.test.js tests/admin-sql.test.js` — attendu : échec.
- [ ] **Step 3 : implémenter** ; supprimer l'ancienne route ; `grep -rn "ADMIN_PANEL_SECRET\|credits/manual/admin" src tests e2e` ne doit plus rien renvoyer hors de `admin/page.tsx`, remplacée à la Task 9.
- [ ] **Step 4 : relancer** — attendu : tout passe.
- [ ] **Step 5 : commit** `feat(admin): décision sur commande par compte admin, journal d'audit`.

### Task 8 : Page Paiements

**Files:**
- Create: `src/lib/admin/payments.ts`, `src/app/(site)/admin/(secure)/paiements/page.tsx`, `src/app/(site)/admin/(secure)/paiements/PaymentActions.tsx`
- Test: `tests/admin-payments.test.js`

**Interfaces:**
- Consumes: `classifyLedgerEntry`, `LEDGER_KEY_PREFIXES` (Task 2) ; `CREDIT_PACKS`, `isPackId` de `@/lib/billing/catalog` ; `POST /api/admin/payments` (Task 7).
- Produces:
  - `interface PaymentView { id: string; source: 'manual' | 'creem' | 'stripe'; userId: string; email: string | null; packId: string | null; credits: number; amount: number | null; currency: string | null; amountIsEstimate: boolean; status: 'pending' | 'paid' | 'granted' | 'refused' | 'expired'; orderNumber: string | null; method: string | null; reference: string | null; createdAt: string; decidedAt: string | null }`
  - `toManualPaymentView(row): PaymentView` et `toCardPaymentView(row: LedgerRow & { user_id: string }): PaymentView | null` — `null` si la ligne n'est pas un paiement par carte. Montant d'une ligne carte : `amount_paid`/`currency` s'ils existent ; sinon le prix catalogue du pack (`priceUSD` pour Creem, `priceMAD` pour Stripe) avec `amountIsEstimate: true` ; pack inconnu : `amount: null`.
  - `parsePaymentFilters(searchParams): { source: 'all' | 'manual' | 'card'; status: 'pending' | 'granted' | 'refused' | 'all'; search: string }` — défaut `source: 'all'`, `status: 'pending'`.
  - `listPayments(db, filters): Promise<{ status: 'ok'; payments: PaymentView[] } | { status: 'error' }>` — 200 commandes manuelles et 200 lignes carte au plus (`stripe_payment_id` `like 'creem:%'` ou `like 'cs:%'`), fusionnées par date décroissante ; emails résolus depuis `profiles` en une seule requête `in('id', …)` ; le filtre `status` autre que `granted`/`all` exclut les paiements par carte ; la recherche porte sur numéro de commande, email, référence, identifiant.
  - `<PaymentActions orderNumber="…" />` (composant client) : boutons « Valider — créditer » et « Refuser », champ facultatif « Référence du paiement », appel à `POST /api/admin/payments`, puis `router.refresh()`. Erreur 409 : « Déjà traitée », puis rafraîchissement.

- [ ] **Step 1 : écrire les tests qui échouent.**

```js
test('paiement Creem avec montant enregistré : montant exact', () => {
  const v = toCardPaymentView(ledger({ stripe_payment_id: 'creem:tran_1', reason: 'starter', amount: 30, amount_paid: 4.99, currency: 'USD' }));
  assert.deepEqual([v.source, v.amount, v.currency, v.amountIsEstimate, v.status], ['creem', 4.99, 'USD', false, 'granted']);
});
test('paiement Creem sans montant : prix catalogue marqué comme estimation', () => {
  const v = toCardPaymentView(ledger({ stripe_payment_id: 'creem:tran_2', reason: 'standard', amount: 80 }));
  assert.deepEqual([v.amount, v.currency, v.amountIsEstimate], [CREDIT_PACKS.standard.priceUSD, 'USD', true]);
});
test('pack inconnu : montant nul plutôt qu\'inventé', () => {
  assert.equal(toCardPaymentView(ledger({ stripe_payment_id: 'cs:cs_9', reason: 'unlimited', amount: 999 })).amount, null);
});
test('un remboursement ou une commande manuelle n\'est pas un paiement par carte', () => {
  assert.equal(toCardPaymentView(ledger({ stripe_payment_id: 'optimize_refund_1', reason: 'refund' })), null);
  assert.equal(toCardPaymentView(ledger({ stripe_payment_id: 'manual:abc' })), null);
});
test('le filtre « en attente » ne montre que des commandes manuelles', async () => {
  const r = await listPayments(db, { source: 'all', status: 'pending', search: '' });
  assert.ok(r.payments.every((p) => p.source === 'manual' && p.status === 'pending'));
});
test('fusion triée par date décroissante', async () => { /* manuel 10:00, carte 11:00 → carte d'abord */ });
```

- [ ] **Step 2 : lancer** `node --test tests/admin-payments.test.js` — attendu : échec.
- [ ] **Step 3 : implémenter** `payments.ts`, puis la page : filtres en liens (source, statut), recherche, liste reprenant la mise en forme des cartes de l'actuel `admin/page.tsx:356-431` ; chaque paiement porte un lien vers la fiche client ; un montant estimé s'affiche précédé de « ≈ » ; `PaymentActions` n'apparaît que sur une commande manuelle en attente.
- [ ] **Step 4 : relancer** — attendu : tout passe.
- [ ] **Step 5 : commit** `feat(admin): page paiements, manuels et carte`.

### Task 9 : Vue d'ensemble et indicateurs

**Files:**
- Modify: `supabase/migrations/013_admin_payments.sql` (troisième partie), `src/app/(site)/admin/(secure)/AdminNav.tsx`, `src/app/(site)/admin/layout.tsx`
- Create: `src/lib/admin/kpis.ts`, `src/app/(site)/admin/(secure)/page.tsx`
- Delete: `src/app/(site)/admin/page.tsx`
- Test: `tests/admin-kpis.test.js` ; étendre `tests/admin-sql.test.js`, `e2e/admin.spec.ts`

**Interfaces:**
- Produces:
  - Fonction SQL `public.admin_kpis()` → `JSONB`, `STABLE`, fermée comme `admin_client_list`. Les fenêtres « aujourd'hui » et « mois » sont calculées dans le fuseau `Africa/Casablanca`. Clés :

| Clé | Définition |
|---|---|
| `signups` | `{ today, d7, d30, total }` sur `auth.users.created_at` |
| `active` | `{ d7, d30 }` — utilisateurs distincts ayant une transaction `usage` ou un projet dans la fenêtre |
| `paying_clients` | utilisateurs distincts ayant une ligne `manual:`, `creem:` ou `cs:` |
| `revenue_mad` | `{ d30, month, total }` — `manual_payments.amount_mad`, `status='granted'`, daté par `decided_at` |
| `card_payments` | `{ count_d30, count_total, usd_total, without_amount }` — lignes `creem:`/`cs:` ; `usd_total` = somme des `amount_paid` où `currency='USD'` ; `without_amount` = lignes sans `amount_paid` |
| `usage` | `{ scans_d7, scans_d30, optimizations_d30, credits_used_d30 }` |
| `pending_orders` | `{ count, oldest_created_at }` |
| `out_of_credits_never_paid` | utilisateurs à solde nul sans aucun paiement |
| `monthly` | 6 derniers mois, du plus ancien au plus récent : `[{ month: 'YYYY-MM', signups, revenue_mad, scans }]` |

  - `interface Kpis` (camelCase des clés ci-dessus), `parseKpis(raw: unknown): Kpis | null` (zod ; toute forme inattendue donne `null`), `getKpis(db): Promise<{ status: 'ok'; kpis: Kpis } | { status: 'migration_missing' } | { status: 'error' }>`, `conversionRate(kpis: Kpis): number | null` (`payingClients / signups.total`, `null` si aucun inscrit).

- [ ] **Step 1 : écrire les tests qui échouent.**

```js
test('parseKpis accepte la forme renvoyée par admin_kpis', () => {
  assert.equal(parseKpis(SAMPLE).signups.total, 120);
  assert.equal(parseKpis(SAMPLE).monthly.length, 6);
});
test('parseKpis rejette une forme inattendue au lieu de lever', () => {
  for (const bad of [null, [], 'x', { signups: {} }, { ...SAMPLE, monthly: 'non' }]) assert.equal(parseKpis(bad), null);
});
test('conversionRate : aucun inscrit donne null, pas NaN', () => {
  assert.equal(conversionRate({ ...parseKpis(SAMPLE), signups: { today: 0, d7: 0, d30: 0, total: 0 } }), null);
  assert.equal(conversionRate(parseKpis(SAMPLE)), 0.1); // 12 payants sur 120
});
test('getKpis : fonction absente donne migration_missing', async () => { /* PGRST202 */ });
```

Dans `tests/admin-sql.test.js` : `admin_kpis` est `SECURITY DEFINER`, `search_path` figé, réservée à `service_role`, et le texte contient `'Africa/Casablanca'`. Dans `e2e/admin.spec.ts` : `/admin` et `/admin/paiements`, sans session, redirigent vers la connexion.

- [ ] **Step 2 : lancer** `node --test tests/admin-kpis.test.js tests/admin-sql.test.js` — attendu : échec.
- [ ] **Step 3 : implémenter** la fonction SQL et `kpis.ts`.
- [ ] **Step 4 : écrire la vue d'ensemble** `(secure)/page.tsx` et supprimer `admin/page.tsx`. Contenu : un encart « N commandes en attente, la plus ancienne depuis X » lié à `/admin/paiements?status=pending` (masqué à zéro) ; tuiles : inscrits (total, 7 j, 30 j), actifs (7 j, 30 j), clients payants et taux de conversion, revenu manuel (mois, 30 j, total), paiements carte (30 j, total, total USD, « dont N sans montant enregistré » si > 0), analyses (7 j, 30 j), crédits consommés (30 j) ; un lien « Clients à solde nul, dont N n'ont jamais payé » vers `/admin/clients?segment=out_of_credits` ; un tableau des six derniers mois. `migration_missing` → `<MigrationBanner migration="013" />`. Activer les trois liens d'`AdminNav`. `admin/layout.tsx` ne garde que les métadonnées `noindex`.
- [ ] **Step 5 : relancer** les tests de l'étape 2 et `npx playwright test e2e/admin.spec.ts` — attendu : tout passe.
- [ ] **Step 6 : vérifier sur une vraie base.** Le propriétaire applique 013 puis exécute `SELECT public.admin_kpis();`. Comparer `signups.total`, `revenue_mad.total` et `pending_orders.count` avec trois requêtes `count`/`sum` directes sur `auth.users` et `manual_payments`.
- [ ] **Step 7 : vérifier à la main** en local : créer une commande manuelle avec un compte de test, la voir dans l'encart et dans Paiements, la valider, constater le solde crédité, le statut « Crédits ajoutés », la ligne d'audit et le montant en MAD dans les mouvements de la fiche. Refuser une seconde commande. Cliquer deux fois vite sur « Valider » : un seul crédit.
- [ ] **Step 8 : contrôles complets** (comme Task 5, étape 8), commit `feat(admin): vue d'ensemble et indicateurs`, push, PR. Le corps de la PR rappelle : migration 013 appliquée avant fusion ; après déploiement, supprimer `ADMIN_PANEL_SECRET` de Vercel.

---

# Lot 3 — Actions sur un client (PR 3)

Branche : `feat/admin-actions`, depuis `main` après fusion de la PR 2.

### Task 10 : Ajuster les crédits d'un client

**Files:**
- Create: `supabase/migrations/014_admin_actions.sql`, `src/app/api/admin/clients/[id]/credits/route.ts`, `src/app/(site)/admin/(secure)/clients/[id]/ClientActions.tsx`
- Modify: `src/app/(site)/admin/(secure)/clients/[id]/page.tsx`
- Test: `tests/admin-credits-route.test.js` ; étendre `tests/admin-sql.test.js`

**Interfaces:**
- Consumes: `authorizeAdminRequest`, `getAdminDb` (Task 1) ; `writeAudit` (Task 7) ; `LEDGER_KEY_PREFIXES.admin` (Task 2).
- Produces:
  - Fonction SQL `public.admin_adjust_credits(p_user_id UUID, p_delta INT, p_request_id TEXT) RETURNS JSONB`, fermée comme les autres. Comportement, dans l'ordre : `p_delta` nul, égal à 0 ou hors de −1000…1000 → `{ success: false, error: 'INVALID_DELTA' }` ; `p_request_id` vide → `MISSING_REQUEST_ID` ; verrou `FOR UPDATE` sur la ligne `profiles` ; profil absent → `PROFILE_NOT_FOUND` ; `solde + p_delta < 0` → `{ success: false, error: 'INSUFFICIENT_CREDITS', balance }` ; insertion dans `credit_transactions` (`type='adjustment'`, `amount=p_delta`, `balance_after`, `description='Ajustement QatliA'`, `reason='admin_adjustment'`, `stripe_payment_id='admin:' || p_request_id`) avec `ON CONFLICT (stripe_payment_id) WHERE stripe_payment_id IS NOT NULL DO NOTHING` ; conflit → `{ success: true, duplicate: true, balance }` sans toucher au solde ; sinon mise à jour du solde et `{ success: true, duplicate: false, balance }`.
  - `POST /api/admin/clients/[id]/credits` — corps `{ delta: entier, −1000…1000, ≠ 0 ; reason: string 3–500 ; requestId: UUID }`. `404 NOT_FOUND` si `id` n'est pas un UUID ; `400 INVALID_DATA` ; `409 INSUFFICIENT_CREDITS` avec `balance` ; `200 { success: true, balance, duplicate }`. Le motif saisi va dans le journal d'audit (`details: { delta, reason, balance }`), jamais dans `credit_transactions`, que le client peut lire. L'audit n'est écrit que si `duplicate` est faux.
  - `<ClientActions userId balance />` : formulaire « Ajuster les crédits » (sens ajouter/retirer, quantité, motif obligatoire). Le `requestId` est créé par `crypto.randomUUID()` à l'ouverture du formulaire et réutilisé à chaque nouvel essai de la même saisie ; il est renouvelé après un succès. Bouton désactivé pendant l'envoi. Un retrait demande une confirmation dans la page (second clic sur « Confirmer le retrait »), sans boîte de dialogue du navigateur.

- [ ] **Step 1 : écrire les tests qui échouent.**

```js
test('non admin : 401 et aucun appel à la base', async () => {});
test('identifiant client invalide : 404', async () => {});
for (const bad of [{ delta: 0 }, { delta: 1001 }, { delta: 1.5 }, { delta: '5' }, { reason: 'ab' }, { requestId: 'x' }]) {
  test(`corps invalide ${JSON.stringify(bad)} : 400 sans appel à la base`, async () => {
    const res = await POST(req({ ...VALID, ...bad }), ctx(CLIENT));
    assert.equal(res.status, 400);
    assert.equal(state.rpcCalls.length, 0);
  });
}
test('ajout : appelle admin_adjust_credits avec le requestId et écrit l\'audit avec le motif', async () => {
  const res = await POST(req({ delta: 20, reason: 'Geste commercial', requestId: REQ }), ctx(CLIENT));
  assert.deepEqual(state.rpcCalls[0], { name: 'admin_adjust_credits', args: { p_user_id: CLIENT, p_delta: 20, p_request_id: REQ } });
  assert.deepEqual(audit()[0].details, { delta: 20, reason: 'Geste commercial', balance: 45 });
});
test('même requestId rejoué : succès, duplicate, aucun second audit', async () => {
  state.rpcResult = { data: { success: true, duplicate: true, balance: 45 }, error: null };
  const res = await POST(req(VALID), ctx(CLIENT));
  assert.equal((await res.json()).duplicate, true);
  assert.equal(audit().length, 0);
});
test('retrait supérieur au solde : 409 avec le solde, aucun audit', async () => {
  state.rpcResult = { data: { success: false, error: 'INSUFFICIENT_CREDITS', balance: 3 }, error: null };
  const res = await POST(req({ ...VALID, delta: -10 }), ctx(CLIENT));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).balance, 3);
});
```

Dans `tests/admin-sql.test.js`, pour `014` : fermeture de `admin_adjust_credits(UUID, INT, TEXT)` ; le corps contient `FOR UPDATE`, `'admin:'`, `ON CONFLICT (stripe_payment_id)` et `'INSUFFICIENT_CREDITS'` ; aucune fonction existante n'est redéfinie.

- [ ] **Step 2 : lancer** `node --test tests/admin-credits-route.test.js tests/admin-sql.test.js` — attendu : échec.
- [ ] **Step 3 : implémenter** la migration, la route et le formulaire.
- [ ] **Step 4 : relancer** — attendu : tout passe.
- [ ] **Step 5 : vérifier sur une vraie base** (compte de test, après application de 014) : `SELECT public.admin_adjust_credits('<id>', 5, 'test-1');` deux fois — la seconde renvoie `duplicate: true` et le solde n'a monté que de 5 ; `SELECT public.admin_adjust_credits('<id>', -100000, 'test-2');` renvoie `INVALID_DELTA` ; un retrait supérieur au solde renvoie `INSUFFICIENT_CREDITS`. Vérifier dans `/account` que le client lit « Ajustement QatliA ».
- [ ] **Step 6 : commit** `feat(admin): ajustement des crédits d'un client`.

### Task 11 : Note, téléphone, étiquettes et historique des actions

**Files:**
- Create: `src/app/api/admin/clients/[id]/note/route.ts`
- Modify: `src/lib/admin/clients.ts` (`ClientDetail` gagne `audit`), `src/app/(site)/admin/(secure)/clients/[id]/ClientActions.tsx`, `src/app/(site)/admin/(secure)/clients/[id]/page.tsx`
- Test: `tests/admin-note-route.test.js` ; étendre `tests/admin-clients.test.js`

**Interfaces:**
- Consumes: table `admin_client_notes` (Task 3), `admin_audit_log` et `writeAudit` (Task 7).
- Produces:
  - `PUT /api/admin/clients/[id]/note` — corps `{ phone: string | null (≤ 30, uniquement chiffres, espaces, `+`, `-`, parenthèses), tags: string[] (≤ 10, chacune 1–30 caractères, rognée, sans doublon), note: string | null (≤ 2000) }`. `404` si `id` n'est pas un UUID ou si l'utilisateur n'existe pas ; `upsert` sur `user_id` avec `updated_by` et `updated_at` ; audit `note_updated` avec `details: { fields: [...] }` (noms des champs modifiés, pas leur contenu) ; `200 { success: true }`.
  - `ClientDetail.audit: { action: AuditAction; details: Record<string, unknown>; createdAt: string; adminId: string }[]` — 50 dernières lignes d'`admin_audit_log` pour ce client ; table absente → `[]`.
  - Fiche : la section **Note** devient un formulaire (téléphone, étiquettes séparées par des virgules, note) ; nouvelle section **Actions admin** (date, action, détail).

- [ ] **Step 1 : écrire les tests qui échouent.**

```js
test('non admin : 401', async () => {});
test('utilisateur inexistant : 404, aucune écriture', async () => {});
test('téléphone avec des lettres, 11 étiquettes ou note de 2001 caractères : 400', async () => {});
test('enregistre en normalisant les étiquettes', async () => {
  await PUT(req({ phone: '+212 6 12 34 56 78', tags: [' Atelier ', 'atelier', 'VIP', ''], note: 'Rappeler lundi' }), ctx(CLIENT));
  const row = upserts('admin_client_notes')[0];
  assert.deepEqual([row.user_id, row.tags, row.updated_by], [CLIENT, ['Atelier', 'atelier', 'VIP'], ADMIN]);
});
test('l\'audit nomme les champs modifiés sans recopier la note', async () => {
  assert.deepEqual(audit()[0].details, { fields: ['phone', 'tags', 'note'] });
});
test('getClientDetail renvoie les 50 dernières actions, [] si la table manque', async () => {});
```

- [ ] **Step 2 : lancer** `node --test tests/admin-note-route.test.js tests/admin-clients.test.js` — attendu : échec.
- [ ] **Step 3 : implémenter.**
- [ ] **Step 4 : relancer** — attendu : tout passe.
- [ ] **Step 5 : vérifier à la main** en local : saisir téléphone, deux étiquettes et une note sur un client ; retrouver le client par son téléphone dans la recherche de `/admin/clients` ; ajouter puis retirer des crédits ; lire les trois actions dans **Actions admin**.
- [ ] **Step 6 : contrôles complets**, commit `feat(admin): note, téléphone et étiquettes par client`, push, PR. Prérequis de fusion : migration 014 appliquée.
