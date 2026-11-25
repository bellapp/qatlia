# Admin : fiche client pour comprendre un problème — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** page projet, dernières activités, tri par en-tête et recherche par téléphone dans l'admin.

**Architecture:** modules purs dans `src/lib/admin/` (testés avec `node --test` et `loadTsModule`), lectures serveur avec le client service role, pages serveur Next 14. Le tri des tableaux déjà chargés se fait dans un composant client générique ; la liste paginée des clients trie en SQL (migration 021).

**Tech Stack:** Next.js 14 (App Router), Supabase JS, PostgreSQL, Tailwind, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-25-admin-fiche-client-design.md`

## Global Constraints

- Interface en français ; dates en heure de Casablanca (`src/lib/admin/format.ts`).
- `admin_client_list` garde la signature `(TEXT, TEXT, TEXT, INT, INT)` ; les six tris existants restent valides.
- Rien ne casse avant 021 : tri inconnu → inscription récente, colonnes téléphone vides.
- Jamais le contenu de `options_json.quotation`.
- Un chemin de scan n'est signé que si `isOwnScanPath(path, ownerId)` ; lien de 300 s, `force-dynamic`.

## Review Focus

- `options_json` malformé (pas de `result`, `pieces` non tableau, nombres en texte) → la page projet s'affiche quand même.
- Projet d'un autre client dans l'URL → 404.
- Recherche `0612345678` / `+212 612-34-56-78` / `00212612345678` → même compte ; `ali` ou `12` ne déclenchent pas la recherche téléphone.
- Changer de tri après une recherche garde la recherche et le segment, revient page 1.
- Valeurs nulles triées en dernier dans les deux sens.

---

### Task 1: lecture d'un projet (`src/lib/admin/project-detail.ts`)

**Files:** Create `src/lib/admin/project-detail.ts`, Test `tests/admin-project-detail.test.js`, Modify `tests/helpers/fake-supabase.js` (storage `createSignedUrl`).

**Interfaces — Produces:**
- `readProjectDetail(row: ProjectRow): ProjectDetail` (pur) : `{ id, name, createdAt, material, pdfGeneratedAt, hasQuotation, scans: {thumb: string|null, path: string|null}[], pieces: {name, width, height, quantity, scanIndex: number|null, edges: string, grain}[], sheet: {width, height, kerf, margin, label}|null, options: {kerf, priority}|null, result: {sheetsUsed, wastePercentage, sheets: {index, width, height, label, wasteRate, pieces: {x,y,width,height,name,rotated}[]}[], unplaced: {name, width, height, reason}[]}|null }`.
- `getClientProject(db, userId, projectId): Promise<{status:'ok', project: ProjectDetail, scanUrls: (string|null)[]} | {status:'not_found'} | {status:'error'}>` — requête `.eq('id').eq('user_id')`, signe chaque chemin qui passe `isOwnScanPath`.

- [ ] Tests : `readProjectDetail` sur un projet complet (pièces avec fiche 1/2 et une ajoutée à la main, 2 panneaux, 1 non placée « oversize ») ; sur `options_json` = `null`, `"x"`, `{result: 3}` → pas d'exception, `result: null`, `pieces: []` ; `hasQuotation` vrai sans exposer la devis. `getClientProject` : identifiant non UUID → `not_found` ; ligne absente → `not_found` ; chemin d'un autre utilisateur → `scanUrls[0] === null` et aucun appel `createSignedUrl` ; chemin du client → URL signée, 300 s.
- [ ] Implémenter, tests verts, commit.

### Task 2: page projet + lien depuis la fiche

**Files:** Create `src/app/(site)/admin/(secure)/clients/[id]/projets/[projectId]/page.tsx`, `src/app/(site)/admin/(secure)/PlanSheet.tsx` (SVG serveur d'un panneau, 40 pièces étiquetées max, 12 panneaux max) ; Modify `clients/[id]/page.tsx` (nom du projet → lien).

- [ ] Page : photo(s) (URL signée sinon vignette « réduite »), tableau des pièces (tri client, Task 4), résultat, dessins, réglages. `notFound()` sur `not_found`.
- [ ] `tsc` vert, commit.

### Task 3: dernières activités (`src/lib/admin/timeline.ts`)

**Interfaces — Produces:** `buildClientTimeline(input: { identity: Pick<ClientIdentity,'signedUpAt'|'lastSignInAt'>; ledger: LedgerRow[]; orders: ManualOrderRow[]; projects: ProjectSummary[]; audit: ClientAuditEntry[] }, limit = 100): TimelineEvent[]` avec `TimelineEvent = { at: string; kind: 'signup'|'last_sign_in'|'ledger'|'project'|'pdf'|'order_created'|'order_decided'|'admin'; label: string; detail: string|null; projectId: string|null; amount: number|null }`, trié du plus récent au plus ancien, dates invalides écartées.

- [ ] Tests : ordre décroissant mêlant les sources ; plafond `limit` ; projet → `projectId` ; PDF → événement séparé ; commande décidée → deux événements ; dernière connexion unique.
- [ ] Section « Dernières activités » sur la fiche client, commit.

### Task 4: tri par en-tête

**Files:** Create `src/app/(site)/admin/(secure)/SortableTable.tsx` (client) et `src/lib/admin/sort.ts` (pur) ; Modify pages clients, fiche client, paiements, `src/lib/admin/clients.ts`, `src/lib/admin/payments.ts`.

**Interfaces — Produces:**
- `compareSortValues(a: SortValue, b: SortValue, dir: 'asc'|'desc'): number` (`SortValue = string|number|null`, nulls toujours en dernier).
- `<SortableTable columns={{label, align?, sortable?}[]} rows={{key, cells: ReactNode[], sort: SortValue[]}[]} initial={{col, dir}} empty={ReactNode} minWidth? />`.
- `CLIENT_SORTS` = anciens + `created_asc, last_activity_asc, credits_*, scans_asc, paid_asc, purchases_asc|desc, projects_asc|desc, email_asc|desc`.
- `PaymentFilters.sort: 'date_desc'|'date_asc'|'amount_desc'|'amount_asc'|'credits_desc'|'credits_asc'`.

- [ ] Tests : `compareSortValues` (nombres, textes fr, nulls derniers dans les deux sens) ; `parseClientListParams` accepte les nouveaux tris ; `parsePaymentFilters` défaut `date_desc` ; `listPayments` trie par montant.
- [ ] En-têtes cliquables (liste clients : liens, `sort` en champ caché du formulaire, page 1) ; fiche client (commandes, mouvements, projets) et page projet via `SortableTable` ; paiements : liens de tri. Commit.

### Task 5: téléphones + migration 021

**Files:** Create `supabase/migrations/021_admin_client_phones.sql` ; Modify `src/lib/admin/clients.ts`, pages clients et fiche, `tests/admin-sql.test.js`, `tests/admin-clients.test.js`.

- [ ] SQL : `DROP FUNCTION IF EXISTS` puis `CREATE OR REPLACE FUNCTION public.admin_client_list(...)` même signature, colonnes en plus `whatsapp TEXT, atelier_phone TEXT` ; CTE téléphone via `raw_user_meta_data->>'whatsapp_code'` → `whatsapp_photo_reads.code` et `ateliers.user_id` ; recherche téléphone si le terme n'a que chiffres/espaces/`+().-`, on retire `00`, `212` ou `0` en tête, au moins 6 chiffres restants, comparé par `LIKE '%'||core||'%'` sur les chiffres de chaque numéro ; un `CASE` par tri ; `REVOKE`/`GRANT` refaits.
- [ ] Tests SQL : service role seulement, `LANGUAGE sql`, chaque tri de `CLIENT_SORTS` a son `CASE`, la normalisation retire `00|212|0`. Tests TS : `whatsapp`/`atelierPhone` lus, `null` si absents (avant 021) ; fiche client lit `ateliers.phone`, dégradée si erreur.
- [ ] Colonne « Téléphone » : chaque numéro avec son origine ; fiche : « Téléphone entreprise ». Commit.

### Task 6: vérification et PR

- [ ] `npm run test:node` (comparer aux 10 échecs CRLF de main), `npx tsc --noEmit`, `npm run lint`.
- [ ] PR vers `main`, migration 021 signalée.
