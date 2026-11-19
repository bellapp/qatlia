# WhatsApp — lecture des fiches de débit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a prospect sends a photo of a cut list to the WhatsApp bot, read it, reply with a summary (pieces, panels, waste, panel used, first lines) and a short link that opens the atelier pre-filled; one successful read per number.

**Architecture:** Two PRs, both against `main`. PR A (Task 1) only learns whether our Meta token can download inbound media: it keeps the media id and logs the outcome of a download attempt, no behaviour change. PR B (Tasks 2–6) is the feature: a shared cut-list reader extracted from `/api/vision`, a `whatsapp_photo_reads` table (migration 019) that reserves the one read per number, a photo flow module called by the webhook, and a `/w/[code]` page that hands the pieces to the atelier through its existing draft mechanism.

**Tech Stack:** Next.js 14.2 app router, Supabase (service role), Meta Graph API (media), YCloud (sending, unchanged), OpenRouter/OpenAI vision (unchanged), `node --test` with `loadTsModule` / `stubModule`.

**Spec:** `docs/superpowers/specs/2026-11-19-whatsapp-lecture-photo-design.md`

## Global Constraints

- Production is live: every change ships through a PR to `main`, never stacked; full suite `node --test tests/*.test.js` must show only the 10 failures `main` already has (catalogues / CRLF / benchmark).
- `/api/vision` keeps its exact prompt, responses (no `sheet` field), status codes and billing.
- The photo is never stored; pieces/sheet/summary are nulled 7 days after the read (`expires_at = created_at + 7 days`).
- One successful read per WhatsApp number, forever. At most 3 `failed` reads per number per 24 h. Global cap: rows created in the last 24 h (any status) < `WHATSAPP_PHOTO_DAILY_CAP` (default `300`; `0` turns the feature off).
- A `reading` row older than 2 minutes counts as failed.
- Default panel: `DEFAULT_STOCK_SHEET` (278 × 208 cm, MDF) unless the sheet states one. The reply always names the panel used.
- Link: `https://qatlia.ma/w/<code>?utm_source=whatsapp&utm_medium=bot&utm_campaign=photo`; code ≥ 10 characters, random, alphabet `abcdefghijkmnpqrstuvwxyz23456789`.
- Media: image/jpeg, image/png, image/webp only, ≤ 5 MB (`5 * 1024 * 1024` bytes).
- Nothing sensitive is logged: no token, no message text, no phone number, no image bytes.
- Lint changed files with `npx eslint --no-eslintrc -c .eslintrc.json <files>` (nested worktree); type-check with `npx tsc --noEmit -p .`.
- Secrets never in the repo or the conversation; new env var `WHATSAPP_PHOTO_DAILY_CAP` is optional (defaults apply).

## Review Focus

- A burst of 2–3 photos sent at once by one prospect: exactly one read, one "Je lis votre fiche…", the others silent (no double AI call). → Task 3 (`busy` on unique violation) and Task 5 test.
- Migration 019 not applied when PR B deploys: photos get today's `imageHint`, nothing throws, the 016 "tables missing" path is not triggered. → Task 3 (`unavailable`) and Task 5 test.
- A piece larger than the panel (e.g. 300 × 50 on 278 × 208): the summary still answers, counting it as unplaced, never crashes. → Task 4 test.
- A cut list whose first message is the photo itself (no greeting yet): photo read, no menu sent, contact marked greeted. → Task 5 route test.
- An expired or unknown `/w/` code: a plain "lien expiré" page with a button to the atelier, never a 500. → Task 6 test.

---

## PR A

### Task 1: Keep the media id and probe the download

**Files:**
- Modify: `src/lib/whatsapp/payload.ts` (messageSchema `image`, `InboundEvent`, `toInbound` around lines 20–130)
- Create: `src/lib/whatsapp/media.ts`
- Modify: `src/app/api/whatsapp/webhook/route.ts` (`handleInbound`, right after `claimInbound` succeeds)
- Test: `tests/whatsapp-media.test.js` (new), `tests/whatsapp-webhook-parsing.test.js`, `tests/whatsapp-webhook-route.test.js`

