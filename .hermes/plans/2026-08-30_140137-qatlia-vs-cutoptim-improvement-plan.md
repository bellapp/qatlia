# QatlIA vs CutOptim Improvement Plan

> **For Hermes:** Implement this plan task-by-task with Claude Code Opus (`--model opus --effort max`) and use TDD for every behavioral change. Do not use Codex unless the user explicitly overrides the standing preference.

**Goal:** Make QatlIA’s existing product claims true, close the highest-value CutOptim gaps, and establish a defensible Morocco/Maghreb advantage through photo-to-cut-list, Arabic/RTL, MAD quotations, WhatsApp delivery, and offline workshop use.

**Architecture:** Preserve the deterministic client/server TypeScript optimization core, Next.js App Router, Supabase persistence, and existing export pipeline. First remove credibility debt and unify domain boundaries (units, costs, stock, offcuts, options). Then build market-specific workflows rather than attempting feature-for-feature parity with CutOptim.

**Tech Stack:** Next.js 14, TypeScript, Tailwind, Supabase/Postgres/RLS, Playwright, Node test runner, jsPDF, Stripe/payment adapter, service worker/PWA, Claude Code Opus 5 for implementation and review.

---

## 1. Executive assessment

### Product conclusion

CutOptim currently wins on global feature breadth, published optimizer benchmarking, stock/offcut management, production workflow, labels/quotation, collaboration, and SEO content. QatlIA should not pursue generic parity in every area.

QatlIA’s strongest defensible workflow is:

> Photograph a handwritten cut list → validate parts → optimize in the artisan’s units → produce a workshop plan and client quotation in MAD → send over WhatsApp → operate in French/Arabic with weak connectivity.

CutOptim does not currently combine Arabic/RTL, MAD/local-market workflows, handwritten-photo extraction, and WhatsApp-native delivery.

### Strengths to preserve

- Deterministic 2D guillotine engine with multiple strategy evaluation.
- Existing regression fixtures matching CutOptim on verified sheet-count/utilization cases.
- Real 1D mode, Excel paste, furniture templates, per-piece colors, edge data, cut order.
- Photo/Vision input specialized for handwritten artisan lists.
- PDF, DXF, PNG, JSON, and CSV output surface.
- Local + cloud history fallback.
- Mobile-responsive studio interface and PWA shell.
- FR/EN/AR locale plumbing and corrected mobile RTL containment.
- MAD-oriented material and edge-cost UX.

### Confirmed credibility gaps (source-verified)

1. **2D offcuts are always empty.** `src/lib/cutting/binpacking.ts` currently returns `offcuts: []` in both per-sheet and final results, while the UI/PDF advertise and render offcuts.
2. **`considerMaterial` and `optimizationPriority` are exposed but not meaningfully consumed by the 2D optimizer.** They exist in `OptimizationOptions`, but the packing path does not implement the advertised behaviors.
3. **Implicit `>500` mm→cm conversion is unsafe.** It exists in `src/lib/pieces/import-parser.ts`, `src/components/PiecesManager.tsx`, and `src/app/atelier/page.tsx`; a legitimate 600 cm 1D length can become 60 cm.
4. **Payment presentation and charge currency disagree.** Packs display MAD while `src/app/api/credits/checkout/route.ts` creates EUR card sessions.
5. **Credit-consumption messaging and implementation disagree.** The current atelier flow consumes a credit during PDF export, while customer copy says analysis/photo usage is charged and exports are free.
6. **Internationalization is partial.** `LocaleProvider` translates a small shared subset; major atelier, options, history, credits, landing, validation, and export strings remain French.
7. **Cost calculation has multiple sources of truth.** UI material prices and PDF defaults/derived metrics can disagree.
8. **PWA caching is installable but not yet reliable offline-first behavior.** The service worker strategy can retain stale application shells.

### Competitive priorities

