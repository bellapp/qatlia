# Historique des projets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un projet rouvert depuis l'historique revient tel qu'il a été enregistré (plan de coupe, image scannée, nom), sans nouvelle optimisation, et l'historique se lit en cartes ou en tableau, sur téléphone comme sur ordinateur.

**Architecture:** L'enregistrement contient déjà le résultat complet de l'optimisation dans `projects.options_json.result` ; l'atelier ne le relit simplement pas. Le lot 1 le relit, à travers un validateur pur. Le lot 2 sort l'affichage de `history/page.tsx` vers deux vues (cartes, tableau) alimentées par un même résumé de ligne. Le lot 3 garde l'image scannée dans un bucket privé Supabase Storage, servie par URL signée. Le lot 4 allège la liste envoyée au téléphone, s'il se confirme qu'elle est lourde.

**Tech Stack:** Next.js 14.2 (App Router), React 18, Supabase (`@supabase/ssr`, `@supabase/supabase-js`, Storage), zod, Tailwind 3.4, tests `node:test` (`tests/*.test.js`, `tests/helpers/load-ts-module.js`, `tests/helpers/stub-module.js`, `tests/helpers/render-sheet-tabs.js`), specs Playwright (`e2e/`).

**Spec:** aucune. Demande du propriétaire du 2026-11-14, sur un projet de 67 pièces rouvert depuis l'historique : « je ne vois pas l'image déjà utilisée, ni le résultat de coupe déjà obtenu ; quand je renomme je ne sais pas comment sauvegarder ; je dois avoir le lien vers l'image en résolution originale ou optimale, le plan déjà généré pour ne pas le régénérer ; l'historique doit avoir deux modes, carte ou tableau ; n'oublie pas l'affichage mobile ». La section **Décisions de conception** tient lieu de spec.

## Ce qui se passe aujourd'hui (constat)