**Interfaces:**
- Produces: `InboundEvent.mediaId: string | null` (the image `id`; null for other kinds).
- Produces, in `media.ts`:
  ```ts
  export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
  export type MediaResult =
    | { ok: true; dataUrl: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; bytes: number }
    | { ok: false; reason: 'lookup_refused' | 'lookup_failed' | 'download_failed' | 'too_large' | 'bad_type'; status?: number };
  export async function fetchMediaDataUrl(config: WhatsAppConfig, mediaId: string, fetchImpl?: typeof fetch): Promise<MediaResult>;
  ```

- [ ] **Step 1: Failing tests.**
  - Parsing: an image message `{ type:'image', id:'wamid.X', from, image:{ id:'MEDIA1', mime_type:'image/jpeg', caption:'fiche' } }` gives `mediaId === 'MEDIA1'` and `text === 'fiche'`; a text message gives `mediaId === null`.
  - Media, with a stub `fetchImpl` recording calls:
    - lookup `GET https://graph.facebook.com/v23.0/MEDIA1` with header `Authorization: Bearer <accessToken>` → `{ url:'https://lookaside.example/x', mime_type:'image/jpeg', file_size: 3 }`; download of that url with the same header → 3 bytes → `{ ok:true, mimeType:'image/jpeg', bytes:3, dataUrl:'data:image/jpeg;base64,' + base64 }`.
    - lookup answers 400 with `{ error: { code: 10 } }` or 403 → `{ ok:false, reason:'lookup_refused', status }`.
    - lookup 500 or network throw → `lookup_failed`; download non-2xx → `download_failed`.
    - `file_size` > `MAX_MEDIA_BYTES`, or downloaded length > it → `too_large`; `mime_type:'image/gif'` → `bad_type`.
  - Route: an image event calls `fetchMediaDataUrl` once with `mediaId` and still sends today's `imageHint` (stub `@/lib/whatsapp/media`); a text event never calls it.
- [ ] **Step 2:** `node --test tests/whatsapp-media.test.js tests/whatsapp-webhook-parsing.test.js tests/whatsapp-webhook-route.test.js` → the new tests FAIL.
- [ ] **Step 3: Implement.** Schema `image: { caption, id, mime_type }` (all optional). `fetchMediaDataUrl` uses `config.graphVersion` and `config.accessToken`; no retry. In the route, for `event.kind === 'image' && event.mediaId`, call it inside try/catch and log only `console.log('[whatsapp] media probe', result.ok ? 'ok' : result.reason, result.ok ? result.bytes : result.status ?? '')`. Nothing else in the route changes.
- [ ] **Step 4:** same command → PASS; full suite → only the 10 baseline failures; tsc and eslint clean.
- [ ] **Step 5: Commit, push, open PR A** (`feat(whatsapp): garder l'id des photos et tester leur téléchargement`). Body says it is a probe with no visible change.
- [ ] **Step 6: Gate (with the owner).** After merge and deploy, the owner sends one photo to the bot; within a minute run `vercel logs qatlia.ma | grep "media probe"`.
  - `ok <bytes>` → go on to PR B.
  - `lookup_refused` → stop. Report to the owner: Meta refuses our token for media too; the next option is YCloud (its media API, or its inbound webhook), which is outside this plan.

## PR B (from `main` after PR A is merged and the gate passed)

### Task 2: Shared cut-list reader

**Files:**
- Create: `src/lib/vision/read-cut-list.ts`
- Modify: `src/app/api/vision/route.ts` (move `extractJson`, the system prompt, the model call and the piece normalisation out; keep auth, rate limit, demo mode, billing, scan groups and every response in the route)
- Test: `tests/vision-read-cut-list.test.js` (new); existing `tests/vision-edge-marks.test.js` and other `/api/vision` tests must pass unchanged.