| Priority | QatlIA action | Why it matters vs CutOptim |
|---|---|---|
| P0 | Make offcuts, options, units, costs, credits, and claims correct | Trust and workshop correctness before feature growth |
| P1 | Complete Arabic, MAD quotation, WhatsApp delivery, local stock presets | Builds the defensible Maghreb workflow CutOptim lacks |
| P2 | Offcut inventory, labels, production workflow, robust offline mode | Retention and daily atelier value |
| P3 | Transparent benchmarks, explainability, FR/AR content, suppliers | Credibility and distribution moat |

---

## 2. Delivery rules

For every implementation task:

1. Use Claude Code with `--model opus --effort max`.
2. Begin from a clean `main` and record the starting SHA.
3. Write a failing Node or Playwright regression first.
4. Run the focused test and preserve the red result.
5. Implement the minimum coherent change.
6. Run the focused test until green.
7. Run:
   - `npm run test:node`
   - `npm run test:optimizer`
   - `npx tsc --noEmit`
   - `npm run build`
   - `npx playwright test --reporter=list`
   - `git diff --check`
8. Review the staged diff with a fresh Claude Opus read-only pass.
9. Commit one coherent task at a time; do not combine unrelated product changes.
10. Push only after all gates are green, then verify the public Vercel bundle and user flow.

Preserve these domain invariants:

- Canonical internal unit remains cm unless a separate migration explicitly changes it.
- Kerf is entered in mm and normalized once at the API/domain boundary.
- Height Y × Width X remains the workshop convention.
- Placements must remain in bounds, non-overlapping, non-duplicated, deterministic, and fully partitioned into placed/unplaced IDs.
- Comparisons with CutOptim must use identical sheet size, kerf, margin, rotation, material, and input fixture.
- Customer UI must not expose model/provider or internal algorithm names.

---

# Phase P0 — Make current claims true

## Task 1: Compute real 2D offcuts

**Objective:** Populate per-sheet and aggregate offcuts from the packer’s surviving free rectangles, without overlaps or fake/duplicate remnants.

**Files:**
- Modify: `src/lib/cutting/binpacking.ts`
- Modify: `tests/optimizer-regression.test.js`
- Create: `tests/offcuts-regression.test.js`
- Validate consumers: `src/app/atelier/page.tsx`
- Validate export: `src/app/api/export-pdf/route.ts`

**Step 1: Write failing tests**

Add assertions that:

- every returned offcut has positive width/height/area;
- every offcut is within its source sheet;
- no offcut overlaps a placed piece;
- no two reported offcuts overlap;
- `sum(placed area) + sum(offcut area) + non-reusable kerf/trim loss <= sheet area + epsilon`;
- aggregate offcuts equal the concatenation of per-sheet offcuts;
- a known simple layout returns the expected remnant dimensions;
- minimum reusable dimensions classify `isReusable` deterministically.

**Step 2: Verify red**

Run:

```bash
node --test tests/offcuts-regression.test.js
```

Expected: FAIL because `offcuts` is empty.

**Step 3: Implement**

- Retain normalized free rectangles after `packSheetWithStrategy` completes.
- Convert only geometrically valid, non-contained, non-overlapping terminal free rectangles into `Offcut` records.
- Assign stable IDs based on sheet index and sorted coordinates.
- Compute `areaM2` from canonical cm dimensions.
- Introduce explicit reusable thresholds in options rather than hard-coded UI guesses.
- Aggregate from sheet results; remove final `offcuts: []`.

**Step 4: Verify UI/export**

Add Playwright coverage that runs a simple plan and checks:

- Chutes panel is non-empty;
- dimensions match the API result;
- SVG hatching remains bounded;
- PDF request receives the same offcut list.

**Step 5: Commit**

```bash
git commit -m "feat(optimizer): compute and report reusable 2d offcuts"
```

---

## Task 2: Wire material separation and optimization priority

**Objective:** Ensure every visible optimization control changes optimizer behavior or remove it until implemented.

**Files:**
- Modify: `src/lib/cutting/binpacking.ts`
- Modify: `src/app/api/optimize/route.ts`
- Modify: `src/components/OptionsPanel.tsx`
- Modify: `tests/optimizer-regression.test.js`
- Create: `tests/optimizer-options.test.js`

