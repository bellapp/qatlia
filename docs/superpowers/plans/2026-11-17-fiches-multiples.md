# Jusqu'à 4 fiches par projet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un projet reçoit jusqu'à 4 photos de fiches ; leurs pièces se fondent en une liste et un plan ; le projet coûte 1 crédit.

**Architecture:** Un « groupe de lectures » gardé en base (`scan_groups`) compte les lectures comprises après une lecture payée ; `/api/vision` le consulte et l'incrémente. Côté atelier, un module pur `src/lib/projects/scan-sheets.ts` tient la liste des fiches (ajout, retrait, renumérotation, lecture des anciens formats, budget des vignettes) ; `options_json.scans` remplace `scanThumb`/`scanPath`.

**Tech Stack:** Next.js 14.2 App Router, React 18, Supabase (RPC, Storage), zod, tests `node:test` (`tests/helpers/load-ts-module.js`, `tests/helpers/stub-module.js`, `tests/helpers/sql-inspect.js`).

**Spec:** `docs/superpowers/specs/2026-11-17-fiches-multiples-design.md`

## Global Constraints

- Production en ligne : une PR par lot, jamais de push sur `main`. PR 2 sur la branche de la PR 1, PR 3 sur celle de la PR 2 (`delete_branch_on_merge` est faux sur le dépôt : chaque PR empilée dit dans sa description qu'elle est à rebaser sur `main` après la précédente).
- Avant chaque PR : `npx tsc --noEmit` sans erreur, `npm run test:node` sans nouvel échec par rapport à la base (10 échecs de fins de ligne sur `main`).
- `MAX_SCANS_PER_ANALYSIS = 4` et `ANALYSIS_WINDOW_HOURS = 24` dans `src/lib/billing/policy.ts` ; la migration écrit 4 et 24 h en dur, un test les relie.
- Aucun nouveau code d'erreur dans `/api/vision` (chaque code demande FR/EN/AR, `tests/i18n-workshop-catalog.test.js`).
- Toute erreur des fonctions de groupe = « pas de groupe », jamais un 503. Le code tourne en production avant la migration.
- Rien de ce que le client envoie n'entre brut dans `options_json`.
- Tout nouveau texte en français, anglais et arabe ; pas de pourcentage écrit dans une chaîne de `src/` (`tests/claims-audit.test.js`).
- Commits en français `feat(fiches): …`.

## Review Focus

1. Deux lectures en course sur un groupe à 3 : une seule comprise (→ Task 1, la réclamation est une seule instruction SQL conditionnelle ; Task 2 teste le repli payé quand la réclamation échoue).
2. Fonctions SQL absentes en production : chaque fiche payée comme aujourd'hui, sans erreur (→ Task 2, test « missing function »).
3. Import de plusieurs photos : lues l'une après l'autre, chacune avec le groupe rendu par la précédente (→ Task 6, `readSheetsInOrder`).
4. Projet ancien (`scanThumb`/`scanPath`) : relu comme une fiche, ré-enregistré au nouveau format sans perdre son image (→ Task 3, `readScanSheets`).
5. Retrait d'une fiche du milieu : pièces retirées, suivantes renumérotées, pièces manuelles intactes (→ Task 3, `removeScanSheet`).

---

# PR 1 — Décompte côté serveur

### Task 1: Migration 018 et constante

**Files:** Create `supabase/migrations/018_scan_groups.sql`, `tests/scan-groups-sql.test.js`. Modify `src/lib/billing/policy.ts`.

- [ ] Test : table créée `IF NOT EXISTS`, RLS active, aucune politique, aucun droit pour `anon`/`authenticated` ; les trois fonctions `open_scan_group(UUID)`, `scan_group_has_room(UUID, UUID)`, `claim_scan_read(UUID, UUID)` en `CREATE OR REPLACE`, `SECURITY DEFINER`, exécution révoquée à `PUBLIC, anon, authenticated` et accordée à `service_role` ; `reads_used < 4` et `interval '24 hours'` égaux à `MAX_SCANS_PER_ANALYSIS` et `ANALYSIS_WINDOW_HOURS` ; `claim_scan_read` est un `UPDATE … RETURNING`.
- [ ] Implémenter. `claim_scan_read` renvoie le nouveau `reads_used` (NULL si rien n'a été mis à jour).
- [ ] Commit.

### Task 2: `/api/vision` lit et consomme le groupe

**Files:** Create `src/lib/billing/scan-group.ts`. Modify `src/app/api/vision/route.ts`. Test : `tests/credits-routes.test.js` (section Vision).

**Interfaces — Produces:**
- `scanGroupHasRoom(admin, userId: string, groupId: string): Promise<boolean>`
- `claimScanRead(admin, userId: string, groupId: string): Promise<number | null>` (lectures utilisées après la réclamation)
- `openScanGroup(admin, userId: string): Promise<string | null>`
- Corps de `/api/vision` : `scanGroup?: unknown` (pris seulement si UUID). Réponse : `scanGroup?: string`, `scansLeft?: number`, `creditsCharged` 0 ou 1.

- [ ] Tests : (a) payée → `consume_credit` une fois, `open_scan_group` appelé, `scanGroup` et `scansLeft: 3` rendus ; (b) groupe avec place, solde 0 → 200, pas de `consume_credit`, pas d'`ensure_profile`, `creditsCharged: 0`, pas d'`analysisPass`, `scansLeft` = 4 − lectures ; (c) réclamation perdue (`claim_scan_read` → null) → repli payé ; (d) groupe plein → contrôle du solde et débit ; (e) identifiant non UUID → ignoré, payé ; (f) les trois RPC en erreur « could not find the function » → payé, 200, pas de `scanGroup` ; (g) lecture illisible sur groupe → rien consommé.
- [ ] Implémenter. Erreur RPC ⇒ `false` / `null`, journalisée.
- [ ] Commit, PR 1.

# PR 2 — Atelier à plusieurs fiches

### Task 3: Module pur des fiches

**Files:** Create `src/lib/projects/scan-sheets.ts`, `tests/scan-sheets.test.js`. Modify `src/lib/billing/policy.ts` (rien), `src/lib/projects/history-metadata.ts`.

**Interfaces — Produces:**
- `type ScanSheet = { thumb?: string; path?: string }`
- `readScanSheets(options: unknown): ScanSheet[]` — `scans` validé (≤ 4), sinon `scanThumb`/`scanPath` comme une fiche, sinon `[]`.
- `appendSheetPieces(pieces: Piece[], read: Piece[], sheetCount: number): Piece[]` — 1ʳᵉ fiche : remplace ; suivantes : ajoute à la fin. Chaque pièce lue reçoit `scanIndex` (1 à 4).
- `removeScanSheet(pieces: Piece[], index: number): Piece[]` — retire les pièces `scanIndex === index`, décrémente celles au-dessus, laisse les pièces sans `scanIndex`.
- `thumbBudgetFor(count: number): number` = `Math.floor(SCAN_THUMB_MAX_CHARS / max(1, count))`.
- `sanitizeScanSheets(value: unknown, ownerId?: string): ScanSheet[] | undefined` — ≤ 4 entrées ; vignette par `sanitizeScanThumb`, somme ≤ `SCAN_THUMB_MAX_CHARS` (une vignette qui dépasse est écartée, l'entrée reste) ; chemin par `isOwnScanPath`.
- `pickProjectHistoryMetadata` garde `scans` et `scanGroup` (UUID).

- [ ] Tests, implémentation, commit.

### Task 4: Enregistrement et relecture

**Files:** Modify `src/lib/projects/persistence-payload.ts`, `src/lib/projects/history-row.ts`, `src/lib/admin/projects.ts`, `src/app/api/projects/[id]/scan/route.ts` (lit la fiche 1 via `readScanSheets`).

- Payload : `scans?: ScanSheet[]`, `scanGroup?: string` ; plus de `scanThumb`/`scanPath` écrits.
- `HistoryRow` : `scanThumb` = vignette de la fiche 1, `hasFullScan` = fiche 1 a un chemin, `scanCount: number`.
- Admin : `scanThumbs: string[]` (garde `scanThumb` = la première).
- [ ] Tests (mise à jour de `project-history-persistence`, `history-row`, `admin-projects`), commit.

### Task 5: Composant de la zone de scan

**Files:** Create `src/components/ScanSheets.tsx` ; test de rendu serveur `tests/scan-sheets-view.test.js`.
- Props : `sheets: { src: string; pieceCount: number }[]`, `max: number`, `busy`, `onOpen(index)`, `onRemove(index)`. Compteur « n / 4 », vignettes, ✕ avec confirmation en deux temps (pas de `window.confirm`), message à 4/4.
- [ ] Test : rend le compteur, une vignette par fiche, le message plein à 4 ; rien quand `sheets` est vide.

### Task 6: Atelier

**Files:** Modify `src/app/(site)/atelier/page.tsx`, `src/i18n/messages/{fr,en,ar}.ts`, `src/components/PiecesManager.tsx` (marque F1–F4), `src/lib/billing/policy.ts` (rien), `legal/*`, `src/lib/whatsapp/copy.ts`, `assistant.ts`.
- État : `scanSheets: { image?: string; thumb?: string; path?: string }[]`, `scanGroup: string | null`.
- `runScan` envoie `scanGroup`, ajoute via `appendSheetPieces`, garde `scanGroup` rendu ; import multiple (`multiple` sur l'entrée galerie) lu en séquence ; à 4 entrées désactivées.
- Nouveau débit / restauration : remplacent `scanSheets` et `scanGroup`.
- Sauvegarde : `scans` (vignettes refaites au budget `thumbBudgetFor(n)`), `scanGroup`.
- [ ] tsc, tests, commit, PR 2.

# PR 3 — Images en grand ×4

### Task 7: Garde des 4 images

**Files:** Modify `src/lib/projects/scan-upload.ts`, `src/app/api/projects/[id]/route.ts`, `src/app/api/projects/[id]/scan/route.ts`, `src/components/ScanViewer.tsx`, historique.
- `ScanKeeper` par position : `newScan(index, image)`, `remove(index)`, `restore(paths: (string | null)[])`, `knownPaths()`, `keepAll(): Promise<(string | null)[]>`.
- `PATCH { scanPaths: (string | null)[] }` : un seul appel, fusion par position dans `options_json.scans` ; l'ancien `{ scanPath }` reste.
- `GET /api/projects/[id]/scan?n=1..4`.
- Visionneuse : flèches entre fiches ; historique : pastille « n fiches ».
- [ ] Tests, commit, PR 3.