**Interfaces:**
- Produces:
  ```ts
  export interface ReadPiece { name: string; height: number; width: number; quantity: number; edges?: EdgeBandingConfig }
  export interface ReadSheet { height: number; width: number }
  export type ReadResult =
    | { status: 'ok'; pieces: ReadPiece[]; sheet: ReadSheet | null }
    | { status: 'unreadable' }
    | { status: 'unavailable' }                       // no provider key configured
    | { status: 'error'; rateLimited: boolean; httpStatus: number };
  export async function readCutList(imageDataUrl: string, options?: { readPanel?: boolean }): Promise<ReadResult>;
  ```
  Uses the global `fetch` and the same env (`OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_MODEL`) and request body as today.

- [ ] **Step 1: Failing tests** (stub `globalThis.fetch`):
  - default options: the system prompt sent is byte-identical to today's (snapshot the string before moving it), result `{ status:'ok', sheet:null, pieces }` with today's normalisation (a "Pièce 3" name becomes `''`, quantity ≥ 1, edges from counts);
  - `readPanel: true`: the system prompt is today's plus one extra instruction mentioning the panel size and `"sheet"`; a model answer `{ "sheet": { "height": 280, "width": 207 }, "pieces": [...] }` → `sheet: { height:280, width:207 }`; a sheet with a non-positive or non-numeric side → `sheet: null`;
  - `readPanel` absent: a `sheet` in the model answer is ignored (`sheet: null`);
  - empty `pieces` or unparsable JSON → `unreadable`; upstream 429 or a body containing "rate limit" → `error` with `rateLimited:true`; other non-2xx → `error`, `rateLimited:false`; no key → `unavailable`.
- [ ] **Step 2:** run `node --test tests/vision-read-cut-list.test.js` → FAIL.
- [ ] **Step 3:** implement `readCutList`; rewrite the route to call it and map `unreadable` → today's 422 `AI_PARSE_ERROR`, `error` → today's 429 `AI_RATE_LIMIT` / 502 `AI_SERVICE_ERROR`, `unavailable` → today's production 503 / demo branch. The route never forwards `sheet`.
- [ ] **Step 4:** `node --test tests/vision-*.test.js tests/vision-read-cut-list.test.js` → PASS (existing vision tests untouched).
- [ ] **Step 5:** commit `refactor(vision): lecture de fiche partagée, réponse du site inchangée`.

### Task 3: Migration 019 and the photo-read store

**Files:**
- Create: `supabase/migrations/019_whatsapp_photo_reads.sql`
- Create: `src/lib/whatsapp/photo-store.ts`
- Test: `tests/whatsapp-sql.test.js` (add 019 checks), `tests/whatsapp-photo-store.test.js` (new, with `tests/helpers/fake-supabase.js`)