**Step 1: Write failing tests**

- `considerMaterial=true`: pieces of different materials must never share a sheet result.
- `considerMaterial=false`: mixed pieces may share compatible stock.
- `min_sheets`: plan scoring prioritizes sheet count.
- `min_waste`: among equal feasible sheet counts, plan scoring prioritizes waste.
- `linear_guillotine`: prioritizes valid through-cut/strip arrangements and returns explainability metadata.
- `balanced`: deterministic composite score.
- API schema accepts all supported values and rejects unknown ones.

**Step 2: Implement material partitioning**

- Group pieces by normalized material when enabled.
- Match groups to compatible stock material.
- Return explicit unplaced reasons when stock for a material is missing.
- Merge results without ID collisions.

**Step 3: Implement explicit scoring policy**

Replace implicit one-policy ranking with a typed scorer selected from `optimizationPriority`. Do not advertise an option unless its score and acceptance test are defined.

**Step 4: Expose neutral explanation metadata**

Return customer-safe fields such as candidates evaluated, active constraints, and chosen goal. Avoid algorithm jargon in customer UI.

**Step 5: Commit**

```bash
git commit -m "feat(optimizer): enforce material groups and optimization goals"
```

---

## Task 3: Replace implicit unit guessing with explicit units

**Objective:** Support metric input safely and eliminate silent dimensional corruption.

**Product decision:** Deliver explicit `cm` and `mm` first. Add imperial only in a later isolated task after metric migration is stable.

**Files:**
- Create: `src/lib/units.ts`
- Modify: `src/lib/pieces/import-parser.ts`
- Modify: `src/components/PiecesManager.tsx`
- Modify: `src/app/atelier/page.tsx`
- Modify: API schemas under `src/app/api/`
- Modify: PDF/DXF/CSV/JSON exports
- Create: `tests/units.test.js`
- Modify: `tests/pieces-import-parser.test.js`
- Modify: `e2e/atelier.spec.ts`

**Step 1: Define boundary model**

```ts
type DisplayUnit = 'cm' | 'mm';

interface UnitContext {
  displayUnit: DisplayUnit;
  canonicalUnit: 'cm';
}
```

All domain calculations remain cm. Conversion occurs only through `toCanonicalCm()` and `fromCanonicalCm()`.

**Step 2: Write failing tests**

- 600 cm remains 600 cm.
- 600 mm becomes 60 cm only when input unit is explicitly mm.
- Existing 230×120 cm remains unchanged.
- Paste/import requires an explicit selected unit or a clearly confirmed detected unit.
- Switching display units is lossless across repeated toggles.
- Kerf remains mm and converts exactly once.
- Export labels use selected display unit consistently.

**Step 3: Migration UX**

- Persist selected unit in local settings.
- For old saved projects lacking unit metadata, assume the historical canonical cm format and mark it as migrated.
- Remove all `value > 500 ? value / 10` conversion logic after migration tests pass.

**Step 4: Commit**

```bash
git commit -m "feat(units): add explicit cm and mm project units"
```

---

## Task 4: Establish a single cost model

**Objective:** Make on-screen, persisted, PDF, and quotation totals derive from one typed calculation.

**Files:**
- Create: `src/lib/costing.ts`
- Modify: `src/lib/cutting/binpacking.ts`
- Modify: `src/app/atelier/page.tsx`
- Modify: `src/app/api/export-pdf/route.ts`
- Modify: project persistence schemas
- Create: `tests/costing.test.js`

**Step 1: Define canonical inputs**

- stock price per sheet or per m²;
- edge price per meter by preset;
- cut/labor price per meter or fixed project labor;
- tax and discount only in quotation layer;
- currency fixed to MAD for the first version.

**Step 2: Write failing equivalence tests**

For one fixture, assert API result, UI summary, saved project, PDF summary, and quotation payload all contain the same material, edge, labor, and total values.

**Step 3: Remove invented metrics**

Delete or explicitly document any unexplained perimeter multipliers or capped non-reusable-waste formulas. Never label an estimate as a measured value.