| Plainte | Cause dans le code |
|---|---|
| Le plan de coupe n'apparaît pas à la réouverture | `atelier/page.tsx` (effet de restauration, vers la ligne 593) relit `sheets`, `pieces`, `options`, `projectName`, `scanThumb`, mais jamais `parsed.result`. Le résultat complet est pourtant enregistré (`buildPersistedProjectPayload`). L'artisan doit relancer l'optimisation. |
| L'image utilisée n'apparaît pas | Seule une miniature de 600 px est gardée (`scanThumb`, dataURL dans `options_json`). À la réouverture elle est remise dans `scanThumb` mais pas dans `previewImage`, le seul état affiché. L'image lisible (1600 px, celle envoyée à la lecture IA) n'est stockée nulle part. |
| Le nom tapé dans l'atelier n'est pas sauvegardé | `commitProjectName` ne fait que `setProjectName`. Le nom ne part vers le serveur qu'à la prochaine optimisation ou au prochain PDF. Aucun message ne le dit. |
| Renommer depuis l'historique ne suit pas | `PATCH /api/projects/[id]` met à jour la colonne `name`, pas `options_json.projectName`, que l'atelier relit. Le crayon est en `opacity-0 group-hover:opacity-100` : invisible au doigt. `RenameSchema` refuse au-delà de 80 caractères alors que le champ en accepte 120. |
| Un seul mode d'affichage | `history/page.tsx` ne rend que des cartes, tout dans un fichier de 467 lignes. |
| Liste lourde | `GET /api/projects` renvoie `options_json` entier de chaque projet (résultat complet + miniature jusqu'à 110 Ko chacun). |

## Décisions de conception

1. **Quatre lots, quatre PR**, chacun livrable seul, dans cet ordre : (1) rouvrir un projet tel quel, (2) cartes ou tableau et téléphone, (3) image du scan lisible, (4) liste légère.
2. **Rouvrir n'optimise pas.** Le plan affiché est celui qui a été enregistré, au mot près, prix compris. Un bandeau le dit, avec la date. Si le résultat enregistré est absent ou illisible, l'atelier s'ouvre comme aujourd'hui, sans plan.
3. **Relancer une optimisation sur un projet rouvert crée toujours une nouvelle entrée**, comme aujourd'hui. Mettre à jour l'entrée existante est hors périmètre (question ouverte n° 1).
4. **Le nom se sauvegarde quand on quitte le champ**, et l'écran le dit : « Nom enregistré », ou « Le nom sera enregistré avec le plan » tant qu'aucun plan n'existe, ou « Nom non enregistré » en cas d'échec. Pas de bouton supplémentaire dans l'atelier.
5. **Un projet renommé est un projet nommé** : le renommage écrit aussi `options_json.projectName`. Limite de nom unique : 120 caractères partout.
6. **Image « optimale », pas l'originale** : on garde la version 1600 px JPEG que l'atelier fabrique déjà pour la lecture IA (quelques centaines de Ko, lisible). La photo d'origine du téléphone (3 à 8 Mo) dépasse la limite d'envoi des routes et multiplierait le stockage par dix (question ouverte n° 2).
7. **Image privée.** Bucket `scans` non public, chemin `{user_id}/{uuid}.jpg`, écrit et lu uniquement par les routes serveur avec la clé de service, après contrôle du propriétaire. Le lien est une URL signée de 5 minutes. Une liste de débit porte souvent le nom d'un client.
8. **Deux modes : cartes (défaut) et tableau.** Le choix est gardé dans `localStorage` (`qatlia_history_view`). Sous 640 px, le mode tableau devient une liste compacte de deux lignes par projet : un vrai tableau de neuf colonnes ne tient pas sur un téléphone.
9. **Tout nouveau texte existe en français, anglais et arabe**, et l'affichage tient en sens droite-à-gauche.
10. **Hors périmètre :** supprimer un projet, trier les colonnes, dupliquer un projet, partager un projet, nettoyer les images orphelines.

## Questions ouvertes pour le propriétaire

1. Relancer l'optimisation d'un projet rouvert : nouvelle entrée (prévu ici) ou mise à jour de l'entrée ?
2. Image : la version 1600 px suffit-elle (prévu ici), ou faut-il la photo d'origine intacte ?
3. Les projets déjà enregistrés n'ont que la miniature 600 px : leur image d'origine n'existe plus. Le visualiseur l'indiquera. D'accord ?

## Global Constraints

- Production en ligne (qatlia.ma) : une PR par lot, jamais de push sur `main`. Le propriétaire fusionne.
- Avant chaque PR : `npx tsc --noEmit` sans erreur et `npm run test:node`. Sur ce poste Windows, 10 tests échouent déjà sur `main` (fins de ligne) : comparer la liste des échecs à celle de `main`, aucun nouveau.
- Travailler dans `.claude/worktrees/<nom>` avec une jonction `node_modules` ; détacher la jonction (`cmd //c rmdir`) avant `git worktree remove`.
- L'application ne démarre pas en local (pas de `.env.local`). Vérifier le rendu en rendant le vrai composant côté serveur (`tests/helpers/render-sheet-tabs.js` montre comment) avec la feuille Tailwind compilée (`npx tailwindcss -i ./src/app/globals.css -o <fichier>`), dans Playwright à 360, 390, 412 et 1280 px. Écrire les specs `e2e/` mais noter dans la PR qu'elles n'ont pas tourné.
- Rien de ce que le client envoie n'entre brut dans `options_json` : tout passe par un validateur de `src/lib/projects/`.
- `tests/claims-audit.test.js` refuse un pourcentage écrit dans une chaîne de `src/` (ex. `'100%'` dans un `calc`) : passer par une constante comme `FULL_WIDTH` dans `atelier/page.tsx`.
- Rouvrir, renommer, voir l'image et télécharger le PDF ne dépensent aucun crédit et n'appellent pas `/api/optimize`.
- Messages de commit en français, style `fix(historique): …` / `feat(historique): …`.

## Review Focus

1. **Résultat enregistré illisible ou d'un ancien format** (résumé `{sheetsUsed, wastePercentage}` seul, pièce sans coordonnées) : l'atelier s'ouvre sans plan, sans erreur. → Tâche 1.
2. **Renommage hors ligne ou refusé** : le nom tapé reste dans le champ, l'écran dit qu'il n'est pas enregistré. → Tâches 4 et 6.
3. **Chemin d'image d'un autre artisan glissé dans la sauvegarde** : ignoré, jamais stocké ni servi. → Tâches 9 et 10.
4. **Nom de 120 caractères, en arabe, sur un écran de 360 px** : tronqué, sans défilement horizontal, dans les deux modes. → Tâche 7.
5. **Projet ancien sans image, sans PDF, sans résultat** : tirets à la place des valeurs, « Ouvrir » fonctionne. → Tâches 5 et 7.

---

# Lot 1 — Rouvrir un projet tel qu'il a été enregistré (PR 1)

Aucune migration. Corrige trois des cinq plaintes.

### Task 1: Valider le résultat enregistré

**Files:**
- Create: `src/lib/projects/restore.ts`
- Test: `tests/project-restore.test.js`

**Interfaces:**
- Produces: `pickRestorableResult(value: unknown): OptimizationResult | null`

- [ ] **Step 1: Write the failing test**

```js
const { loadTsModule } = require('./helpers/load-ts-module');
const restore = () => loadTsModule('src/lib/projects/restore.ts');
const packing = () => loadTsModule('src/lib/cutting/binpacking.ts');

function savedResult() {
  const { optimizeCutting2D, DEFAULT_STOCK_SHEET, OPTIONS_DEFAULTS } = packing();
  const pieces = [{ id: 'a', name: 'Côté', height: 70, width: 40, quantity: 3 }];
  return JSON.parse(JSON.stringify(optimizeCutting2D(pieces, [DEFAULT_STOCK_SHEET], OPTIONS_DEFAULTS)));
}

test('a saved result comes back unchanged', () => {
  const saved = savedResult();
  assert.deepEqual(restore().pickRestorableResult(saved), saved);
});

test('a summary-only result from an old save is not a plan', () => {
  assert.equal(restore().pickRestorableResult({ sheetsUsed: 1, wastePercentage: 12 }), null);
});

test('anything that is not a result is refused', () => {
  for (const value of [null, undefined, 'x', 42, [], {}]) assert.equal(restore().pickRestorableResult(value), null);
});

test('a placed piece without finite coordinates refuses the whole result', () => {
  const saved = savedResult();
  saved.placedPieces[0].x = null;
  assert.equal(restore().pickRestorableResult(saved), null);
});

test('missing offcuts and unplaced pieces are read as none', () => {
  const saved = savedResult();
  delete saved.offcuts;
  delete saved.unplacedPieces;
  const result = restore().pickRestorableResult(saved);
  assert.deepEqual(result.offcuts, []);
  assert.deepEqual(result.unplacedPieces, []);
});
```

- [ ] **Step 2: Run** `node --test tests/project-restore.test.js` — Expected: FAIL (module absent).
- [ ] **Step 3: Implement `pickRestorableResult`.** Accepté si : objet ; `sheetsUsed` entier ≥ 1 ; `sheets` tableau non vide ; `placedPieces` tableau dont chaque élément a `x`, `y`, `width`, `height` finis et `sheetIndex` entier ≥ 0 inférieur à `sheetsUsed` ; `wastePercentage` fini. `offcuts` et `unplacedPieces` absents deviennent `[]`. Tous les autres champs sont rendus tels quels (même référence), `costBreakdown` et `costingInput` compris.
- [ ] **Step 4: Run** — Expected: PASS (5 tests).
- [ ] **Step 5: Commit** `feat(historique): valider le plan enregistré avant de le rouvrir`

### Task 2: L'atelier rouvre le plan et l'image

**Files:**
- Modify: `src/app/(site)/atelier/page.tsx` (effet de restauration, `useLayoutEffect` qui lit `qatlia_saved_project`)
- Modify: `src/app/(site)/history/page.tsx` (`handleLoadProject`)
- Modify: `src/i18n/messages/{fr,en,ar}.ts`
- Test: `tests/project-restore.test.js`, `e2e/atelier.spec.ts`

**Interfaces:**
- Consumes: `pickRestorableResult` (Task 1)
- Produces: clé `sessionStorage` `qatlia_restored_project_meta` = `JSON.stringify({ createdAt: string })`, écrite par l'historique, lue puis effacée par l'atelier avec les deux autres clés.

- [ ] **Step 1: Write the failing tests** (lecture de source, comme `tests/plan-zoom.test.js`)

```js
test('the atelier puts the saved plan and the scan back on screen', () => {
  const page = fs.readFileSync(path.resolve('src/app/(site)/atelier/page.tsx'), 'utf8');
  assert.match(page, /const restoredResult = pickRestorableResult\(parsed\.result\);/);
  assert.match(page, /if \(restoredResult\) \{\s*setResult\(restoredResult\);\s*setActiveSheetIndex\(0\);/);
  assert.match(page, /setPreviewImage\(restoredThumb\)/);
});
```

Spec `e2e/atelier.spec.ts`, test `'a project reopened from history shows its saved plan without a new run'` : `page.addInitScript` écrit `qatlia_saved_project` (un résultat d'une pièce sur un panneau, écrit en dur dans la spec) ; après chargement, `cut-plan-svg` est visible, le bandeau `data-testid="restored-plan-notice"` aussi, et aucune requête n'est partie vers `/api/optimize` (`page.on('request')`).

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** Dans l'effet de restauration : `restoredThumb` = `parsed.scanThumb` si chaîne, sinon `null`, posé dans `scanThumb` **et** `previewImage` ; `restoredResult` posé dans `result` avec `activeSheetIndex` à 0 ; `restoredAt` (nouvel état `string | null`) lu depuis `qatlia_restored_project_meta`. Bandeau au-dessus du plan quand `restoredAt` est défini : `atelier.restored.notice` = « Plan enregistré le {date}. Rouvert tel quel, sans nouvelle optimisation. » (en : « Plan saved on {date}. Reopened as saved, with no new run. » ; ar : « مخطط محفوظ بتاريخ {date}. فُتح كما هو، دون تحسين جديد. »), date par `formatDateTime(locale, …)`. `setRestoredAt(null)` dès qu'une optimisation réussit. Côté historique, `handleLoadProject` écrit la méta.
- [ ] **Step 4: Run** `node --test tests/project-restore.test.js` puis `npx tsc --noEmit` — Expected: PASS, 0 erreur.
- [ ] **Step 5: Commit** `fix(historique): un projet rouvert retrouve son plan et son image`

### Task 3: Renommer met aussi à jour le nom relu par l'atelier

**Files:**
- Modify: `src/app/api/projects/[id]/route.ts` (branche de renommage du `PATCH`)
- Test: `tests/project-history-persistence.test.js`

- [ ] **Step 1: Write the failing tests**

```js
test('renaming a project also names it for the next reopen, and keeps every other key', async () => {
  state.user = { id: UUID };
  state.projects.set(PROJECT_ID, { user_id: UUID, name: 'Débit', options_json: { projectName: 'Ancien', quotation: { quoteNumber: 'D-1' } } });
  const res = await withEnv(CONFIGURED, () => projectRoute().PATCH(...patch(PROJECT_ID, { name: '  Cuisine Alami ' })));
  assert.equal(res.status, 200);
  assert.deepEqual(state.updates, [{ id: PROJECT_ID, patch: { name: 'Cuisine Alami', options_json: { projectName: 'Cuisine Alami', quotation: { quoteNumber: 'D-1' } } } }]);
});

test('a 120-character name is accepted and a 121-character one refused', async () => {
  state.user = { id: UUID };
  state.projects.set(PROJECT_ID, { user_id: UUID, name: 'Débit', options_json: {} });
  const ok = await withEnv(CONFIGURED, () => projectRoute().PATCH(...patch(PROJECT_ID, { name: 'n'.repeat(120) })));
  const tooLong = await withEnv(CONFIGURED, () => projectRoute().PATCH(...patch(PROJECT_ID, { name: 'n'.repeat(121) })));
  assert.equal(ok.status, 200);
  assert.equal(tooLong.status, 400);
});

test('renaming another artisan\'s project answers 404 and writes nothing', async () => {
  state.user = { id: UUID };
  state.projects.set(OTHER_PROJECT_ID, { user_id: OTHER_UUID, name: 'Autre', options_json: {} });
  const res = await withEnv(CONFIGURED, () => projectRoute().PATCH(...patch(OTHER_PROJECT_ID, { name: 'Pris' })));
  assert.equal(res.status, 404);
  assert.deepEqual(state.updates, []);
});
```

- [ ] **Step 2: Run** `node --test tests/project-history-persistence.test.js` — Expected: 3 FAIL.
- [ ] **Step 3: Implement.** La branche de renommage suit la même séquence que la branche du marqueur PDF : lecture `select('id, user_id, options_json')` + `maybeSingle`, puis `update({ name, options_json: { ...existing, projectName: name } })`. `RenameSchema.max` passe à `PROJECT_NAME_MAX_CHARS` (importé de `history-metadata.ts`).
- [ ] **Step 4: Run** — Expected: PASS, les tests existants du fichier aussi.
- [ ] **Step 5: Commit** `fix(historique): renommer un projet le renomme aussi à la réouverture`

### Task 4: Le nom tapé dans l'atelier s'enregistre, et l'écran le dit

**Files:**
- Create: `src/lib/projects/rename.ts`
- Modify: `src/lib/history.ts` (ajout de `renameLocalHistoryItem`)
- Modify: `src/app/(site)/atelier/page.tsx` (`commitProjectName`, ligne sous `#project-name-input`)
- Modify: `src/app/(site)/history/page.tsx` (`handleLoadProject` écrit `qatlia_restored_local_id` pour un id non UUID ; `commitRename` appelle `renameLocalHistoryItem`)
- Modify: `src/i18n/messages/{fr,en,ar}.ts`
- Test: `tests/project-rename.test.js`

**Interfaces:**
- Produces:
  - `renameLocalHistoryItem(id: string, name: string): boolean` — `false` si l'entrée est introuvable ou si `localStorage` échoue.
  - `type RenameOutcome = 'saved' | 'pending' | 'failed'`
  - `saveProjectName(target: { cloudId: string | null; localId: string | null }, name: string, deps: { fetch: typeof fetch; renameLocal: (id: string, name: string) => boolean }): Promise<RenameOutcome>`

- [ ] **Step 1: Write the failing test**

```js
const rename = () => loadTsModule('src/lib/projects/rename.ts');
const okFetch = (calls) => async (url, init) => { calls.push([url, JSON.parse(init.body)]); return { ok: true }; };

test('a saved project is renamed on the server', async () => {
  const calls = [];
  const outcome = await rename().saveProjectName({ cloudId: PROJECT_ID, localId: null }, ' Cuisine ', { fetch: okFetch(calls), renameLocal: () => false });
  assert.equal(outcome, 'saved');
  assert.deepEqual(calls, [[`/api/projects/${PROJECT_ID}`, { name: 'Cuisine' }]]);
});

test('a refused or unreachable rename is reported as failed', async () => {
  const refused = await rename().saveProjectName({ cloudId: PROJECT_ID, localId: null }, 'Cuisine', { fetch: async () => ({ ok: false }), renameLocal: () => false });
  const offline = await rename().saveProjectName({ cloudId: PROJECT_ID, localId: null }, 'Cuisine', { fetch: async () => { throw new Error('offline'); }, renameLocal: () => false });
  assert.deepEqual([refused, offline], ['failed', 'failed']);
});

test('a project kept on this device only is renamed there', async () => {
  const renamed = [];
  const outcome = await rename().saveProjectName({ cloudId: null, localId: 'optimize_1' }, 'Cuisine', { fetch: async () => { throw new Error('unused'); }, renameLocal: (id, name) => { renamed.push([id, name]); return true; } });
  assert.equal(outcome, 'saved');
  assert.deepEqual(renamed, [['optimize_1', 'Cuisine']]);
});

test('with no saved plan yet, or an emptied name, nothing is sent', async () => {
  const calls = [];
  const deps = { fetch: okFetch(calls), renameLocal: () => true };
  assert.equal(await rename().saveProjectName({ cloudId: null, localId: null }, 'Cuisine', deps), 'pending');
  assert.equal(await rename().saveProjectName({ cloudId: PROJECT_ID, localId: null }, '   ', deps), 'pending');
  assert.deepEqual(calls, []);
});
```

- [ ] **Step 2: Run** `node --test tests/project-rename.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** les deux fonctions, puis l'atelier : `commitProjectName` devient asynchrone, n'appelle `saveProjectName` que si le nom a changé, avec `cloudId: lastSavedProjectId` et `localId` lu à la restauration. Nouvel état `nameSaveState: 'idle' | 'saving' | RenameOutcome`. Sous le champ, une ligne `aria-live="polite"`, `data-testid="project-name-status"` : `atelier.project.nameSaved` « Nom enregistré », `namePending` « Le nom sera enregistré avec le plan », `nameFailed` « Nom non enregistré. Réessayez. » (en : « Name saved » / « The name will be saved with the plan » / « Name not saved. Try again. » ; ar : « تم حفظ الاسم » / « سيُحفظ الاسم مع المخطط » / « لم يُحفظ الاسم. حاول مجدداً. »). En cas d'échec le brouillon reste dans le champ.
- [ ] **Step 4: Run** `node --test tests/project-rename.test.js tests/i18n-workshop-catalog.test.js` et `npx tsc --noEmit` — Expected: PASS hors échecs connus de `main`.
- [ ] **Step 5: Commit** `fix(atelier): le nom du projet s'enregistre en quittant le champ`

**Fin du lot 1 :** suite complète, comparaison des échecs avec `main`, PR.

---

# Lot 2 — Cartes ou tableau, et téléphone (PR 2)

### Task 5: Résumé d'une ligne d'historique et choix du mode

**Files:**
- Create: `src/lib/projects/history-row.ts`
- Test: `tests/history-row.test.js`

**Interfaces:**
- Produces:
  - `interface HistoryRow { id: string; name: string; createdAt: string; material: string; sheetHeight: number; sheetWidth: number; pieceCount: number; sheetsUsed: number | null; wastePercentage: number | null; scanThumb: string | null; hasFullScan: boolean; pdfGeneratedAt: string | null; hasPlan: boolean; isCloud: boolean }`
  - `toHistoryRow(project: { id: string; name: string; material: string; sheet_width: number; sheet_height: number; created_at: string; options_json?: unknown }): HistoryRow`
  - `type HistoryView = 'cards' | 'table'` ; `HISTORY_VIEW_KEY = 'qatlia_history_view'`
  - `readHistoryView(storage: Pick<Storage, 'getItem'> | null): HistoryView` ; `writeHistoryView(storage: Pick<Storage, 'setItem'> | null, view: HistoryView): void`

- [ ] **Step 1: Write the failing test**

```js
const rows = () => loadTsModule('src/lib/projects/history-row.ts');
const base = { id: PROJECT_ID, name: 'Cuisine', material: 'mdf', sheet_width: 206, sheet_height: 279, created_at: '2026-11-13T18:40:00.000Z' };

test('a full project is summarised for the list', () => {
  const row = rows().toHistoryRow({ ...base, options_json: {
    pieces: [{ quantity: 2 }, { quantity: 65 }], result: savedResult(), scanThumb: TINY_JPEG,
    scanPath: `${UUID}/${PROJECT_ID}.jpg`, pdfGeneratedAt: '2026-11-13T18:45:00.000Z' } });
  assert.equal(row.pieceCount, 67);
  assert.equal(row.hasPlan, true);
  assert.equal(row.hasFullScan, true);
  assert.equal(row.scanThumb, TINY_JPEG);
  assert.equal(row.isCloud, true);
});

test('an old project with nothing but its geometry still makes a row', () => {
  const row = rows().toHistoryRow({ ...base, id: 'optimize_1699999999999', options_json: undefined });
  assert.deepEqual(
    { pieceCount: row.pieceCount, sheetsUsed: row.sheetsUsed, wastePercentage: row.wastePercentage, scanThumb: row.scanThumb, hasPlan: row.hasPlan, hasFullScan: row.hasFullScan, isCloud: row.isCloud },
    { pieceCount: 0, sheetsUsed: null, wastePercentage: null, scanThumb: null, hasPlan: false, hasFullScan: false, isCloud: false });
});

test('a summary-only result gives the figures but no plan to reopen', () => {
  const row = rows().toHistoryRow({ ...base, options_json: { result: { sheetsUsed: 4, wastePercentage: 19.7 } } });
  assert.deepEqual([row.sheetsUsed, row.wastePercentage, row.hasPlan], [4, 19.7, false]);
});

test('the view defaults to cards and remembers a valid choice only', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(rows().readHistoryView(storage), 'cards');
  rows().writeHistoryView(storage, 'table');
  assert.equal(rows().readHistoryView(storage), 'table');
  store.set('qatlia_history_view', 'grid');
  assert.equal(rows().readHistoryView(storage), 'cards');
  assert.equal(rows().readHistoryView(null), 'cards');
});
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** `hasPlan` = `pickRestorableResult(result) !== null`. `isCloud` = id au format UUID. `scanThumb` passe par `sanitizeScanThumb`. `hasFullScan` = `scanPath` est une chaîne non vide (le contrôle du propriétaire reste côté serveur, Task 10).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(historique): résumé d'une ligne et mémoire du mode d'affichage`

### Task 6: Contrôle de renommage utilisable au doigt

**Files:**
- Create: `src/components/history/HistoryName.tsx`
- Create: `tests/helpers/render-component.js` (généralise `render-sheet-tabs.js` : `renderComponent(sourcePath, exportName, props, locale = 'fr')`, même remplacement de `useLocale` ; `render-sheet-tabs.js` s'appuie dessus)
- Modify: `src/i18n/messages/{fr,en,ar}.ts`
- Test: `tests/history-views.test.js`

**Interfaces:**
- Produces: `HistoryName(props: { name: string; onRename: (name: string) => Promise<boolean>; size: 'card' | 'row' })`

- [ ] **Step 1: Write the failing test**

```js
test('the rename button is always shown where there is no hover', () => {
  const html = renderComponent('src/components/history/HistoryName.tsx', 'HistoryName', { name: 'Cuisine', onRename: async () => true, size: 'card' });
  const button = html.match(/<button[^>]*data-testid="history-rename-btn"[^>]*>/)[0];
  assert.match(button, /aria-label="Renommer le projet Cuisine"/);
  assert.doesNotMatch(button, /(^|[\s"])opacity-0(\s|")/, 'never hidden by default');
  assert.match(button, /\[@media\(hover:hover\)\]:opacity-0/);
  assert.match(button, /\[@media\(hover:hover\)\]:group-hover:opacity-100/);
  assert.match(button, /w-8 h-8/);
});

test('a long name is truncated and never widens its container', () => {
  const html = renderComponent('src/components/history/HistoryName.tsx', 'HistoryName', { name: 'ق'.repeat(120), onRename: async () => true, size: 'row' });
  assert.match(html, /<span[^>]*class="[^"]*\btruncate\b[^"]*"[^>]*dir="auto"/);
  assert.match(html, /class="[^"]*\bmin-w-0\b/);
});
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** En édition : champ (`maxLength={120}`, `data-testid="history-rename-input"`), bouton ✓ `historyPage.renameSave` « Enregistrer le nom », bouton ✕ `historyPage.renameCancel` « Annuler ». Entrée ou ✓ ou perte du focus enregistre ; Échap ou ✕ annule (✕ porte `onPointerDown={(e) => e.preventDefault()}` pour que la perte du focus n'enregistre pas avant). Si `onRename` rend `false` : le champ reste ouvert avec le brouillon et affiche `historyPage.renameFailed` « Nom non enregistré. Réessayez. ». Libellé du crayon : clé existante `historyPage.renameAria`.
- [ ] **Step 4: Run** `node --test tests/history-views.test.js tests/sheet-tabs.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(historique): renommer au doigt, avec boutons valider et annuler`

### Task 7: Vue cartes, vue tableau, bascule

**Files:**
- Create: `src/components/history/HistoryCards.tsx`, `src/components/history/HistoryTable.tsx`, `src/components/history/HistoryViewToggle.tsx`
- Modify: `src/app/(site)/history/page.tsx` (garde chargement, fusion, filtres ; rend `toHistoryRow` puis la vue choisie)
- Modify: `src/i18n/messages/{fr,en,ar}.ts`
- Test: `tests/history-views.test.js`, `e2e/features.spec.ts`

**Interfaces:**
- Consumes: `HistoryRow`, `HistoryView`, `readHistoryView`, `writeHistoryView` (Task 5) ; `HistoryName` (Task 6)
- Produces:
  - `interface HistoryListProps { rows: HistoryRow[]; onOpen: (id: string) => void; onRename: (id: string, name: string) => Promise<boolean>; onDownloadPdf: (id: string) => void; onViewScan: (id: string) => void }`
  - `HistoryCards(props: HistoryListProps)` ; `HistoryTable(props: HistoryListProps)`
  - `HistoryViewToggle(props: { view: HistoryView; onChange: (view: HistoryView) => void })`

**Mise en page décidée :**
- **Cartes** : contenu actuel, une colonne sous 768 px, deux au-delà. Miniature cliquable (`onViewScan`) de 56 px. Boutons « PDF » et « Ouvrir » d'au moins 40 px de haut. Sous 640 px, la ligne d'actions passe sous les chiffres, « Ouvrir » en pleine largeur.
- **Tableau, à partir de 640 px** : vrai `<table>` dans un conteneur `overflow-x-auto`. Colonnes : aperçu (40 px) · nom · date · matériau · panneau · pièces · panneaux · chute · actions. Sous 1024 px, les colonnes matériau et panneau sont masquées (`hidden lg:table-cell`).
- **Tableau, sous 640 px** : liste compacte, une entrée par projet sur deux lignes. Ligne 1 : miniature 40 px, nom tronqué, bouton « Ouvrir » (icône seule, 40 px, `aria-label` complet). Ligne 2 : date · pièces · panneaux · chute. Aucun défilement horizontal.
- **Bascule** : deux boutons icône (`LayoutGrid`, `Rows3`) avec `aria-pressed`, `historyPage.view.cards` « Cartes » / `historyPage.view.table` « Tableau » (en : Cards / Table ; ar : بطاقات / جدول), placée à droite des filtres. Sous 640 px les filtres passent sur deux lignes (`flex-wrap`), la recherche en pleine largeur.
- Valeur absente (`null`) : tiret « — ». Chute : `wastePercentage` suivi du signe pour cent rendu en JSX (`{value}%`), pas dans une chaîne.
- **En-tête de page à 360 px** : le libellé « Retour à l'atelier » et le logo sont masqués sous 640 px (flèche seule, `aria-label` gardé).

- [ ] **Step 1: Write the failing tests** (rendu serveur des vrais composants, deux lignes : une complète, une ancienne issue de `toHistoryRow`)

```js
test('both views show the same projects, each with its open action', () => {
  for (const [file, name] of [['HistoryCards', 'HistoryCards'], ['HistoryTable', 'HistoryTable']]) {
    const html = renderComponent(`src/components/history/${file}.tsx`, name, listProps([fullRow, legacyRow]));
    assert.equal((html.match(/data-testid="history-open"/g) || []).length, 2);
    assert.match(html, /aria-label="Ouvrir Cuisine Alami"/);
  }
});

test('an old project shows dashes instead of invented figures', () => {
  const html = renderComponent('src/components/history/HistoryTable.tsx', 'HistoryTable', listProps([legacyRow]));
  assert.doesNotMatch(html, />0%</);
  assert.match(html, /data-col="waste"[^>]*>—</);
  assert.doesNotMatch(html, /data-testid="history-pdf"/);
  assert.doesNotMatch(html, /data-testid="history-scan"/);
});

test('the table is a real table from 640px and a compact list below', () => {
  const html = renderComponent('src/components/history/HistoryTable.tsx', 'HistoryTable', listProps([fullRow]));
  assert.match(html, /<table[^>]*class="[^"]*\bhidden sm:table\b/);
  assert.match(html, /<ul[^>]*data-testid="history-compact"[^>]*class="[^"]*\bsm:hidden\b/);
  assert.equal((html.match(/<th[\s>]/g) || []).length, 9);
});

test('the toggle says which view is on', () => {
  const html = renderComponent('src/components/history/HistoryViewToggle.tsx', 'HistoryViewToggle', { view: 'table', onChange: () => {} });
  assert.match(html, /aria-label="Tableau"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Tableau"/);
  assert.match(html, /aria-label="Cartes"[^>]*aria-pressed="false"|aria-pressed="false"[^>]*aria-label="Cartes"/);
});
```

Spec `e2e/features.spec.ts`, à 390 px : la bascule passe en tableau, `history-compact` est visible, `document.documentElement.scrollWidth <= clientWidth`, et le choix survit à un rechargement.

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** les trois composants et brancher la page. `onRename` de la page garde la logique actuelle de `commitRename` (PATCH pour un UUID, `renameLocalHistoryItem` sinon) et rend un booléen. `onViewScan` ouvre pour l'instant la miniature dans le visualiseur du lot 3 ; d'ici là, il n'est branché que si `scanThumb` existe et ouvre l'image dans un nouvel onglet.
- [ ] **Step 4: Run** `node --test tests/history-views.test.js tests/history-row.test.js` et `npx tsc --noEmit`. Puis contrôle visuel : rendu serveur + feuille compilée dans Playwright à 360, 390, 412 et 1280 px, en `dir="rtl"` et thème sombre, avec un nom de 120 caractères arabes. Expected: aucun défilement horizontal de page, nom tronqué, cibles tactiles ≥ 40 px.
- [ ] **Step 5: Commit** `feat(historique): vue cartes ou tableau, lisible sur téléphone`

**Fin du lot 2 :** suite complète, comparaison avec `main`, captures dans la PR.

---

# Lot 3 — Image du scan lisible (PR 3)

Contient une migration : **le propriétaire l'applique sur la base de production avant de fusionner.**

### Task 8: Bucket privé

**Files:**
- Create: `supabase/migrations/017_scan_images.sql`
- Modify: `supabase/migrations/FULL_DATABASE_SETUP.sql` seulement si la migration 016 y figure déjà

- [ ] **Step 1: Écrire la migration.** Bucket `scans`, `public = false`, `file_size_limit = 3145728`, `allowed_mime_types = array['image/jpeg','image/png','image/webp']`, insertion `on conflict (id) do nothing`. Aucune policy `storage.objects` : seules les routes serveur (clé de service) y accèdent.
- [ ] **Step 2: Commit** `feat(historique): bucket privé pour les images scannées`

### Task 9: Valider et enregistrer l'image

**Files:**
- Create: `src/lib/projects/scan-image.ts`, `src/app/api/scans/route.ts`
- Modify: `src/lib/projects/history-metadata.ts` (`pickProjectHistoryMetadata(body: unknown, ownerId?: string)` garde `scanPath` s'il appartient à `ownerId`), `src/app/api/projects/route.ts` (passe `user.id`), `src/lib/projects/persistence-payload.ts` (`scanPath?: string | null`)
- Test: `tests/scan-image.test.js`, `tests/project-history-persistence.test.js`

**Interfaces:**
- Produces:
  - `SCAN_IMAGE_MAX_CHARS = 2_800_000` ; `SCAN_BUCKET = 'scans'`
  - `parseScanImage(dataUrl: unknown): { mime: 'image/jpeg' | 'image/png' | 'image/webp'; ext: 'jpg' | 'png' | 'webp'; bytes: Buffer } | null`
  - `scanPathFor(userId: string, fileId: string, ext: string): string` → `${userId}/${fileId}.${ext}`
  - `isOwnScanPath(path: unknown, userId: string): path is string` — vrai seulement pour `^<userId>/<uuid>\.(jpg|png|webp)$`
  - `POST /api/scans` corps `{ image: string }` → `200 { success: true, scanPath }` ; `401 AUTH_REQUIRED` ; `400 INVALID_IMAGE` ; `503 SCAN_STORAGE_UNAVAILABLE` (pas de clé de service, ou envoi refusé).

- [ ] **Step 1: Write the failing tests**

```js
test('a scan path is only ever the artisan\'s own', () => {
  const { isOwnScanPath, scanPathFor } = scan();
  assert.equal(isOwnScanPath(scanPathFor(UUID, PROJECT_ID, 'jpg'), UUID), true);
  for (const path of [`${OTHER_UUID}/${PROJECT_ID}.jpg`, `${UUID}/../${OTHER_UUID}/${PROJECT_ID}.jpg`, `${UUID}/${PROJECT_ID}.svg`, `${UUID}/x.jpg`, '', null, 42]) {
    assert.equal(isOwnScanPath(path, UUID), false);
  }
});

test('only a real, bounded image dataURL is parsed', () => {
  const { parseScanImage, SCAN_IMAGE_MAX_CHARS } = scan();
  assert.deepEqual([parseScanImage(TINY_JPEG).mime, parseScanImage(TINY_JPEG).ext], ['image/jpeg', 'jpg']);
  for (const bad of ['data:image/svg+xml;base64,AAAA', 'data:text/html;base64,AAAA', 'https://x/y.jpg', `data:image/jpeg;base64,${'A'.repeat(SCAN_IMAGE_MAX_CHARS)}`, null]) {
    assert.equal(parseScanImage(bad), null);
  }
});

test('a save keeps the artisan\'s own scan path and drops anyone else\'s', async () => {
  state.user = { id: UUID };
  await withEnv(CONFIGURED, () => projectsRoute().POST(post(savePayload({ scanPath: `${UUID}/${PROJECT_ID}.jpg` }))));
  await withEnv(CONFIGURED, () => projectsRoute().POST(post(savePayload({ scanPath: `${OTHER_UUID}/${PROJECT_ID}.jpg` }))));
  assert.equal(state.inserts[0].options_json.scanPath, `${UUID}/${PROJECT_ID}.jpg`);
  assert.equal('scanPath' in state.inserts[1].options_json, false);
});
```

Pour la route `POST /api/scans` (stub de `storage.from('scans').upload` qui enregistre ses appels) : sans session → 401 et aucun envoi ; image invalide → 400 et aucun envoi ; image valide → 200, un envoi dont le chemin vérifie `isOwnScanPath(path, UUID)` et `contentType` `image/jpeg`, `upsert: false`.

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** L'identifiant de fichier vient de `crypto.randomUUID()` côté serveur, jamais du client.
- [ ] **Step 4: Run** `node --test tests/scan-image.test.js tests/project-history-persistence.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(historique): garder l'image scannée dans un espace privé`

### Task 10: Servir l'image à son propriétaire

**Files:**
- Create: `src/app/api/projects/[id]/scan/route.ts`
- Test: `tests/scan-image.test.js`

**Interfaces:**
- Produces: `GET /api/projects/[id]/scan` → `200 { success: true, url }` (URL signée, 300 s) ; `401 AUTH_REQUIRED` ; `404 NOT_FOUND` pour un projet absent, d'un autre artisan, sans `scanPath`, ou dont le `scanPath` n'est pas le sien.

- [ ] **Step 1: Write the failing tests** : propriétaire → 200 et `createSignedUrl` appelé avec `(scanPath, 300)` ; projet d'un autre → 404 sans appel ; projet dont `options_json.scanPath` pointe chez un autre artisan → 404 sans appel ; projet sans image → 404.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** (même garde d'identité et même client de base que `GET /api/projects/[id]`).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(historique): lien signé vers l'image scannée`

### Task 11: Envoyer l'image à la sauvegarde, et la voir en grand

**Files:**
- Create: `src/components/ScanViewer.tsx`
- Modify: `src/app/(site)/atelier/page.tsx` (`persistProject`, restauration, aperçu du scan), `src/app/(site)/history/page.tsx` (`onViewScan`), `src/i18n/messages/{fr,en,ar}.ts`
- Test: `tests/history-views.test.js`, `tests/project-restore.test.js`

**Interfaces:**
- Consumes: `POST /api/scans`, `GET /api/projects/[id]/scan`, `HistoryRow.hasFullScan`
- Produces: `ScanViewer(props: { src: string; reduced: boolean; alt: string; onClose: () => void })`

- [ ] **Step 1: Write the failing tests** : rendu serveur de `ScanViewer` → `role="dialog"`, `aria-modal="true"`, image avec `alt`, lien « Ouvrir l'image » (`target="_blank"`, `rel="noopener noreferrer"`), bouton « Fermer » ; avec `reduced: true`, le texte `scanViewer.reducedNote` « Aperçu réduit : l'image d'origine n'a pas été gardée pour ce projet. » est présent, absent sinon. Lecture de source de l'atelier : `scanPath` figure dans l'appel à `buildPersistedProjectPayload` et l'envoi vers `/api/scans` est dans un `try` dont l'échec n'empêche pas la sauvegarde.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** Dans `persistProject`, pour un artisan connecté : si `previewImage` est une dataURL et qu'aucun `scanPath` n'est connu, `POST /api/scans` puis `setScanPath` ; le chemin part dans la sauvegarde. Restauration : `setScanPath(parsed.scanPath)`. L'aperçu du scan dans l'atelier et la miniature de l'historique deviennent des boutons (`aria-label` `scanViewer.openAria` « Voir l'image de {name} ») : si l'image complète existe, récupérer l'URL signée puis ouvrir `ScanViewer` ; sinon ouvrir la miniature avec `reduced`. Le visualiseur défile et laisse le pincement agrandir (`overflow-auto`, `touch-action: pinch-zoom`), se ferme par Échap, le bouton et un clic hors de l'image.
- [ ] **Step 4: Run** tests ciblés + `npx tsc --noEmit` ; contrôle visuel du visualiseur à 360 et 1280 px.
- [ ] **Step 5: Commit** `feat(historique): voir l'image scannée en grand`

**Fin du lot 3 :** suite complète ; la PR rappelle en tête la migration 017 à appliquer avant fusion, et que sans elle l'envoi répond 503 et la sauvegarde continue avec la seule miniature.

---

# Lot 4 — Liste légère (PR 4, sous condition)

### Task 12: Mesurer avant de construire

- [ ] **Step 1:** Sur la production, compte du propriétaire, onglet réseau : poids de la réponse de `GET /api/projects` et nombre de projets. Noter les deux dans l'issue.
- [ ] **Step 2: Décision.** Sous 500 Ko : arrêter le lot ici et le noter. Au-delà : tâches 13 et 14.

### Task 13: La liste n'envoie que le résumé

**Files:**
- Modify: `src/app/api/projects/route.ts` (`GET`), `src/app/(site)/history/page.tsx`
- Create: `src/app/api/projects/[id]/plan/route.ts`
- Test: `tests/project-history-persistence.test.js`

**Interfaces:**
- Consumes: `toHistoryRow` (Task 5)
- Produces:
  - `GET /api/projects?limit=20&before=<created_at ISO>` → `{ success: true, rows: HistoryRow[], nextBefore: string | null }` ; `limit` borné à 1–50, défaut 20.
  - `GET /api/projects/[id]/plan` → `{ success: true, project: options_json }` pour le propriétaire, `404 NOT_FOUND` sinon.

- [ ] **Step 1: Write the failing tests** : la liste ne contient ni `result` ni `pieces` (`JSON.stringify(body).includes('placedPieces') === false`) ; `nextBefore` vaut le `created_at` de la dernière ligne quand il en reste, `null` sinon ; `/plan` rend `options_json` entier au propriétaire et 404 à un autre artisan.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** La page charge 20 lignes, un bouton `historyPage.loadMore` « Afficher plus » charge la suite. « Ouvrir » et « PDF » appellent d'abord `/plan`. Les entrées locales passent par `toHistoryRow` côté client et restent en tête de fusion comme aujourd'hui.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `perf(historique): la liste n'envoie plus les plans entiers`

### Task 14: Miniature plus petite quand l'image complète existe

- [ ] **Step 1:** Dans l'atelier, quand l'envoi vers `/api/scans` a réussi, la miniature gardée dans `options_json` passe de 600 px à 240 px (`downscaleDataUrl(image, 240, 0.6)`). Sans image complète, elle reste à 600 px. Test de lecture de source sur ces deux appels.
- [ ] **Step 2: Commit** `perf(historique): miniature de liste réduite quand l'image est gardée`
