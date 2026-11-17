# Trois écrans : atelier, historique, configuration des panneaux — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'application se lit comme trois écrans (« Atelier débitage », « Historique des débits », « Configuration des panneaux ») reliés par une même barre, et le menuisier gère la liste des panneaux avec lesquels il travaille sur une page à elle.

**Architecture:** Une barre unique (`WorkspaceNav`) remplace la barre propre à l'atelier et s'affiche sur les trois écrans. La liste des panneaux existe déjà (table `panel_presets`, `/api/panel-presets`, repli sur l'appareil) : la nouvelle page la lit et l'écrit à travers un hook partagé, et l'API apprend à modifier un panneau entier. Comme la barre invite à quitter l'atelier, le débit en cours est gardé dans l'onglet et remis à l'écran au retour.

**Tech Stack:** Next.js 14.2 (App Router), React 18, Supabase, zod, Tailwind 3.4, tests `node:test` (`tests/*.test.js`, `tests/helpers/load-ts-module.js`, `tests/helpers/render-component.js`, `tests/helpers/fake-supabase.js`), specs Playwright (`e2e/`).

**Spec:** aucune. Demande du propriétaire du 2026-11-17 : « on garde Atelier débitage (écran principal), historique débit, configuration des panneaux (où le client peut configurer la liste des panneaux avec lesquels il travaille), planifie cela ». Réponse à la question posée ensuite : **oui**, dans l'atelier le menuisier peut encore saisir un panneau à la main. La section **Décisions de conception** tient lieu de spec.

## Ce qui se passe aujourd'hui (constat)

| Sujet | Dans le code |
|---|---|
| La barre | `atelier/page.tsx`, `<nav aria-label={t('atelier.sidebar.title')}>` : « Chiffrage & Devis » (bouton grisé tant qu'aucun plan 2D n'existe, doublon du bouton « Devis client » sous le plan), « Historique des débits », puis les chiffres machine. Elle n'existe que dans l'atelier. |
| L'historique | `history/page.tsx` a son propre en-tête, avec une flèche « Atelier » pour seul retour. L'en-tête de l'atelier porte un second lien « Historique ». |
| La liste des panneaux | Enregistrée dans le compte (`panel_presets`, 100 au plus), ou sur l'appareil sans compte (`localStorage`, 40 au plus). Champs : nom, hauteur, largeur, matériau, couleur, ramage et sens, prix. |
| Où on la gère | Dans la carte « Panneau brut en stock » de l'atelier : « Sauvegarder » ajoute le panneau en cours, « Gérer » déplie une liste où l'on ne peut que changer le prix ou supprimer. |
| Modifier un panneau | Impossible : `PATCH /api/panel-presets/[id]` n'accepte que `{ pricePerSheet }`. Il faut supprimer et recréer. |
| Quitter l'atelier | L'état de l'atelier vit dans le composant. Un clic vers l'historique puis retour : les pièces saisies, le panneau, les réglages et le plan à l'écran sont perdus, l'atelier rouvre sur les cinq pièces d'exemple. Seul un plan déjà optimisé se retrouve, en le rouvrant depuis l'historique. |

## Décisions de conception

1. **Quatre lots, quatre PR**, chacun livrable seul, dans cet ordre : (1) barre commune, (2) le débit en cours survit à l'aller-retour, (3) page « Configuration des panneaux », (4) carte du panneau allégée dans l'atelier. Le lot 2 n'était pas dans la demande : il est là parce que la barre rend l'aller-retour courant, et qu'aujourd'hui il fait perdre le travail.
2. **Trois entrées, dans cet ordre, les mêmes partout** : « Atelier débitage », « Historique des débits », « Configuration des panneaux ». Sous 640 px : « Atelier », « Historique », « Panneaux ». L'écran courant est mis en évidence et porte `aria-current="page"`.
3. **« Chiffrage & Devis » quitte la barre.** Le devis reste ouvert par le bouton « Devis client » sous le plan, qui n'apparaît que lorsqu'il est utilisable.
4. **Un seul chemin par destination.** Le lien « Historique » de l'en-tête de l'atelier et la flèche « Atelier » de l'en-tête de l'historique disparaissent : la barre les remplace.
5. **Les chiffres machine restent dans la barre de l'atelier seulement** (dimensions du panneau, pastille de la lame qui mène à `#cut-settings`).
6. **Adresse de la page : `/panels`**, comme `/history`, `/credits`, `/account` et `/api/panel-presets`. Elle rejoint `PRIVATE_ROUTES` (non indexée).
7. **La page fonctionne sans compte**, sur la liste de l'appareil, avec une ligne qui dit que se connecter la retrouve sur tous ses appareils. Mêmes règles qu'aujourd'hui : compte si connecté, appareil sinon ou si le compte est injoignable.
8. **Sur la page : ajouter, modifier en entier, supprimer.** Le formulaire porte nom (obligatoire, 80 caractères), hauteur, largeur, matériau, couleur ou décor (60 caractères), ramage et sens, prix (facultatif). Des pastilles « Tailles standards » préremplissent le formulaire d'ajout. Supprimer demande un second clic, comme « Nouveau débit ».
9. **Même règle de doublon partout** (`isSamePanel` : dimensions, matériau, couleur, ramage ; le nom ne compte pas). Modifier un panneau pour le rendre identique à un autre est refusé, avec le nom de l'autre.
10. **Unité** : la page lit et écrit le choix cm / mm déjà gardé (`qatlia_display_unit_v1`). Les dimensions restent enregistrées en cm.
11. **Dans l'atelier, la saisie à la main reste** (réponse du propriétaire). La liste sert de raccourci ; « Sauvegarder » reste, pour garder d'un clic le format qu'on vient de saisir. « Gérer » devient un lien vers `/panels` et la liste repliée disparaît.
12. **Le débit en cours est gardé dans l'onglet** (`sessionStorage`), écrit quand on quitte l'atelier par un lien du site, relu au retour, puis effacé. Il n'est pas écrit quand l'atelier est dans son état de départ. Un projet rouvert depuis l'historique et un travail gardé avant connexion passent avant lui. La déconnexion l'efface. Recharger la page (F5) garde le comportement actuel.
13. **Aucune migration**, aucun crédit dépensé, aucun appel à `/api/optimize` par ces quatre lots.
14. **Tout nouveau texte existe en français, anglais et arabe**, et l'affichage tient en sens droite-à-gauche.
15. **Hors périmètre** : stock et quantités de panneaux, tri ou recherche dans la liste, import ou export de la liste, réglages de coupe par défaut du compte, mode 1D sur la page (une barre n'est pas un panneau enregistré), faire lire la liste par le bot WhatsApp.

## Questions ouvertes pour le propriétaire

1. Le libellé de l'adresse : `/panels` (prévu ici) ou `/panneaux` ?
2. Le lot 2 garde le débit en cours quand on change d'écran. Faut-il aussi le garder quand on recharge la page (prévu ici : non, comme aujourd'hui) ?
3. Sur la page, les cinq « Tailles standards » sont des raccourcis de saisie (prévu ici). Faut-il plutôt pouvoir les retirer de la liste proposée dans l'atelier ?

## Global Constraints

- Production en ligne (qatlia.ma) : une PR par lot, jamais de push sur `main`. Le propriétaire fusionne. Chaque lot part de `origin/main` à jour ; si le lot précédent n'est pas fusionné, la PR s'appuie sur sa branche et le dit en tête de description.
- Avant chaque PR : `npx tsc --noEmit` et `npm run lint` sans erreur, `npm run test:node`. Sur ce poste Windows, 10 tests échouent déjà sur `main` (fins de ligne) : comparer les noms des échecs à `.claude/worktrees/base-fails-sorted.txt`, aucun nouveau.
- Travailler dans `.claude/worktrees/<nom>` avec une jonction `node_modules` ; détacher la jonction (`cmd //c rmdir`) avant `git worktree remove`.
- Les fichiers du dépôt sont en fins de ligne CRLF : les modifier sans les convertir.
- L'application ne démarre pas en local (pas de `.env.local`). Vérifier le rendu en rendant le vrai composant côté serveur (`tests/helpers/render-component.js`) avec la feuille Tailwind compilée (`npx tailwindcss -i ./src/app/globals.css -o <fichier>`), dans Playwright à 360, 390 et 1366 px, en français et en arabe. Dire dans la PR ce qui n'a pas pu être vérifié.
- Plusieurs tests lisent `atelier/page.tsx` comme du texte et exigent des lignes voisines exactes (`tests/project-restore.test.js`, `tests/project-rename.test.js`, `tests/new-job.test.js`, `tests/atelier-layout.test.js`). Un test existant qui casse se corrige en déplaçant le nouveau code, pas en affaiblissant le test, sauf quand le comportement testé change exprès.
- `tests/claims-audit.test.js` refuse un pourcentage écrit dans une chaîne de `src/`.
- Rien de ce que le client envoie n'entre brut en base : tout passe par `PresetInputSchema` (`src/lib/panel-presets-store.ts`).
- Messages de commit en français, style `feat(atelier): …`, `feat(panneaux): …`.

## Review Focus

1. **Panneau modifié jusqu'à devenir identique à un autre** : refusé, l'écran nomme l'autre panneau, rien n'est écrit. → Tâches 5 et 6.
2. **Identifiant d'un panneau d'un autre artisan dans un `PATCH`** : même réponse « introuvable » que pour un identifiant inconnu, rien n'est modifié. → Tâche 5.
3. **Compte injoignable ou table absente pendant qu'on est sur la page** : la liste de l'appareil s'affiche, l'ajout et la modification écrivent sur l'appareil, sans écran d'erreur. → Tâche 7.
4. **Débit gardé trop gros pour `sessionStorage`** (plan de plusieurs centaines de pièces, miniature du scan) : le départ de l'atelier n'échoue pas ; le débit est gardé sans le plan, ou pas du tout. → Tâche 3.
5. **Nom de panneau de 80 caractères, en arabe, à 360 px de large** : tronqué, sans défilement horizontal de la page ; la barre à trois entrées tient sur une ligne. → Tâches 1 et 8.

---

# Lot 1 — Barre commune (PR 1)

Branche `feat/barre-commune`. Deux entrées dans ce lot ; la troisième arrive avec sa page (lot 3).

### Task 1: Le composant `WorkspaceNav` et ses libellés

**Files:**
- Create: `src/components/WorkspaceNav.tsx`
- Modify: `src/i18n/messages/fr.ts`, `en.ts`, `ar.ts`
- Test: `tests/workspace-nav.test.js`

**Interfaces:**
- Produces:
  ```ts
  export type WorkspaceScreen = 'atelier' | 'history' | 'panels';
  /** The entries shown, in order. Lot 1: atelier, history. Lot 3 adds panels. */
  export const WORKSPACE_ENTRIES: ReadonlyArray<{ screen: WorkspaceScreen; href: string; label: TranslationKey; shortLabel: TranslationKey }>;
  export function WorkspaceNav(props: {
    current: WorkspaceScreen;
    /** Classes of the inner row: the page's own max width and side padding. */
    className?: string;
    /** Trailing slot, pushed to the end of the row (the atelier's machine figures). */
    children?: React.ReactNode;
  }): JSX.Element;
  ```
- Libellés, nouvel espace `workspaceNav` :

  | Clé | fr | en | ar |
  |---|---|---|---|
  | `aria` | Écrans de l'application | App screens | شاشات التطبيق |
  | `atelier` | Atelier débitage | Cutting workshop | ورشة التقطيع |
  | `atelierShort` | Atelier | Workshop | الورشة |
  | `history` | Historique des débits | Cut list history | سجل قوائم القطع |
  | `historyShort` | Historique | History | السجل |
  | `panels` | Configuration des panneaux | Panel setup | إعداد الألواح |
  | `panelsShort` | Panneaux | Panels | الألواح |

- [ ] **Step 1: Écrire les tests qui échouent** (`renderComponent('src/components/WorkspaceNav.tsx', 'WorkspaceNav', { current })`)
  - `current: 'history'` : le lien `href="/history"` porte `aria-current="page"`, le lien `href="/atelier"` ne le porte pas.
  - Les liens sortent dans l'ordre de `WORKSPACE_ENTRIES`, chacun avec son libellé long dans un `hidden sm:inline` et son libellé court dans un `sm:hidden`.
  - Aucun `<button` dans la barre ; le `<nav>` porte `aria-label="Écrans de l'application"`.
  - `children` est rendu après le dernier lien, dans un conteneur `ms-auto`.
  - Les sept clés existent dans les trois langues, toutes différentes de la clé elle-même.
- [ ] **Step 2: Lancer** `node --test tests/workspace-nav.test.js` — échec attendu : module introuvable.
- [ ] **Step 3: Écrire le composant.** `<nav>` collant sous l'en-tête (`sticky top-16 z-30`, bordure basse, fond `bg-studio-canvas/85 backdrop-blur-xl`), rangée `flex items-center gap-1 overflow-x-auto overscroll-x-contain`. Liens `next/link` ; icônes `lucide-react` : `Scissors` (atelier), `History`, `Layers` (panneaux). Entrée courante : `bg-brand-400/10 text-brand-500 dark:text-brand-400`. Cible tactile d'au moins 40 px de haut.
- [ ] **Step 4: Relancer** — tout passe.
- [ ] **Step 5: Commit** `feat(navigation): barre commune aux écrans`.

### Task 2: L'atelier et l'historique utilisent la barre

**Files:**
- Modify: `src/app/(site)/atelier/page.tsx` (barre « Pilotage », lien « Historique » de l'en-tête)
- Modify: `src/app/(site)/history/page.tsx` (en-tête)
- Modify: `src/i18n/messages/{fr,en,ar}.ts` (retirer `atelier.sidebar`)
- Test: `tests/atelier-nav.test.js` (réécrit), `tests/atelier-layout.test.js` (inchangé, doit rester vert)

**Interfaces:**
- Consumes: `WorkspaceNav` (tâche 1).

- [ ] **Step 1: Réécrire `tests/atelier-nav.test.js`** (lecture du texte des deux pages) :
  - `atelier/page.tsx` contient `<WorkspaceNav current="atelier"` et ne contient plus `atelier.sidebar`, ni `navQuotation`, ni `<Link` vers `/history`.
  - Le bloc `Machine setup figures` (dimensions, pastille `href="#cut-settings"`) est entre `<WorkspaceNav current="atelier"` et `</WorkspaceNav>`.
  - `setIsQuotationDialogOpen(true)` n'apparaît plus qu'une fois : le bouton « Devis client » sous le plan.
  - `history/page.tsx` contient `<WorkspaceNav current="history"` et ne contient plus `historyPage.backToAtelier`.
  - Les trois catalogues ne contiennent plus `navQuotation` ni `navHistory`.
- [ ] **Step 2: Lancer** — échec attendu.
- [ ] **Step 3: Atelier.** Remplacer le `<nav>` « Pilotage » par `<WorkspaceNav current="atelier" className="max-w-[1500px] mx-auto px-4 sm:px-6">` placé juste après `</header>`, hors de `<main>`, avec les chiffres machine en enfants. Retirer le bouton « Chiffrage & Devis », le lien « Historique » de l'en-tête et les imports devenus inutiles.
- [ ] **Step 4: Historique.** Ajouter `<WorkspaceNav current="history" className="max-w-6xl mx-auto px-4 sm:px-8" />` après `</header>`. Retirer la flèche de retour ; le logo s'affiche aussi sur téléphone. La clé `historyPage.backToAtelier` reste (utilisée par `account/page.tsx`).
- [ ] **Step 5: Lancer la suite entière**, `tsc`, `lint`. Comparer les échecs à la liste de base.
- [ ] **Step 6: Vérifier le rendu** de `WorkspaceNav` à 360, 390 et 1366 px, en français et en arabe : une seule ligne, pas de défilement horizontal de la page.
- [ ] **Step 7: Commit** `feat(atelier): la barre commune remplace la barre de l'atelier`, puis PR.

---

# Lot 2 — Le débit en cours survit à l'aller-retour (PR 2)

Branche `feat/debit-garde`.

### Task 3: Le débit gardé, module pur

**Files:**
- Create: `src/lib/atelier-draft.ts`
- Test: `tests/atelier-draft.test.js`

**Interfaces:**
- Produces:
  ```ts
  export const ATELIER_DRAFT_KEY = 'qatlia_atelier_draft';
  export interface AtelierDraft {
    v: 1;
    /** Same shape the atelier already restores from 'qatlia_saved_project'; `result` may be absent. */
    project: Record<string, unknown>;
    /** The pieces the plan on screen was computed from, when they differ from `project.pieces`. */
    plannedPieces: unknown[] | null;
    cutMode: '2d' | '1d';
    projectId: string | null;
    localProjectId: string | null;
    /** ISO date shown by the "reopened plan" banner, when the plan came from the history. */
    restoredAt: string | null;
  }
  type DraftStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** 'full' | 'without-plan' (quota: retried without project.result) | 'dropped'. Never throws. */
  export function writeAtelierDraft(store: DraftStore, draft: AtelierDraft): 'full' | 'without-plan' | 'dropped';
  /** The draft, or null when missing or malformed (then removed). */
  export function readAtelierDraft(store: DraftStore): AtelierDraft | null;
  export function clearAtelierDraft(store: DraftStore): void;
  ```

- [ ] **Step 1: Tests qui échouent** : aller-retour écrire/lire ; JSON abîmé ou `v` inconnue → `null` et clé retirée ; `setItem` qui lève une fois → `'without-plan'` et le brouillon relu n'a plus `project.result` ni `plannedPieces` ; `setItem` qui lève toujours → `'dropped'`, clé absente, aucune exception ; `clearAtelierDraft` retire la clé.
- [ ] **Step 2: Lancer** — échec attendu.
- [ ] **Step 3: Écrire le module** (aucun `'use client'`, aucun accès à `window`).
- [ ] **Step 4: Relancer** — tout passe.
- [ ] **Step 5: Commit** `feat(atelier): débit en cours gardé dans l'onglet (module)`.

### Task 4: L'atelier écrit le débit en partant et le relit au retour

**Files:**
- Modify: `src/app/(site)/atelier/page.tsx` (effet de restauration, nouvel effet de départ)
- Modify: `src/components/AccountMenu.tsx`, `src/app/(site)/account/page.tsx` (déconnexion)
- Test: `tests/atelier-draft.test.js` (suite, lecture du texte de la page)

**Interfaces:**
- Consumes: `writeAtelierDraft`, `readAtelierDraft`, `clearAtelierDraft` (tâche 3) ; `buildPersistedProjectPayload` ; `hasJobOnScreen` (déjà dans la page).

- [ ] **Step 1: Tests qui échouent** :
  - La page appelle `writeAtelierDraft(window.sessionStorage` dans le nettoyage d'un `useEffect` à dépendances vides, à partir d'une `ref` tenue à jour à chaque rendu.
  - L'écriture est gardée par `hasJobOnScreen` ; sinon `clearAtelierDraft`.
  - L'effet de restauration lit `readAtelierDraft` seulement quand `qatlia_saved_project` est absent, et appelle `clearAtelierDraft` dans les deux cas.
  - Avec un brouillon restauré, l'effet du travail gardé avant connexion s'arrête comme pour un projet rouvert depuis l'historique, sauf si ce travail vient de cet onglet (`isFromThisTab`) : il gagne alors, et le brouillon n'est pas appliqué.
  - `startNewJob` appelle `clearAtelierDraft`.
  - `AccountMenu.tsx` et `account/page.tsx` appellent `clearAtelierDraft(window.sessionStorage)` à côté de `clearPendingWork`.
- [ ] **Step 2: Lancer** — échec attendu.
- [ ] **Step 3: Sortir le corps de la restauration** (aujourd'hui dans le `useLayoutEffect`) en une fonction locale `applySavedProject(parsed, { projectId, localId, restoredAt })`, appelée pour un projet de l'historique comme pour un brouillon. Pour un brouillon : `plannedPiecesRef.current` reçoit `draft.plannedPieces ?? pièces restaurées`, `setCutMode(draft.cutMode)`, et `setRestoredAt` reçoit `draft.restoredAt` (aucune bannière « plan rouvert » pour un plan calculé dans cette session).
- [ ] **Step 4: Écrire au départ.** `project` vient de `buildPersistedProjectPayload` quand un plan est à l'écran ; sans plan, le même objet sans `result`. La miniature du scan (`scanThumb`) est gardée, jamais l'image entière.
- [ ] **Step 5: Lancer la suite entière**, `tsc`, `lint`.
- [ ] **Step 6: Commit** `feat(atelier): quitter l'atelier ne perd plus le débit en cours`, puis PR. Dire dans la PR que l'aller-retour réel n'a pas pu être essayé en local et donner les quatre essais à faire sur l'aperçu : pièces sans plan ; plan calculé ; plan rouvert de l'historique ; « Nouveau débit » puis aller-retour.

---

# Lot 3 — Page « Configuration des panneaux » (PR 3)

Branche `feat/page-panneaux`.

### Task 5: L'API modifie un panneau entier

**Files:**
- Modify: `src/app/api/panel-presets/[id]/route.ts`
- Modify: `src/lib/panel-presets-store.ts`
- Test: `tests/panel-presets.test.js` (ou un nouveau `tests/panel-presets-update-route.test.js` sur le modèle des tests de route existants, avec `tests/helpers/fake-supabase.js`)

**Interfaces:**
- Produces: `PATCH /api/panel-presets/[id]`
  - corps `{ pricePerSheet }` seul : comme aujourd'hui (inchangé, mêmes réponses) ;
  - corps `PresetInputSchema` (avec `name`) : remplace tous les champs du panneau. `pricePerSheet` absent ou `null` efface le prix.
  - Réponses : `200 { success: true, preset }` ; `400 { error: 'INVALID_PRESET' }` ; `404 { error: 'NOT_FOUND' }` (inconnu ou d'un autre compte) ; `409 { error: 'DUPLICATE_PRESET', existingName }` ; `503 { error: 'CLOUD_NOT_READY' | 'PRESETS_UNAVAILABLE' }`.
- Produces dans `panel-presets-store.ts` : `toPresetUpdate(input: PresetInput): Omit<PanelPresetRow, 'id' | 'user_id' | 'created_at'>` (prix toujours présent, `null` quand effacé).

- [ ] **Step 1: Tests qui échouent** : modification complète réussie (les six champs changent, `user_id` et `id` non) ; doublon d'un **autre** panneau du même compte → 409 avec son nom, aucune écriture ; mêmes attributs que lui-même avec un nouveau nom → 200 ; identifiant d'un autre compte → 404, aucune écriture ; hauteur négative, matériau inconnu, nom vide → 400 ; corps `{ pricePerSheet: 450 }` → comportement actuel ; non connecté → 401.
- [ ] **Step 2: Lancer** — échec attendu.
- [ ] **Step 3: Écrire.** Le corps est reconnu par la présence de `name`. Le doublon se cherche avec `findDuplicatePreset` sur `selectUserPresets` privé du panneau modifié. Avant la migration 015 (colonne prix absente) : réessayer sans le prix, comme le `POST`.
- [ ] **Step 4: Relancer** — tout passe.
- [ ] **Step 5: Commit** `feat(panneaux): l'API modifie un panneau entier`.

### Task 6: Modifier un panneau, côté client

**Files:**
- Modify: `src/lib/panel-presets.ts`
- Create: `src/lib/panel-form.ts`
- Test: `tests/panel-presets.test.js`, `tests/panel-form.test.js`

**Interfaces:**
- Produces dans `panel-presets.ts` :
  ```ts
  export type PresetUpdateResult =
    | { ok: true; preset: PanelPreset }
    | { ok: false; error: 'DUPLICATE'; existingName: string }
    | { ok: false; error: 'FAILED' };
  export async function updateAccountPreset(id: string, preset: NewPanelPreset): Promise<PresetUpdateResult>;
  export function updateDevicePreset(id: string, preset: NewPanelPreset): PresetUpdateResult;
  ```
- Produces dans `panel-form.ts` (pur, sans `'use client'`) :
  ```ts
  export const PANEL_NAME_MAX_CHARS = 80;
  export interface PanelFormValues { name: string; height: string; width: string; material: string; color: string; hasGrain: boolean; grainOrientation: GrainOrientation; price: string }
  export type PanelFormError = 'name' | 'height' | 'width' | 'price';
  export const EMPTY_PANEL_FORM: PanelFormValues;
  export function panelToForm(preset: PanelPreset, unit: DisplayUnit): PanelFormValues;
  /** Dimensions typed in `unit` come back in canonical cm; a blank price is no price. */
  export function parsePanelForm(values: PanelFormValues, unit: DisplayUnit): { ok: true; preset: NewPanelPreset } | { ok: false; errors: PanelFormError[] };
  ```
  Bornes : celles de `PresetInputSchema` (`MAX_GEOMETRY`, `isPanelPrice`). La virgule décimale est acceptée (`parseDisplayInputToCanonical`).

- [ ] **Step 1: Tests qui échouent** : `parsePanelForm` (nom vide, 81 caractères, « 244,5 » en cm, « 2440 » en mm → 244 cm, largeur 0, prix « abc », prix vide → pas de prix, ramage décoché → pas de sens) ; aller-retour `panelToForm` → `parsePanelForm` ; `updateDevicePreset` (modifie, refuse le doublon d'un autre, accepte le renommage seul, identifiant inconnu → `FAILED`) ; `updateAccountPreset` avec un `fetch` simulé (200, 409 avec `existingName`, 503, exception réseau).
- [ ] **Step 2: Lancer** — échec attendu.
- [ ] **Step 3: Écrire les deux modules.**
- [ ] **Step 4: Relancer** — tout passe.
- [ ] **Step 5: Commit** `feat(panneaux): modifier un panneau enregistré`.

### Task 7: Le hook `usePanelPresets`

**Files:**
- Create: `src/lib/use-panel-presets.ts`
- Test: `tests/use-panel-presets.test.js` (lecture du texte : le hook ne s'exécute pas sous `node:test`)

**Interfaces:**
- Consumes: tout `panel-presets.ts`, `createClient` de `@/lib/supabase/client`.
- Produces:
  ```ts
  export type PresetWriteError = 'DUPLICATE' | 'LIMIT' | 'FAILED';
  export interface PanelPresetsState {
    presets: PanelPreset[];
    /** 'device' while signed out, or while the account store cannot be reached. */
    source: 'device' | 'account';
    signedIn: boolean;
    ready: boolean;
    add(preset: NewPanelPreset): Promise<{ ok: true } | { ok: false; error: PresetWriteError; existingName?: string }>;
    update(id: string, preset: NewPanelPreset): Promise<{ ok: true } | { ok: false; error: PresetWriteError; existingName?: string }>;
    remove(id: string): Promise<boolean>;
  }
  export function usePanelPresets(): PanelPresetsState;
  ```
  Chargement : celui de l'atelier aujourd'hui (liste de l'appareil d'abord, puis `fetchAccountPresets`, `importDevicePresetsOnce` à la première visite connectée). L'atelier garde son propre code dans ce lot ; il passera au hook au lot 4.

- [ ] **Step 1: Tests qui échouent** : le fichier commence par `'use client'` ; il appelle `loadSavedPresets`, `fetchAccountPresets`, `importDevicePresetsOnce` ; `add` cherche le doublon avec `findDuplicatePreset` avant d'écrire ; chaque écriture choisit entre compte et appareil selon `source`.
- [ ] **Step 2 à 4:** échec, écriture, succès.
- [ ] **Step 5: Commit** `feat(panneaux): hook de la liste des panneaux`.

### Task 8: La page `/panels` et la troisième entrée

**Files:**
- Create: `src/app/(site)/panels/page.tsx`, `src/components/panels/PanelForm.tsx`, `src/components/panels/PanelRow.tsx`
- Modify: `src/components/WorkspaceNav.tsx` (troisième entrée), `src/lib/seo.ts` (`PRIVATE_ROUTES`), `src/i18n/messages/{fr,en,ar}.ts` (espace `panelsPage`), `src/i18n/domain.ts` ou un module voisin (sortir `STOCK_MATERIAL_VALUES` de `atelier/page.tsx` pour le partager)
- Test: `tests/panels-page.test.js`, `tests/workspace-nav.test.js`, `e2e/panels.spec.ts` (écrit, non lancé)

**Interfaces:**
- Consumes: `usePanelPresets` (tâche 7), `parsePanelForm`, `panelToForm`, `EMPTY_PANEL_FORM` (tâche 6), `WorkspaceNav`, `BUILT_IN_PRESETS`.
- Produces:
  ```ts
  export function PanelForm(props: { initial: PanelFormValues; unit: DisplayUnit; submitLabel: string; busy: boolean; error: string | null; onSubmit(preset: NewPanelPreset): void; onCancel?: () => void }): JSX.Element;
  export function PanelRow(props: { preset: PanelPreset; unit: DisplayUnit; onEdit(): void; onDelete(): void }): JSX.Element;
  ```
- Textes français de la page (les deux autres langues suivent) : titre « Configuration des panneaux » ; sous-titre « La liste des panneaux avec lesquels vous travaillez. Vous les retrouvez dans l'atelier, au moment de choisir le panneau d'un débit. » ; « Ajouter un panneau » ; « Tailles standards » ; « Enregistrer » ; « Annuler » ; « Modifier » ; « Supprimer » ; « Supprimer ce panneau ? » ; liste vide : « Aucun panneau enregistré. Ajoutez le premier : vous n'aurez plus à ressaisir ses dimensions. » ; sans compte : « Cette liste est gardée sur cet appareil. Connectez-vous pour la retrouver partout. » ; doublon, limite et échec : réutiliser `atelier.stock.presetDuplicate`, `presetLimit`, `presetSaveFailed`.

- [ ] **Step 1: Tests qui échouent** :
  - `WorkspaceNav` : trois entrées, la troisième vers `/panels`.
  - `PanelRow` rendu : nom dans un `truncate` avec `dir="auto"`, dimensions dans l'unité demandée en `dir="ltr"`, matériau, couleur, ramage, prix quand il existe ; boutons « Modifier » et « Supprimer » avec un `aria-label` qui nomme le panneau.
  - `PanelForm` rendu avec `initial` : chaque champ a son `<label>`, le nom porte `maxLength={80}`, la couleur `maxLength={60}`, le sens du ramage n'apparaît que si le ramage est coché.
  - Texte de la page : `<WorkspaceNav current="panels"`, `usePanelPresets()`, `readStoredDisplayUnit`, une pastille par `BUILT_IN_PRESETS`, suppression en deux temps (état `confirming` avec délai, comme `confirmingNewJob`).
  - `PRIVATE_ROUTES` contient `'/panels'`.
  - Toutes les clés `panelsPage.*` existent dans les trois langues.
- [ ] **Step 2: Lancer** — échec attendu.
- [ ] **Step 3: Écrire la page.** En-tête identique à celui de l'historique après le lot 1 (logo, titre, langue, crédits, compte). Une colonne sur téléphone ; à partir de `lg`, formulaire d'ajout à gauche et liste à droite. Modifier ouvre le formulaire à la place de la ligne. Bascule cm / mm en tête de liste.
- [ ] **Step 4: Relancer**, puis suite entière, `tsc`, `lint`.
- [ ] **Step 5: Vérifier le rendu** de `PanelRow` et `PanelForm` à 360, 390 et 1366 px, en français et en arabe, avec un nom de 80 caractères.
- [ ] **Step 6: Commit** `feat(panneaux): page « Configuration des panneaux »`, puis PR.

---

# Lot 4 — Carte du panneau allégée dans l'atelier (PR 4)

Branche `feat/carte-panneau-allegee`.

### Task 9: « Gérer » mène à la page, la liste repliée disparaît

**Files:**
- Modify: `src/app/(site)/atelier/page.tsx` (carte `#stock-card`, état des panneaux enregistrés)
- Modify: `src/i18n/messages/{fr,en,ar}.ts`
- Test: `tests/atelier-layout.test.js`, `tests/artisan-prices.test.js` si un de ses tests lit la liste repliée

**Interfaces:**
- Consumes: `usePanelPresets` (tâche 7).

- [ ] **Step 1: Tests qui échouent** :
  - La carte contient `<Link href="/panels"` avec `t('atelier.stock.managePresets')`, affiché même quand la liste est vide.
  - La page ne contient plus `data-testid="preset-manager"`, `isPresetManageOpen`, `handlePresetPrice`, `handleDeletePreset`.
  - La page lit sa liste par `usePanelPresets()` et ne contient plus `fetchAccountPresets`, `importDevicePresetsOnce`.
  - Le sélecteur de panneaux, « Sauvegarder », le champ « Nom pour la sauvegarde » et les champs hauteur, largeur, matériau sont toujours dans `#stock-card`.
  - `atelier.stock.managePresets` vaut « Gérer mes panneaux » / « Manage my panels » / « إدارة ألواحي ».
- [ ] **Step 2: Lancer** — échec attendu.
- [ ] **Step 3: Modifier la carte.** Retirer les clés de traduction devenues inutiles (`presetPricePlaceholder`, `presetPriceAria`, `presetPriceSaved`, `presetDeleted`, `deletePresetAria`) seulement si plus rien ne les lit.
- [ ] **Step 4: Suite entière**, `tsc`, `lint`.
- [ ] **Step 5: Commit** `feat(atelier): la liste des panneaux se gère sur sa page`, puis PR.