**Step 4: Commit**

```bash
git commit -m "refactor(costing): unify atelier and export calculations"
```

---

## Task 5: Resolve payment currency and credit policy

**Objective:** Make customer copy, charged currency, and credit consumption match exactly.

**Decision gate before coding:** Choose one policy:

- Recommended: unlimited manual optimization/export; consume credits only for successful Vision analysis; quotation may be a premium feature later.
- Alternative: retain PDF credits, but rewrite all pricing/copy and ensure the value proposition is explicit.

**Files:**
- Modify: `src/lib/stripe/config.ts`
- Modify: `src/app/api/credits/checkout/route.ts`
- Modify: `src/app/api/credits/consume/route.ts`
- Modify: `src/app/api/vision/route.ts`
- Modify: `src/app/atelier/page.tsx`
- Modify: `src/app/credits/page.tsx`
- Modify: Supabase credit RPC/migrations if consumption moves server-side
- Create: `tests/credits-policy.test.js`
- Create: `e2e/credits.spec.ts`

**Step 1: Write policy tests**

- A failed Vision request consumes no credit.
- A successful Vision request consumes exactly one credit atomically.
- Parallel requests cannot spend the same last credit twice.
- The selected free action does not call `/api/credits/consume`.
- Checkout amount/currency equals displayed amount/currency.
- Placeholder Stripe price IDs fail safely before creating a checkout session.

**Step 2: Currency implementation**

Use an actual supported MAD settlement path if merchant configuration permits. If not, show and charge the same supported currency until a CMI/local provider is implemented. Remove unsupported CMI/CashPlus claims immediately rather than leaving future promises in production.

**Step 3: Commit**

```bash
git commit -m "fix(billing): align credits, pricing copy, and checkout currency"
```

---

## Task 6: Replace unsupported marketing claims with measured evidence

**Objective:** Ensure every numeric claim is backed by reproducible fixtures.

**Files:**
- Modify: `tests/optimizer-regression.test.js`
- Create: `tests/fixtures/benchmarks/README.md`
- Create: `scripts/benchmark-optimizer.mjs`
- Modify: `src/app/landing-page.tsx`
- Create: `docs/optimizer-benchmark.md`

**Step 1: Formalize baseline**

For each checked-in dataset record:

- sheet dimensions;
- kerf, margin, rotation, material constraints;
- expanded piece count and total area;
- theoretical area lower bound;
- QatlIA sheet count/utilization/waste;
- CutOptim result only when reproduced under identical settings.

**Step 2: Add quality gates**

Preserve the known verified fixtures:

- 135 pieces: ≤4 sheets at identical parameters;
- 16 pieces: ≤2 sheets;
- 51 pieces: ≤3 sheets and valid geometry.

**Step 3: Marketing**

Replace generic “75% less waste” or “90% useful surface” claims with either:

- measured benchmark language and methodology link; or
- non-numeric wording until enough evidence exists.

**Step 4: Commit**

```bash
git commit -m "test(optimizer): publish reproducible quality benchmarks"
```

---

# Phase P1 — Build the Morocco/Maghreb wedge

## Task 7: Complete French/English/Arabic localization

**Objective:** Translate the entire customer journey and make Arabic genuinely usable, not merely direction-aware.

**Files:**
- Consolidate: `src/components/LocaleProvider.tsx`
- Use or remove: `messages/fr.json`, `messages/en.json`, `messages/ar.json`
- Modify all customer-facing pages/components under `src/app/` and `src/components/`
- Modify PDF quotation/report pipeline
- Create: `tests/i18n-coverage.test.js`
- Modify: `e2e/features.spec.ts`

**Step 1: Inventory strings**

Create a test that scans customer-facing TSX for unapproved literal French UI strings. Maintain a small allowlist for brand names and dimension symbols.

**Step 2: Consolidate translation source**

Choose one system (`next-intl` or the current provider) and remove the unused duplicate. Every locale must have exactly the same key set.

**Step 3: RTL rules**