**Interfaces:**
- Table `public.whatsapp_photo_reads`: `id UUID PK DEFAULT gen_random_uuid()`, `wa_id TEXT NOT NULL REFERENCES whatsapp_contacts(wa_id) ON DELETE CASCADE`, `status TEXT NOT NULL CHECK (status IN ('reading','ok','failed'))`, `code TEXT UNIQUE`, `pieces JSONB`, `sheet JSONB`, `summary JSONB`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `expires_at TIMESTAMPTZ`, `opened_at TIMESTAMPTZ`. Unique partial index on `(wa_id) WHERE status IN ('reading','ok')`; index on `(created_at)`. RLS on, no policy, `REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT ALL … TO service_role` (as 016).
- Produces:
  ```ts
  export const PHOTO_READ_TTL_DAYS = 7;
  export const STALE_READING_MS = 2 * 60 * 1000;
  export const MAX_FAILED_READS_PER_DAY = 3;
  export interface PhotoSummary { pieceCount: number; lineCount: number; sheetsUsed: number; wastePercent: number; sheet: ReadSheet; unplaced: number }
  export type Reservation =
    | { status: 'reserved'; id: string }
    | { status: 'already'; code: string | null }     // code null when expired
    | { status: 'busy' }                              // another read of this number is running
    | { status: 'too_many_failures' } | { status: 'daily_cap' } | { status: 'unavailable' };
  export async function reservePhotoRead(db: SupabaseClient, waId: string, now: Date, dailyCap: number): Promise<Reservation>;
  export async function completePhotoRead(db: SupabaseClient, id: string, result: { code: string; pieces: ReadPiece[]; sheet: ReadSheet | null; summary: PhotoSummary; now: Date }): Promise<void>;
  export async function failPhotoRead(db: SupabaseClient, id: string): Promise<void>;
  export type PhotoDraft = { pieces: ReadPiece[]; sheet: ReadSheet };   // sheet = the one used for the summary
  export async function openPhotoDraft(db: SupabaseClient, code: string, now: Date): Promise<PhotoDraft | 'expired' | null>;
  export function newPhotoCode(): string;   // 10 chars from the Global Constraints alphabet, crypto random
  ```
  `reservePhotoRead` order: `dailyCap <= 0` → `daily_cap`; existing `ok` row → `already` (code, or null if `expires_at <= now`); `reading` row younger than `STALE_READING_MS` → `busy`, older → set it `failed` and continue; ≥ 3 `failed` rows in 24 h → `too_many_failures`; ≥ `dailyCap` rows in 24 h → `daily_cap`; insert `reading` → `reserved`, unique violation `23505` → `busy`. Error code `PGRST205` / `42P01` anywhere → `unavailable` (never throws `WhatsAppTablesMissingError`). `openPhotoDraft`: unknown → null; expired → null out `pieces/sheet/summary` and return `'expired'`; first open sets `opened_at`.

- [ ] **Step 1: Failing tests.** SQL: the file creates the table, the CHECK, the partial unique index, RLS, revokes and grants. Store, one test per branch above, including: `23505` on insert → `busy`; `PGRST205` on the first select → `unavailable`; `completePhotoRead` writes `status:'ok'`, the code, and `expires_at = now + 7 days`; `openPhotoDraft` sets `opened_at` only when it was null; `newPhotoCode()` matches `/^[a-hj-np-z2-9]{10}$/` and 1 000 calls give 1 000 distinct codes.
- [ ] **Step 2:** run them → FAIL.
- [ ] **Step 3:** write the migration and the store (one query per check; filters as in the spec, the fake only records them).
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5:** commit `feat(whatsapp): table des lectures photo (migration 019)`.

### Task 4: Summary and reply texts

**Files:**
- Create: `src/lib/whatsapp/photo-summary.ts`
- Modify: `src/lib/whatsapp/copy.ts` (new entries, fr + ar)
- Test: `tests/whatsapp-photo-summary.test.js` (new)

**Interfaces:**
- Produces:
  ```ts
  export function summarizeCutList(pieces: ReadPiece[], sheet: ReadSheet | null): PhotoSummary;
  export function photoLink(code: string): string;   // exact URL of Global Constraints
  export function photoResultText(lang: Lang, summary: PhotoSummary, pieces: ReadPiece[], link: string): string;
  ```
  `summarizeCutList` runs `optimizeCutting2D` (`src/lib/cutting/binpacking.ts`) with pieces as `{ ...p, material:'mdf', rotatable:true }` and one stock sheet `{ ...DEFAULT_STOCK_SHEET, height, width }` (stated sheet, or default). `wastePercent = Math.round(result.wastePercentage)`, `unplaced = result.unplacedPieces.length`, `pieceCount` = sum of quantities, `lineCount = pieces.length`.
  `copy.ts` adds `photoReading`, `photoAlready` (with and without link), `photoAlreadyNoLink`, each `Record<Lang, string>`. `photoResultText` shape (fr): line 1 `✅ {pieceCount} pièces lues · {sheetsUsed} panneau(x) {h}×{w} · {wastePercent} % de chute`; line 2 the first 5 lines as `{name or "Pièce n"} {h} × {w} ×{qty}` joined by ` · `, plus ` … (+{n} autres)` when more; when `unplaced > 0` a line saying {unplaced} pièce(s) plus grande(s) que le panneau; last line `👉 Voir le plan complet (après inscription) : {link}`. Arabic mirrors it, using « كريدي » rule if credits are mentioned (they are not). Decimal comma in fr (41,8).

