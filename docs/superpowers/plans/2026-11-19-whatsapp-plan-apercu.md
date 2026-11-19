# WhatsApp link — plan preview before sign-up — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `/w/<code>` link opens the atelier with the cutting plan already drawn (free preview); signing in or being signed in runs the normal paid optimization automatically; links expire after 24 h.

**Architecture:** The `/w` server page computes the preview with `optimizeCutting2D` from the stored pieces and passes it to the client, which writes it into the atelier draft with a `photoPreview: true` marker. The atelier restores it like a reopened plan; a small pure helper decides, from the marker and the sign-in state, whether to auto-run the paid optimization or show the sign-up banner. Sign-up reuses `askSignInKeepingWork('optimize')`, which already survives the Google round trip.

**Tech Stack:** Next.js 14.2, React client components, Supabase auth, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-19-whatsapp-plan-apercu-design.md`

## Global Constraints

- Link and stored content expire 24 h after the read (`expires_at = now + 24 h`).
- Preview: computed server-side from the stored pieces only, never from client input; no `/api/optimize` call, no credit.
- Signed in (on arrival, or after sign-up): exactly one normal `/api/optimize` run, charged as usual (1 credit, analysis pass).
- PDF, quote and the banner button, for a signed-out visitor on a preview, go through `askSignInKeepingWork('optimize')`.
- All new UI text through the i18n catalogs (fr, ar, en); `tests/i18n-coverage.test.js` must stay clean.
- PR to `main`, full suite with only the 10 baseline failures; lint with `--no-eslintrc -c .eslintrc.json`.

## Review Focus

- A preview whose result does not fit sessionStorage: the atelier still opens with the pieces (draft kept without plan), no crash. → Task 2 test (`writeAtelierDraft` returns `without-plan`, pieces kept).
- A signed-in visitor with 0 credits: the auto-run shows the usual insufficient-credits message, the preview plan stays on screen. → reviewer check of Task 3 wiring (existing atelier error path).
- The auto-run firing twice (StrictMode double effect, or remount): one `/api/optimize` call. → Task 3: the marker is consumed in a ref before the run.
- A draft restored from history or a normal kept job: never treated as a preview. → Task 2 test (`isPhotoPreview` false without the marker).
- The 24 h boundary: a link opened at 23 h 59 works, at 24 h 01 shows "expiré". → Task 1 test.

---

### Task 1: 24-hour expiry

**Files:** Modify `src/lib/whatsapp/photo-store.ts`, `docs/whatsapp-bot.md`; Test `tests/whatsapp-photo-store.test.js`

**Interfaces:** Produces `PHOTO_READ_TTL_HOURS = 24` (replaces `PHOTO_READ_TTL_DAYS`).

- [ ] Step 1: change the completion test to expect `expires_at = now + 24 h`; add a boundary test: `openPhotoDraft` with `expires_at = now + 1 min` → draft, `now - 1 min` → `'expired'`.
- [ ] Step 2: run `node --test tests/whatsapp-photo-store.test.js` → FAIL on the 24 h value.
- [ ] Step 3: implement; docs: "7 jours" → "24 h" in the « Lecture photo » section.
- [ ] Step 4: run → PASS. Step 5: commit `feat(whatsapp): lien de fiche valable 24 h`.

### Task 2: Preview computed server-side and carried in the draft

**Files:** Modify `src/lib/whatsapp/photo-summary.ts`, `src/app/(site)/w/[code]/page.tsx`, `src/app/(site)/w/[code]/OpenInAtelier.tsx`; Test `tests/whatsapp-photo-link.test.js`

**Interfaces:**
- `export function atelierPieces(draft: PhotoDraft): Piece[]` — ids `'1'…'n'`, `material: 'mdf'`, `rotatable: true` (shared by preview and draft so placed pieces match).
- `export function photoPreviewPlan(draft: PhotoDraft): OptimizationResult` — `optimizeCutting2D(atelierPieces(draft), [{ ...DEFAULT_STOCK_SHEET, height, width }])`.
- `photoDraftToAtelierDraft(draft, now, displayUnit = 'cm', result: OptimizationResult | null = null): AtelierDraft` — adds `project.result` when given and `project.photoPreview: true` always.
- `export function isPhotoPreview(project: unknown): boolean` — true only for an object with `photoPreview === true`.

- [ ] Step 1: tests: preview result passes `pickRestorableResult` (`src/lib/projects/restore.ts`) and its placed pieces reference the draft's piece ids; draft carries `result` and `photoPreview: true`; `isPhotoPreview` false for `{}`, `null`, `{ photoPreview: 'yes' }`; a tiny-quota storage makes `writeAtelierDraft` return `'without-plan'` and the pieces survive.
- [ ] Step 2: run → FAIL. Step 3: implement; the page computes `photoPreviewPlan` and passes it as a prop. Step 4: run → PASS. Step 5: commit `feat(whatsapp): aperçu du plan calculé pour le lien`.

### Task 3: Atelier — auto-run when signed in, banner when not

**Files:** Modify `src/app/(site)/atelier/page.tsx`, `src/i18n/messages/{fr,ar,en}.ts`; Create `src/lib/whatsapp/photo-preview.ts`; Test `tests/whatsapp-photo-preview.test.js`

**Interfaces:**
- `export function photoPreviewStep(input: { preview: boolean; signedIn: boolean | null }): 'run' | 'banner' | 'wait' | 'none'` — `none` without preview, `wait` while sign-in unknown (`null`), `run` signed in, `banner` signed out.
- i18n: `atelier.photoPreview.banner` « 📄 Créez votre compte gratuit pour télécharger le PDF et enregistrer votre plan », `atelier.photoPreview.cta` « Créer mon compte gratuit » (+ ar, en).

- [ ] Step 1: tests for `photoPreviewStep` (four cases).
- [ ] Step 2: run → FAIL. Step 3: implement the helper; in the atelier:
  - at restore, `photoPreviewRef.current = isPhotoPreview(draft.project)`;
  - resolve the sign-in once (`getUser`). For `run`: clear the ref, then `setResumeRequest({ action: 'optimize', resumed: true })`. For `banner`: `setShowPhotoBanner(true)`;
  - banner button, and `handleDownloadPdf` / quote `onRequireAuth` while `showPhotoBanner`, call `askSignInKeepingWork('optimize')`;
  - a successful optimization hides the banner.
- [ ] Step 4: run the new test plus `tests/i18n-*.test.js` and `tests/atelier-*.test.js` → PASS (baseline failures only). Step 5: commit `feat(atelier): plan du lien WhatsApp en aperçu, optimisation à la connexion`.
