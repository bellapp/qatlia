# Identité de l'entreprise sur les documents imprimés — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'artisan renseigne une fois son entreprise (nom, logo, coordonnées) dans Mon compte ; le plan de débit et le devis l'impriment, QatliA passe en petit pied de page.

**Architecture:** Une table `ateliers` (une ligne par compte, logo en data URL validée) lue/écrite uniquement par le serveur avec la service role. `/api/atelier` (GET/PUT) pour l'interface ; `/api/export-pdf` relit l'entreprise depuis la session ; le devis la reçoit pré-remplie dans le formulaire. Les noms de fichiers sont décidés par le serveur (`Content-Disposition`) et repris par le client.

**Tech Stack:** Next.js App Router, Supabase (service role), Zod, jsPDF, tests `node --test` + `tests/helpers/load-ts-module.js` / `stub-module.js`.

**Spec:** `docs/superpowers/specs/2026-11-23-atelier-identite-design.md`

## Global Constraints

- Production en ligne : migration additive seulement ; toute erreur de lecture de `ateliers` = « pas d'entreprise », jamais une erreur 500 sur un export.
- `ateliers` : accès **uniquement** via `getSupabaseAdminConfig()` (src/lib/billing/config.ts) + `.eq('user_id', user.id)`. **Aucun repli** sur le client de session.
- Compte sans entreprise : le PDF du plan de débit est **identique** à aujourd'hui (en-tête QatliA, numéro de page dans l'en-tête, pas de pied de page, nom `QatliA_<PROJET>.pdf`).
- Libellé à l'écran : « Mon entreprise » / « My business » / « مؤسستي ». Jamais « Mon atelier ». Ancre `#entreprise`.
- Pied de page : fr `Réalisé avec QatliA · qatlia.ma`, en `Made with QatliA · qatlia.ma`, ar `أُنجز بواسطة QatliA · qatlia.ma`.
- Bas du devis : fr `Devis établi par {nom} — n'engage l'émetteur que jusqu'à sa date de validité.` ; ar `عرض سعر صادر عن {nom} — لا يلزم المُصدر إلا إلى غاية تاريخ صلاحيته.`
- Logo : PNG/JPEG, validé par `validateLogoDataUrl` (src/lib/exports/quotation-logo.ts) à l'écriture **et** avant chaque `addImage`. Jamais loggé.
- Tout texte libre de l'entreprise dessiné dans un PDF passe par le `drawText` content-aware de la route et entre dans `payloadNeedsArabicFont(...)`.
- Nouvelles chaînes UI en fr / en / ar (les tests `i18n-*.test.js` existants doivent rester verts).
- Avant la PR : `npm run test:node`, `npx tsc --noEmit`, `npm run lint`, comparés à `main` (10 échecs CRLF préexistants).

## Review Focus

1. **Nom d'entreprise en arabe** dans le plan de débit avec une interface en français → Amiri doit être enregistré (sinon carrés vides). Test dans Task 4.
2. **Logo corrompu en base** (ligne écrite à la main, ou règle de validation durcie depuis) → le PDF sort sans logo, pas d'erreur 500. Test dans Task 4.
3. **Nom d'entreprise avec guillemets, `;`, retour ligne ou uniquement de l'arabe** dans le nom de fichier → pas d'injection d'en-tête, repli ASCII stable. Tests dans Task 1.
4. **Service role absente** (env local, préprod) → GET renvoie `{ atelier: null }`, PUT renvoie `SAVE_FAILED`, l'export PDF fonctionne comme aujourd'hui. Tests dans Tasks 2 et 3.
5. **Très long nom d'entreprise** (120 caractères) dans l'en-tête du plan de débit → ne déborde pas sur le nom du projet : tronqué/réduit à la largeur de la colonne gauche. Test dans Task 4.

---

### Task 1: Schéma partagé, priorité de la société, noms de fichiers

**Files:**
- Create: `src/lib/atelier.ts`
- Create: `src/lib/document-filename.ts`
- Test: `tests/atelier.test.js`, `tests/document-filename.test.js`