- Arabic document direction is RTL.
- Dimensions, numeric fields, cut-order technical controls, SVG coordinates, and code-like identifiers remain LTR where necessary.
- Maintain overflow tests at 375×812, 390×844, and desktop 1280×1024.
- Test keyboard focus order against visual order.

**Step 4: Arabic exports**

Embed a font with Arabic glyph coverage (e.g. Noto Naskh/Amiri with licensing recorded), implement shaping/bidi handling, and test extracted PDF text and visual snapshots.

**Step 5: Commit**

```bash
git commit -m "feat(i18n): localize the complete FR EN AR workflow"
```

---

## Task 8: Add MAD client quotation

**Objective:** Turn optimized plans into a revenue-generating client document for artisans.

**Files:**
- Create: `src/lib/quotation.ts`
- Create: `src/app/api/export-quotation/route.ts`
- Create: quotation UI component under `src/components/`
- Extend project persistence for client/company data
- Create: `tests/quotation.test.js`
- Create: `e2e/quotation.spec.ts`

**Requirements:**

- artisan/company identity and optional logo;
- client identity and project reference;
- panels, pieces, edge banding, labor, delivery, discount;
- VAT configurable (never silently assume 20%);
- totals in MAD and optional amount-in-words;
- expiry and notes;
- FR/AR output;
- totals must use `src/lib/costing.ts`, never recalculate independently.

**Security:** Validate logo size/type, escape all text, enforce authenticated ownership for saved quotation data, and rate-limit server-generated documents.

**Commit:**

```bash
git commit -m "feat(quotation): generate client estimates in MAD"
```

---

## Task 9: Add WhatsApp-native sharing

**Objective:** Share the plan/quotation through the workflow Moroccan artisans already use.

**Files:**
- Create: `src/lib/share.ts`
- Create: share component under `src/components/`
- Add secure share-link API/storage only if file sharing fallback requires it
- Create: `e2e/share.spec.ts`

**Implementation order:**

1. Use Web Share API with generated PDF/PNG files when supported.
2. Use a `wa.me` text link fallback with no sensitive project data in the URL.
3. If durable share links are added, use opaque IDs, explicit expiry, ownership checks, revocation, and no public Supabase bucket listing.
4. Track only privacy-safe events; never log dimensions/client names into analytics.

**Commit:**

```bash
git commit -m "feat(workflow): share plans and quotations via WhatsApp"
```

---

## Task 10: Build local stock presets and multi-stock UI

**Objective:** Unlock engine-supported stock quantities and provide realistic, editable Moroccan panel presets.

**Files:**
- Create: `src/lib/stock-presets.ts`
- Create: stock editor component under `src/components/`
- Modify: `src/app/atelier/page.tsx`
- Extend project/profile persistence
- Create: `tests/stock.test.js`
- Modify optimizer tests and `e2e/atelier.spec.ts`

**Requirements:**

- multiple stock sizes;
- quantity/unlimited flag;
- material and thickness;
- price per sheet or m²;
- reusable-offcut source flag;
- priority/order;
- user-editable presets;
- no claim that a supplier price is current without source/date.

Do not replace the canonical benchmark panel globally. Product defaults and benchmark fixtures are separate concerns.

**Commit:**

```bash
git commit -m "feat(stock): add multi-panel inventory and local presets"
```

---

# Phase P2 — Retention and production workflow

## Task 11: Persist and reuse offcuts

**Objective:** Let useful remnants reduce material consumption in future projects.

**Dependency:** Task 1 must be complete and trusted.

**Files:**
- Create Supabase migration for user-owned offcuts with RLS
- Create: `src/app/api/offcuts/route.ts`
- Create: offcut inventory UI
- Modify optimizer stock input mapping
- Create: `tests/offcut-reuse.test.js`
- Create: `e2e/offcuts.spec.ts`

**Rules:**

- 1D and 2D pools stay separate.
- Every offcut has dimensions, material, thickness, quantity, origin project, created date, and state.
- An offcut can be consumed at most once unless quantity >1.
- Packing prioritizes selected saved offcuts before new stock.
- Consumption is atomic and occurs only after project confirmation, not during preview.
- Users can archive/delete/correct offcuts they physically discarded.