- [ ] **Step 1: Failing tests:** default sheet when `null` (summary.sheet = 278×208); stated 244×122 used; 14 lines → 5 shown and `(+9 autres)`; a 300 × 50 piece → `unplaced: 1` and the warning line, no throw; `photoLink('k7m2qx9dab')` equals the exact URL; fr text contains `278×208` and the link; ar text contains the link and no French words from the fr template.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS.
- [ ] **Step 5:** commit `feat(whatsapp): résumé de fiche et textes de réponse`.

### Task 5: Photo flow, router and webhook

**Files:**
- Create: `src/lib/whatsapp/photo.ts`
- Modify: `src/lib/whatsapp/router.ts` (`Decision`, `decide`)
- Modify: `src/app/api/whatsapp/webhook/route.ts` (`deliver` kinds, `handleInbound`; remove the Task 1 probe log)
- Modify: `src/lib/whatsapp/config.ts` (read `WHATSAPP_PHOTO_DAILY_CAP`, default 300, non-integer → 300)
- Test: `tests/whatsapp-photo.test.js` (new), `tests/whatsapp-router.test.js`, `tests/whatsapp-webhook-route.test.js`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  ```ts
  // router.ts
  export type Decision = … | { action: 'photo' };
  // photo.ts
  export type PhotoOutcome = 'handled' | 'hint' | 'silent';
  export async function handlePhoto(input: {
    db: SupabaseClient; config: WhatsAppConfig; event: InboundEvent; lang: Lang; now: Date;
    deliver: (text: string, kind: 'photo_reading' | 'photo_result' | 'photo_already') => Promise<boolean>;
  }): Promise<PhotoOutcome>;
  // config.ts
  WhatsAppConfig.photoDailyCap: number
  ```
  `decide`: after step 3 (menu choices) and before step 4 (greeting): `if (event.kind === 'image') return { action: 'photo' };` (old step 6 removed).
  `handlePhoto`: no `mediaId` → `hint`. `reservePhotoRead(…, config.photoDailyCap)`: `busy` → `silent`; `already` → send `photoAlready` (with the link if `code`) unless a `photo_already` was sent to this number in the last 10 minutes (`countBotMessages`) → `handled`/`silent`; `too_many_failures` / `daily_cap` / `unavailable` → `hint`. `reserved` → deliver `photoReading`; `fetchMediaDataUrl`; `readCutList(dataUrl, { readPanel: true })`; any failure → `failPhotoRead` + `hint`; success → `summarizeCutList`, `newPhotoCode`, `completePhotoRead` (summary.sheet as the stored sheet), deliver `photoResultText` → `handled`. Any thrown error after reservation → `failPhotoRead` (caught) and `hint`.
  Route: on `decision.action === 'photo'`: `const outcome = await handlePhoto(…)`; `hint` → today's imageHint path (same 10-minute `image_hint` cooldown, kind `image_hint`); after `handled` or `hint`, if `contact.greetedAt === null`, `updateContact(db, waId, { greetedAt: now })`.