**Interfaces:**
- Produces (`src/lib/atelier.ts`, isomorphe, aucun import serveur) :
  - `AtelierSchema` = `CompanyIdentitySchema.extend({ logoDataUrl: LogoDataUrlSchema.nullable().optional() }).strict()` ; `type Atelier = z.infer<typeof AtelierSchema>`.
  - `resolveQuotationCompany(sources: { account: Atelier | null; project: CompanyIdentity | null; local: CompanyIdentity | null }): { company: CompanyIdentity | null; logoDataUrl?: string; fromAccount: boolean }` — priorité compte > projet > local ; le logo ne vient que du compte.
  - `companyOf(atelier: Atelier): CompanyIdentity` (retire `logoDataUrl`).
- Produces (`src/lib/document-filename.ts`) :
  - `cutPlanFileNames(projectName: string, companyName?: string | null): { ascii: string; utf8: string }` — préfixe = entreprise nettoyée si non vide, sinon `QatliA`. Sans entreprise, **exactement** le comportement actuel de route.ts:716-722.
  - `quotationFileNames(quoteNumber: string, companyName: string): { ascii: string; utf8: string }` → `{Entreprise}_Devis_{n}.pdf`.
  - `contentDispositionFor(names: { ascii: string; utf8: string }): string` → `attachment; filename="…"; filename*=UTF-8''…` (utilise `encodeRfc5987Filename` de src/lib/quotation.ts).
  - `fileNameFromContentDisposition(header: string | null): string | null` — lit `filename*=UTF-8''…` d'abord, sinon `filename="…"`.

- [ ] **Step 1: Write the failing tests**

`tests/document-filename.test.js` :
```js
test('cutPlanFileNames without a company keeps today\'s QatliA_ name', () => {
  assert.deepEqual(cutPlanFileNames('Cuisine bois'), { ascii: 'QatliA_CUISINE_BOIS.pdf', utf8: 'QatliA_CUISINE_BOIS.pdf' });
});
test('cutPlanFileNames uses the company name as prefix', () => {
  assert.equal(cutPlanFileNames('Cuisine', 'Menuiserie Benali').ascii, 'Menuiserie_Benali_CUISINE.pdf');
});
test('company names with quotes, semicolons and CR/LF never reach the ascii filename', () => {
  const { ascii } = cutPlanFileNames('X', 'A"b;\r\nc');
  assert.doesNotMatch(ascii, /["; \r\n]/);
});
test('an Arabic-only company falls back to QatliA in ascii but keeps the Arabic in utf8', () => {
  const names = cutPlanFileNames('Cuisine', 'نجارة بنعلي');
  assert.equal(names.ascii, 'QatliA_CUISINE.pdf');
  assert.match(names.utf8, /^نجارة_بنعلي_CUISINE\.pdf$/);
});
test('quotationFileNames → {Entreprise}_Devis_{n}.pdf', () => {
  assert.equal(quotationFileNames('DEV-1', 'Atelier Karim').ascii, 'Atelier_Karim_Devis_DEV-1.pdf');
});
test('fileNameFromContentDisposition round-trips contentDispositionFor', () => {
  const names = quotationFileNames('DEV-1', 'نجارة');
  assert.equal(fileNameFromContentDisposition(contentDispositionFor(names)), names.utf8);
  assert.equal(fileNameFromContentDisposition(null), null);
});
```
`tests/atelier.test.js` : `AtelierSchema` accepte `{ name }`, accepte `logoDataUrl: null`, refuse un champ inconnu et un logo `data:image/svg+xml;…` ; `resolveQuotationCompany` renvoie le compte quand les trois existent (`fromAccount: true`, logo du compte), le projet quand le compte est `null`, le local en dernier, `company: null` quand rien.