**Commit:**

```bash
git commit -m "feat(inventory): save and reuse workshop offcuts"
```

---

## Task 12: Add labels and workshop execution state

**Objective:** Extend QatlIA from optimization into reliable cutting execution.

**Files:**
- Create label generation module/API
- Extend cut-order data model
- Create execution view with pending/in-progress/completed state
- Persist progress per project
- Create: `tests/labels.test.js`
- Create: `e2e/workshop-progress.spec.ts`

**Requirements:**

- printable labels: piece number, name, H×W, material, grain, edges, project;
- QR code may reference only an opaque project/piece token;
- cut-order completion works offline and syncs later;
- no animated cutting sequence until static execution state proves useful;
- keyboard/touch targets meet accessibility sizing.

**Commit:**

```bash
git commit -m "feat(workshop): add labels and cutting progress"
```

---

## Task 13: Make the PWA genuinely offline-first

**Objective:** Allow manual entry, optimization, project drafts, and execution tracking under intermittent connectivity without serving indefinitely stale code.

**Files:**
- Replace/modify: `public/sw.js`
- Modify: `src/components/PwaRegister.tsx`
- Add IndexedDB abstraction for drafts/sync queue
- Create offline Playwright scenarios

**Strategy:**

- network-first navigation with offline shell fallback;
- stale-while-revalidate immutable assets;
- versioned caches and cleanup on activation;
- never cache auth, checkout, Vision, or private project API responses indiscriminately;
- local queue with idempotency keys for project/progress sync;
- visible offline/sync status;
- service-worker update prompt instead of silent stale shell.

**Commit:**

```bash
git commit -m "feat(pwa): support reliable offline atelier workflows"
```

---

# Phase P3 — Credibility and distribution

## Task 14: Add optimizer explainability and public benchmarks

**Objective:** Counter CutOptim’s benchmark advantage with transparent, reproducible evidence rather than unsupported yield percentages.

**Files:**
- Extend optimizer result metadata
- Create public benchmark page under `src/app/`
- Publish fixture/methodology docs
- Add deterministic benchmark CI job

**Customer-safe explanation:**

- layouts evaluated;
- constraints respected;
- selected objective;
- lower-bound sheet count where computable;
- achieved sheet count and utilization;
- reasons for unplaced pieces.

Never claim global optimality unless proven for that instance.

---

## Task 15: Build FR/AR content and supplier distribution loop

**Objective:** Acquire users through regional intent CutOptim does not serve.

**Deliverables:**

- FR/AR guides for cut-list preparation, MDF formats, kerf, edge banding, offcut reuse;
- simple calculators that lead into `/atelier` with prefilled state;
- supplier stock-format pages with source/date and no fabricated live prices;
- privacy-safe funnel analytics;
- structured data and sitemap;
- workshop interview feedback loop.

**Validation:** Conduct at least 10 artisan interviews before expanding P2/P3 scope. Track completion of photo import, first valid optimization, quotation export, WhatsApp share, and return use—without collecting sensitive dimensions or customer identities in analytics.

---

## 3. Explicitly defer

Do not prioritize these until P0/P1 metrics show demand:

- animated saw sequence;
- grain-matching groups;
- three-dimensional “wood mode”;
- arbitrary maximum cutting stages;
- engine API monetization;
- ten-language expansion;
- additional CNC/CAM integrations beyond validated DXF;
- team workspaces before individual project retention is proven.

---

## 4. Security and reliability review gates

Before each production push, Claude Opus must specifically review:

- Supabase RLS and ownership on projects, credits, offcuts, quotations, and share links;
- atomic credit/offcut consumption;
- Stripe webhook signature and idempotency;
- untrusted text/image/file validation in Vision and exports;
- no secret/model/provider leakage;
- rate limits and abuse controls on Vision, optimization, exports, and public shares;
- HTML/PDF/DXF text escaping;
- private data excluded from caches and analytics;
- service-worker cache boundaries;
- deterministic optimizer behavior and geometry invariants.