- [ ] **Step 1: Failing tests.**
  - Router: an image from a contact not greeted → `{ action:'photo' }`; an image during a human hand-off → `silent`; an image carrying an ad referral → `photo`; menu-choice text still wins over the greeting.
  - Photo flow (stub `photo-store`, `media`, `read-cut-list`): happy path → deliveries `[photo_reading, photo_result]`, `completePhotoRead` once with a code matching the alphabet; `busy` → no delivery, no read, `silent`; `already` with code → one `photo_already` containing `photoLink(code)`, no `readCutList` call; `already` twice within 10 minutes → second `silent`; media `lookup_refused` → `failPhotoRead`, `hint`; `readCutList` `unreadable` → `failPhotoRead`, `hint`; `unavailable` reservation → `hint`, no media fetch; `readCutList` throws → `failPhotoRead`, `hint`.
  - Route (stub `@/lib/whatsapp/photo`): image + `hint` → today's imageHint text, and the cooldown still applies; first message is an image → `handlePhoto` called, no greeting sent, contact updated with `greetedAt`; `handled` → nothing else sent. Existing image tests updated to go through the stub.
- [ ] **Step 2:** run the three files → FAIL.
- [ ] **Step 3:** implement as specified.
- [ ] **Step 4:** run → PASS; full suite → only the 10 baseline failures.
- [ ] **Step 5:** commit `feat(whatsapp): lire la photo de la fiche et répondre le résumé`.

### Task 6: `/w/[code]` page and docs

**Files:**
- Create: `src/app/(site)/w/[code]/page.tsx` (server: `getAdminDb` + `openPhotoDraft`), `src/app/(site)/w/[code]/OpenInAtelier.tsx` (client)
- Modify: `docs/whatsapp-bot.md` (section « Lecture photo »)
- Test: `tests/whatsapp-photo-link.test.js` (new)

**Interfaces:**
- Consumes: `openPhotoDraft` (Task 3), `writeAtelierDraft` / `AtelierDraft` (`src/lib/atelier-draft.ts`).
- Produces: `export function photoDraftToAtelierDraft(draft: PhotoDraft, now: number): AtelierDraft` in `src/lib/whatsapp/photo-summary.ts`: `project = { pieces (with ids '1'…'n', material 'mdf', rotatable true), sheets: [{ ...DEFAULT_STOCK_SHEET, height, width }], projectName: 'Fiche WhatsApp' }`, `plannedPieces: null`, `cutMode: '2d'`, `projectId: null`, `localProjectId: null`, `restoredAt: null`, `keptAt: now`.
  Page: `dynamic = 'force-dynamic'`; code not matching the alphabet/length or `null` → expired view; `'expired'` → expired view (« Ce lien a expiré » + button `/atelier`); a draft → `<OpenInAtelier draft={…} />`, which on mount calls `writeAtelierDraft(sessionStorage, photoDraftToAtelierDraft(draft, Date.now()))` then `router.replace('/atelier')`, showing « Ouverture de votre fiche… » meanwhile. The query string (utm) is left on the `/w/` URL so `ClientShell` records it before the redirect.

- [ ] **Step 1: Failing tests:** `photoDraftToAtelierDraft` output shape and values above; the result passes `readAtelierDraft` after `writeAtelierDraft` into a fake storage (round trip); page module with stubbed `openPhotoDraft`: `null` and `'expired'` render the expired text, a malformed code never calls the store.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run → PASS; full suite → 10 baseline failures; tsc, eslint clean.
- [ ] **Step 5:** docs: migration 019 to apply in Supabase **before** merging PR B; `WHATSAPP_PHOTO_DAILY_CAP`; SQL to follow reads (`select status, count(*) from whatsapp_photo_reads where created_at > now() - interval '7 days' group by 1`), links opened (`opened_at is not null`), and sign-ups (`raw_user_meta_data->>'signup_campaign' = 'photo'`).
- [ ] **Step 6:** commit, push, open PR B (`feat(whatsapp): lecture des fiches envoyées en photo`), body lists: migration 019 first, the copy in fr/ar to proofread, the gate result from Task 1.