- [ ] **Step 2: Run** `node --test tests/atelier.test.js tests/document-filename.test.js` — Expected: FAIL (modules absents).
- [ ] **Step 3: Implement** les deux modules. Nettoyage du préfixe : espaces → `_`, ASCII via `[^A-Za-z0-9._-]` retiré, 40 caractères max ; utf8 : seulement espaces → `_` et suppression de `"`, `;`, `\r`, `\n`, `/`, `\\`.
- [ ] **Step 4: Run** les deux tests — Expected: PASS.
- [ ] **Step 5: Commit** `feat(entreprise): schéma partagé et noms de fichiers des documents`.

---

### Task 2: Table `ateliers` et accès serveur

**Files:**
- Create: `supabase/migrations/020_ateliers.sql`
- Create: `src/lib/atelier-server.ts`
- Test: `tests/atelier-server.test.js`

**Interfaces:**
- Consumes: `Atelier`, `AtelierSchema` (Task 1).
- Produces (`src/lib/atelier-server.ts`) :
  - `readAtelier(userId: string): Promise<Atelier | null>` — jamais de throw ; `null` si pas de config admin, erreur Supabase (table absente) ou partie texte invalide selon `CompanyIdentitySchema`. **Le logo est validé à part** (`LogoDataUrlSchema` puis `validateLogoDataUrl`) : un logo invalide est seulement retiré, l'entreprise reste.
  - `saveAtelier(userId: string, atelier: Atelier, options?: { createOnly?: boolean }): Promise<boolean>` — upsert `onConflict: 'user_id'`, `updated_at: new Date().toISOString()` ; `createOnly: true` → `ignoreDuplicates: true` (n'écrase jamais une ligne existante) ; `false` sans config admin ou sur erreur. `logoDataUrl: undefined` **ne touche pas** au logo existant ; `null` l'efface.
  - `atelierForCurrentRequest(): Promise<Atelier | null>` — **vérifie d'abord `getSupabaseAdminConfig()` et renvoie `null` sans créer de client de session** si elle manque (ainsi les tests qui chargent `/api/export-pdf` sans stub ne touchent jamais `cookies()`) ; sinon utilisateur via `createClient()` de `@/lib/supabase/server`, puis `readAtelier` ; tout throw → `null`.
  - Colonnes ↔ champs : `tax_id`↔`taxId`, `logo_data_url`↔`logoDataUrl`, champs vides SQL `NULL` ↔ absents.

- [ ] **Step 1: Write the migration** exactement comme dans la spec (section « Données »), en-tête commenté au format de `017_account_currency.sql` (date, décision utilisateur, « Additive only », requête de vérification). Ne pas toucher `FULL_DATABASE_SETUP.sql` (017 n'y est pas non plus).
- [ ] **Step 2: Write the failing tests** — stub `@supabase/supabase-js` (`createClient` → faux `from('ateliers')` en mémoire, sur le modèle de `tests/export-quotation-route.test.js:62-75`) et `@/lib/supabase/server`, avec `withEnv(CONFIGURED, …)` :
  - `readAtelier` sans `SUPABASE_SERVICE_ROLE_KEY` → `null` et le faux client n'est **jamais** appelé.
  - `saveAtelier` puis `readAtelier` → même objet (`taxId` mappé).
  - `saveAtelier` sans config → `false`.
  - `readAtelier` quand `select` renvoie `{ error: { message: 'relation "ateliers" does not exist' } }` → `null`.
  - toutes les requêtes portent `eq('user_id', <userId>)`.
  - `saveAtelier` avec `logoDataUrl` absent n'inclut pas `logo_data_url` dans l'upsert ; avec `null`, l'inclut à `null`.
  - `saveAtelier(id, a, { createOnly: true })` passe `ignoreDuplicates: true` à l'upsert (le faux client garde la ligne existante intacte).
  - ligne en base avec un nom valide et `logo_data_url` aux octets corrompus → `readAtelier` renvoie l'entreprise **sans** `logoDataUrl` (pas `null`).
  - `atelierForCurrentRequest` sans config admin → `null` et `createClient` de `@/lib/supabase/server` jamais appelé ; sans utilisateur → `null` ; quand `getUser` throw → `null`.
- [ ] **Step 3: Run** `node --test tests/atelier-server.test.js` — Expected: FAIL.
- [ ] **Step 4: Implement** `src/lib/atelier-server.ts` (client admin créé comme `adminClient()` de src/lib/currency-server.ts).
- [ ] **Step 5: Run** — Expected: PASS.
- [ ] **Step 6: Commit** `feat(entreprise): table ateliers et lecture/écriture côté serveur`.

---

### Task 3: Route `/api/atelier`

**Files:**
- Create: `src/app/api/atelier/route.ts`
- Test: `tests/atelier-route.test.js`

**Interfaces:**
- Consumes: `readAtelier`, `saveAtelier` (Task 2), `AtelierSchema` (Task 1), `validateLogoDataUrl`.
- Produces: `GET` → `200 { atelier: Atelier | null }` | `401 { error: 'AUTH_REQUIRED' }`. `PUT` (query `?createOnly=1` → `saveAtelier(..., { createOnly: true })`) body `Atelier` → `200 { atelier }` | `400 { error: 'INVALID_DATA' }` | `400 { error: 'INVALID_LOGO' }` | `401` | `413 { error: 'TOO_LARGE' }` | `500 { error: 'SAVE_FAILED' }`. `export const dynamic = 'force-dynamic'`.

- [ ] **Step 1: Write the failing tests** (stub `@/lib/supabase/server` et `@/lib/atelier-server`) :
  - GET/PUT sans utilisateur → 401, `saveAtelier` jamais appelé.
  - GET → `{ atelier: null }` quand `readAtelier` renvoie `null`.
  - PUT `{ name: 'Menuiserie Benali', phone: '0612345678' }` → 200, `saveAtelier` appelé avec l'`id` de la session (jamais un `userId` du corps : un corps contenant `user_id` → 400 `INVALID_DATA`).
  - PUT sans `name` → 400 `INVALID_DATA`.
  - PUT avec un logo PNG dont les octets sont du JPEG → 400 `INVALID_LOGO` (réutiliser les fixtures de `tests/quotation-logo.test.js`).
  - PUT avec un corps texte de plus de 1 000 000 octets → 413 `TOO_LARGE`.
  - `saveAtelier` → `false` → 500 `SAVE_FAILED`.
  - `PUT /api/atelier?createOnly=1` → `saveAtelier` appelé avec `{ createOnly: true }` ; sans le paramètre → sans.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** — PUT lit `await req.text()`, refuse au-delà de 1 000 000 octets, puis `JSON.parse` (échec → `INVALID_DATA`), `AtelierSchema.safeParse`, `validateLogoDataUrl` si `logoDataUrl` est une chaîne.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(entreprise): route /api/atelier`.

---

### Task 4: Plan de débit — en-tête entreprise, pied de page, nom de fichier

**Files:**
- Modify: `src/app/api/export-pdf/route.ts` (`drawQatliaHeader` ~l.189, `payloadNeedsArabicFont` l.171, boucle des pages l.700-705, nom de fichier l.716-731)
- Modify: `src/lib/exports/pdf-catalog.ts` (clé `madeWith` en fr/en/ar)
- Aucun stub à ajouter aux tests existants qui chargent la route (`export-pdf-route`, `pdf-artifact`, `pdf-cost-integrity`, `pdf-prose-freshness`, `cost-detail`, `costing`, `i18n-coverage`) : sans `SUPABASE_SERVICE_ROLE_KEY`, `atelierForCurrentRequest` renvoie `null` avant tout `cookies()` (Task 2). Ils doivent tous rester verts **sans modification**.
- Test: `tests/export-pdf-atelier.test.js`

**Interfaces:**
- Consumes: `atelierForCurrentRequest` (Task 2), `cutPlanFileNames`, `contentDispositionFor` (Task 1), `validateLogoDataUrl`.
- Produces: en-tête `Content-Disposition` du plan de débit construit par `contentDispositionFor(cutPlanFileNames(projectName, atelier?.name))`.

- [ ] **Step 1: Write the failing tests** (`tests/export-pdf-atelier.test.js`, corps `baseBody()` repris de export-pdf-route.test.js, texte lu via `pdfTextOf`) :
  - sans entreprise : le PDF contient `QatliA` en en-tête et **ne contient pas** `Réalisé avec QatliA` ; `Content-Disposition` contient `filename="QatliA_PROJET_TEST.pdf"`.
  - avec `{ name: 'Menuiserie Benali', phone: '0612345678' }` : contient `Menuiserie Benali`, `0612345678`, `Réalisé avec QatliA` ; `filename="Menuiserie_Benali_PROJET_TEST.pdf"`.
  - `locale: 'en'` avec entreprise → `Made with QatliA`.
  - entreprise `{ name: 'نجارة بنعلي' }` avec `locale: 'fr'` → le PDF embarque la police Amiri (même assertion que `tests/pdf-fonts.test.js` utilise pour détecter Amiri).
  - entreprise avec un `logoDataUrl` PNG valide → 200 et le PDF contient un objet `/Subtype /Image` ; avec un `logoDataUrl` aux octets invalides → 200, pas d'image.
  - entreprise au nom de 120 caractères → 200 (pas d'exception) ; la largeur mesurée par `doc.getTextWidth` n'est pas testable de l'extérieur : vérifier seulement que le nom du projet est toujours présent.
  - `atelierForCurrentRequest` qui rejette → 200, en-tête QatliA.
- [ ] **Step 2: Run** `node --test tests/export-pdf-atelier.test.js` — Expected: FAIL. (Ce nouveau fichier stub `@/lib/atelier-server`.)
- [ ] **Step 3: Implement**
  - `const atelier = await atelierForCurrentRequest().catch(() => null);` avant la création du doc ; ajouter `atelier?.name ?? ''`, `atelier?.phone ?? ''` aux arguments de `payloadNeedsArabicFont`.
  - Logo : `validateLogoDataUrl` une fois ; invalide → pas de logo.
  - Avec entreprise : à gauche dans le cadre existant (14,10 → 15 mm de haut), logo tenu dans 12×12 mm à x=16, puis nom en gras 9 pt et téléphone 7,5 pt ; le nom est raccourci (ellipsis) pour tenir dans la largeur jusqu'au bloc central (`pW/2 - 40`). Le numéro de page quitte l'en-tête et va dans le pied de page centré à y = hauteur de page − 6 mm, 7 pt gris : `${cat.pageIndicator(i, total)} · ${cat.madeWith}`.
  - Pages schéma paysage (~l.567-600) : le dessin descend jusqu'à `drawY + (pH - 46)`, cotes comprises. Avec entreprise, réduire `maxDrawH` de 6 mm pour que le dessin et ses cotes s'arrêtent au-dessus du pied de page ; sans entreprise, rien ne change.
  - Sans entreprise : `drawQatliaHeader` inchangé, aucun pied de page.
  - Nom de fichier via `contentDispositionFor(cutPlanFileNames(projectName, atelier?.name))`.
- [ ] **Step 4: Run** `node --test tests/export-pdf-atelier.test.js tests/export-pdf-route.test.js tests/pdf-artifact.test.js tests/pdf-cost-integrity.test.js tests/pdf-prose-freshness.test.js tests/cost-detail.test.js tests/costing.test.js tests/i18n-coverage.test.js tests/pdf-catalog.test.js tests/pdf-fonts.test.js` — Expected: PASS, sans avoir modifié les fichiers existants.
- [ ] **Step 5: Commit** `feat(entreprise): le plan de débit porte l'entreprise de l'artisan`.

---

### Task 5: Devis — l'entreprise comme émetteur, nom de fichier

**Files:**
- Modify: `src/lib/exports/quotation-catalog.ts` (`footerNote` devient `(companyName: string) => string` ; ajout `madeWith`)
- Modify: `src/app/api/export-quotation/route.ts` (l.746 bas de page ; l.272-280 nom de fichier)
- Modify: `tests/quotation-catalog.test.js`, `tests/export-quotation-route.test.js` (nouvelles attentes). Aujourd'hui aucun test n'affirme `Devis établi par QatliA` ni `QatliA_Devis_` (vérifié par grep) ; `footerNote` n'est utilisé que dans `route.ts:746` — `npx tsc --noEmit` confirme qu'il n'y a pas d'autre appel.

**Interfaces:**
- Consumes: `quotationFileNames`, `contentDispositionFor` (Task 1).

- [ ] **Step 1: Update/write the failing tests**
  - `cat.footerNote('Atelier Karim')` fr = `Devis établi par Atelier Karim — n'engage l'émetteur que jusqu'à sa date de validité.` ; ar contient `عرض سعر صادر عن Atelier Karim`. Aucune des deux ne contient `QatliA`.
  - export d'un devis avec `company.name: 'Atelier Karim'` → `Content-Disposition` contient `filename="Atelier_Karim_Devis_DEV-1.pdf"` ; le PDF contient `Atelier Karim` dans la note et `Réalisé avec QatliA`.
- [ ] **Step 2: Run** `node --test tests/quotation-catalog.test.js tests/export-quotation-route.test.js` — Expected: FAIL sur les nouvelles attentes.
- [ ] **Step 3: Implement** — `drawText(cat.footerNote(input.company.name), …)` puis `cat.madeWith` sur la ligne suivante, 7 pt gris, même alignement ; nom de fichier via les helpers.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(entreprise): le devis est émis au nom de l'entreprise`.

---

### Task 6: Le téléchargement reprend le nom donné par le serveur

**Files:**
- Modify: `src/app/(site)/atelier/page.tsx:1699`, `src/app/(site)/history/page.tsx:204`, `src/components/QuotationDialog.tsx:345`

**Interfaces:**
- Consumes: `fileNameFromContentDisposition` (Task 1).

- [ ] **Step 1: Implement** — chaque `a.download = …` devient `fileNameFromContentDisposition(res.headers.get('Content-Disposition')) ?? <valeur actuelle>`.
- [ ] **Step 2: Run** `npx tsc --noEmit` — Expected: aucune nouvelle erreur.
- [ ] **Step 3: Commit** `feat(entreprise): les PDF téléchargés portent le nom choisi par le serveur`.

---

### Task 7: Mon compte — section « Mon entreprise »

**Files:**
- Create: `src/lib/logo-resize.ts`
- Create: `src/components/BusinessIdentityForm.tsx`
- Modify: `src/app/(site)/account/page.tsx` (section avant `#currency`)
- Modify: `src/i18n/messages/fr.ts`, `en.ts`, `ar.ts` (clés `accountPage.business.*`)
- Test: `tests/logo-resize.test.js`

**Interfaces:**
- Consumes: `GET`/`PUT /api/atelier` (Task 3), `AtelierSchema` (Task 1), `readStoredCompanyIdentity` (src/lib/quotation-local-store.ts).
- Produces:
  - `fitWithin(width: number, height: number, maxSide: number): { width: number; height: number }` (pur, testé) ; `LOGO_MAX_SIDE_PX = 600`.
  - `resizeLogoFile(file: File): Promise<string>` (navigateur seulement : canvas → PNG si transparence détectée sur les pixels, sinon `image/jpeg` qualité 0.85).
  - Clés i18n : `accountPage.business.title` (« Mon entreprise »), `.hint`, `.name`, `.phone`, `.address`, `.email`, `.ice`, `.taxId`, `.logo`, `.logoHint`, `.removeLogo`, `.save`, `.saved`, `.errors.invalidLogo`, `.errors.saveFailed`, `.errors.invalidData`.

- [ ] **Step 1: Write the failing test** — `fitWithin(1200, 600, 600)` → `{ width: 600, height: 300 }` ; `fitWithin(300, 200, 600)` → inchangé ; `fitWithin(500, 2000, 600)` → `{ width: 150, height: 600 }` ; résultats entiers.
- [ ] **Step 2: Run** `node --test tests/logo-resize.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `logo-resize.ts`, puis `BusinessIdentityForm` : au montage `GET /api/atelier` ; si `null`, pré-remplir avec `readStoredCompanyIdentity(window.localStorage)` ; champs dans l'ordre nom (obligatoire), téléphone, adresse, email, ICE, IF ; logo : bouton fichier (`accept="image/png,image/jpeg"`), aperçu `<img>`, « Retirer » (envoie `logoDataUrl: null`) ; « Enregistrer » → `PUT`, confirmation courte `.saved`, erreurs mappées depuis le code renvoyé. Styles et icône sur le modèle de la section `#currency`. `<section id="entreprise">`.
- [ ] **Step 4: Run** `node --test tests/logo-resize.test.js tests/i18n-*.test.js` puis `npx tsc --noEmit` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(entreprise): section Mon entreprise dans le compte`.

---

### Task 8: Devis pré-rempli depuis le compte

**Files:**
- Modify: `src/components/QuotationDialog.tsx` (effet de préremplissage l.167-196, après export réussi l.330-335, lien vers `/account#entreprise`)
- Modify: `src/i18n/messages/fr.ts`, `en.ts`, `ar.ts` (`quotation.editBusiness` : « Modifier mon entreprise »)

**Interfaces:**
- Consumes: `resolveQuotationCompany`, `companyOf` (Task 1), `GET`/`PUT /api/atelier` (Task 3).

- [ ] **Step 1: Implement**
  - À l'ouverture : **remplacer** l'effet de préremplissage projet actuel (l.167-196) par un seul effet qui fait `Promise.all([fetch('/api/atelier'), projectId ? fetch(`/api/projects/${projectId}`) : null])`, avec la même garde `cancelled`. Puis `resolveQuotationCompany({ account, project: quotation?.company ?? null, local: readStoredCompanyIdentity(...) })` → `setCompany`, et `setLogoDataUrl` si le logo vient du compte. La ligne `if (quotation.company) setCompany(quotation.company)` **disparaît** : plus aucun autre chemin ne fixe la société depuis le projet. Le reste du préremplissage projet (client, notes, remise…) est repris tel quel. Toute erreur réseau → comportement actuel.
  - Garder un état `accountBusinessKnownEmpty` : `true` **seulement** si `GET /api/atelier` a répondu 200 avec `atelier: null`. Une erreur, un 401 ou un réseau coupé → `false`.
  - Après export réussi : si `accountBusinessKnownEmpty`, `PUT /api/atelier?createOnly=1` avec `{ ...company, logoDataUrl }` (sans attendre, erreurs ignorées). Le serveur n'écrase jamais une entreprise existante (Task 2), même si l'état client se trompe.
  - Lien `quotation.editBusiness` → `/account#entreprise`, à côté du titre de la partie société.
- [ ] **Step 2: Run** `npx tsc --noEmit` et `node --test tests/quotation-*.test.js tests/i18n-*.test.js` — Expected: PASS.
- [ ] **Step 3: Commit** `feat(entreprise): le devis se pré-remplit avec l'entreprise du compte`.

---

### Vérification finale

- [ ] `npm run test:node`, `npx tsc --noEmit`, `npm run lint` dans le worktree ; comparer la liste des échecs à celle de `main` (10 échecs CRLF attendus).
- [ ] Signaler dans la PR : le nom du PDF téléchargé depuis l'atelier passe de `qatlia_rapport_<horodatage>.pdf` à `QatliA_<PROJET>.pdf` même sans entreprise (changement visible) ; migration `020_ateliers.sql` à appliquer en production **avant** de tester l'interface ; interface connectée non vérifiable en local (pas de `.env.local` dans le worktree).