---

## 5. Recommended implementation order and rough effort

| Sequence | Workstream | Estimate |
|---:|---|---:|
| 1 | Real offcuts | 2–3 engineering days |
| 2 | Material/priority option correctness | 2–3 days |
| 3 | Explicit cm/mm units | 2–4 days |
| 4 | Unified costing | 1–2 days |
| 5 | Billing/credit alignment | 2–3 days after policy decision |
| 6 | Measured claims and benchmark docs | 1–2 days |
| 7 | Full FR/EN/AR + Arabic PDF | 5–8 days |
| 8 | MAD quotation | 3–5 days |
| 9 | WhatsApp delivery | 1–3 days |
| 10 | Multi-stock/local presets | 2–4 days |
| 11 | Persistent offcut inventory | 4–6 days |
| 12 | Labels/progress | 3–5 days |
| 13 | Reliable offline PWA | 3–5 days |

Treat estimates as planning ranges, not commitments. Re-estimate after each phase based on tests and user interviews.

---

## 6. Success metrics

### P0 exit criteria

- No advertised control is a no-op.
- Offcuts are geometrically valid and visible across UI/PDF.
- No implicit dimension conversion remains.
- UI/export totals match exactly.
- Charged currency equals displayed currency.
- Credit behavior equals customer copy.
- Every public numeric optimizer claim links to reproducible evidence.
- Full Node/TypeScript/build/Playwright suite green.

### P1 exit criteria

- Complete atelier workflow passes in FR, EN, and AR at mobile/desktop widths.
- Arabic PDF is readable and directionally correct.
- User can generate a MAD quotation and share it via WhatsApp.
- Multi-stock presets are editable and persisted.
- At least five external artisans complete the workflow without assisted data correction.

### Product metrics

- Photo-to-valid-cut-list completion rate.
- Time from photo/manual entry to valid plan.
- Optimization-to-quotation conversion.
- WhatsApp share rate.
- Projects per returning atelier per month.
- Offcut reuse rate and material area saved.
- Error/unplaced-piece rate.
- Retention after 7 and 30 days.

---

## 7. Competitive evidence reviewed

CutOptim sources reviewed by Claude Opus:

- `https://cutoptim.com/`
- `https://cutoptim.com/pricing`
- `https://cutoptim.com/benchmarks`
- `https://cutoptim.com/docs/getting-started`
- `https://cutoptim.com/docs/offcut-inventory`
- repository teardown: `.hermes/plans/2026-08-29_cutoptim-dashboard-analysis.md`
- QatlIA benchmark reference: `references/cutoptim-benchmark-regression.md` in the QatlIA skill

Verified CutOptim advantages include multi-stock/offcut inventory, richer cutting controls, labels, quotation, production tracking, collaboration, published benchmark methodology, and a substantial guides/calculators/docs content surface.

Verified QatlIA advantages/opportunities include handwritten-photo input, Arabic/RTL potential, MAD/local pricing intent, WhatsApp opportunity, DXF/PNG/JSON access, mobile-first camera workflow, premium studio UX, and a market-aligned credit model—provided the current billing and product claims are corrected first.

---

## 8. First execution recommendation

Start with **Task 1: real 2D offcuts**. It closes the most visible credibility gap and unlocks the later offcut inventory, workshop reporting, and measurable waste-reduction roadmap.

Execution command pattern:

```bash
claude -p "Implement Task 1 from .hermes/plans/2026-08-30_140137-qatlia-vs-cutoptim-improvement-plan.md using strict TDD. Do not commit or push. Return changed files, red/green evidence, and remaining risks." \
  --model opus \
  --effort max \
  --allowedTools "Read,Edit,Write,Bash(node --test *),Bash(npm run test:*),Bash(npx tsc --noEmit),Bash(npm run build),Bash(npx playwright test *)" \
  --max-turns 35
```

After implementation, use a fresh Claude Opus session for spec-compliance review and another for code-quality/security review before commit.
