# Bouton WhatsApp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A WhatsApp contact button on every site page, placed by context, whose pre-filled message the bot recognises and answers.

**Architecture:** One pure module `src/lib/whatsapp/site-contact.ts` owns the marker, the per-topic texts, the route → placement map and the link; the site (a client component mounted once in ClientShell, plus a header button) and the bot (webhook + router) both import it, so the texts the site sends are exactly the texts the bot recognises.

**Tech Stack:** Next.js 14 App Router, React client components, Tailwind, node:test with `tests/helpers/load-ts-module`.

**Spec:** `docs/superpowers/specs/2026-11-23-bouton-whatsapp-design.md`

## Global Constraints

- Marker: every site message ends with ` (qatlia.ma)`.
- Number: `WHATSAPP_FROM_NUMBER`, read on the server only; no valid number → no button anywhere.
- Floating button: `z-40` (modals are `z-50`/`z-[60]`), bottom `end` side, respects `env(safe-area-inset-bottom)`.
- No floating button on `/atelier`, `/history`, `/panels`, `/account`; nothing at all on `/admin*` and `/w/*`.
- Site contact referral stored as `{ source: 'site' }`.
- Bot languages are `fr` and `ar` only.
- Production is live: PR only, full gate (`npm run test:node` vs the 10 baseline failures, `npx tsc --noEmit`, `npm run lint`, `npx next build`).

## Review Focus

- Someone edits the pre-filled text but keeps the marker → still recognised as a site contact; what they typed counts as a question.
- Someone deletes the marker → ordinary message (owner answers under `scope = ads`): no crash.
- An already-greeted contact taps the button again → the "menu again" reply, not a second greeting.
- A site message in French from a first contact → greeting not forced to darija.
- Floating button while typing on a phone (login/sign-up) → hidden, comes back on blur.

---

### Task 1: Shared site-contact module

**Files:**
- Create: `src/lib/whatsapp/site-contact.ts`
- Test: `tests/whatsapp-site-contact.test.js`

**Interfaces:**
- Produces:
  - `SITE_MARKER = '(qatlia.ma)'`
  - `type SiteTopic = 'general' | 'credits' | 'atelier' | 'history' | 'panels' | 'account'`
  - `type Placement = { kind: 'floating' | 'header'; topic: SiteTopic } | { kind: 'none' }`
  - `placementFor(pathname: string): Placement`
  - `siteMessage(topic: SiteTopic, locale: 'fr' | 'en' | 'ar'): string`
  - `whatsappNumber(raw: string | undefined): string | null` (digits only, 8–15, `+`/spaces/dots/dashes/parentheses stripped)
  - `whatsappLink(number: string, topic, locale): string` → `https://wa.me/<digits>?text=<encodeURIComponent(message)>`
  - `isSiteMessage(text: string | null): boolean` (contains the marker)
  - `typedBeyondSiteMessage(text: string): string` (known message stripped; else marker stripped)

- [ ] Step 1: tests — `placementFor('/')`, `/ar`, `/signup`, `/auth/login`, `/privacy` → floating general; `/credits`, `/credits/success` → floating credits; `/atelier` → header atelier (and history, panels, account); `/admin/clients/x`, `/w/abc` → none; unknown path → floating general. Every `siteMessage` ends with the marker, Arabic ones contain Arabic letters. `whatsappNumber('+212 726-263 686') === '212726263686'`, `whatsappNumber('abc') === null`. `whatsappLink` round-trips the message through `decodeURIComponent`. `typedBeyondSiteMessage(siteMessage('atelier','fr')) === ''`, with text appended → that text; edited text with marker → text without marker.
- [ ] Step 2: run, see it fail (module missing).
- [ ] Step 3: implement.
- [ ] Step 4: run, pass.

### Task 2: The bot recognises site messages

**Files:**
- Modify: `src/lib/whatsapp/router.ts` (`typedBeyondPrefill`, `resolveLang`)
- Modify: `src/app/api/whatsapp/webhook/route.ts` (`handleInbound`)
- Test: `tests/whatsapp-site-contact.test.js`, `tests/whatsapp-webhook-route.test.js`

**Interfaces:**
- Consumes Task 1. Produces `withSiteReferral(event: InboundEvent): InboundEvent` in `site-contact.ts`: a text event with the marker and no referral gets `referral: { source: 'site' }`; anything else unchanged.

- [ ] Step 1: tests —
  - `withSiteReferral` adds `{ source: 'site' }` only to marked texts without a referral; keeps an ad referral.
  - `resolveLang` for a site event: French text on a first contact → `'fr'`; Arabic → `'ar'`.
  - `decide` on a first contact with the bare French site message → greeting, no `thenAssistant`; with a question appended → `thenAssistant`.
  - Webhook, coexistence + scope ads: a new contact sending the site message gets the greeting and the contact upsert carries `{ source: 'site' }`; without the marker → nothing sent (existing test stays green).
- [ ] Step 2: run, fail.
- [ ] Step 3: `handleInbound` starts with `event = withSiteReferral(event)`; `typedBeyondPrefill` returns `typedBeyondSiteMessage(text)` for site messages; `resolveLang` returns `detectLang(event.text, contact.lang)` when `event.referral?.source === 'site'`.
- [ ] Step 4: run, pass (with `whatsapp-router`, `whatsapp-greeting` tests).

### Task 3: The buttons on the site

**Files:**
- Create: `src/components/WhatsAppContact.tsx` (`WhatsAppNumberProvider`, `WhatsAppFloating`, `WhatsAppHeaderButton`)
- Modify: `src/components/ClientShell.tsx` (prop `whatsappNumber?: string | null`, provider + floating button)
- Modify: `src/app/(site)/layout.tsx`, `src/app/(ar)/layout.tsx` (pass `whatsappNumber(process.env.WHATSAPP_FROM_NUMBER)`)
- Modify: `src/components/WorkspaceNav.tsx` (header button at the row's end), `src/app/(site)/account/page.tsx` (header button)
- Modify: `src/i18n/messages/{fr,en,ar}.ts` (key `contact.whatsappAria`)
- Test: `tests/whatsapp-site-button.test.js` (source-text checks)

- [ ] Step 1: tests — ClientShell renders `WhatsAppFloating`; both layouts pass `WHATSAPP_FROM_NUMBER` through `whatsappNumber`; floating button class has `fixed`, `z-40`, `end-` and safe-area bottom; it uses `placementFor(usePathname())` and hides on `focusin` of input/textarea/select; `WorkspaceNav` and the account header render `WhatsAppHeaderButton`; links have `target="_blank"` and `rel="noopener noreferrer"`; the aria key exists in all three locales.
- [ ] Step 2: run, fail.
- [ ] Step 3: implement (green `#25D366` circle, 56 px, WhatsApp glyph as inline SVG; header button 32 px, same glyph).
- [ ] Step 4: run, pass; then the full gate, PR.
