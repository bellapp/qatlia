# WhatsApp — voice messages become questions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A voice note sent to the bot is transcribed and answered like a typed question.

**Architecture:** The router sends `audio` to a new `voice` action. `src/lib/whatsapp/voice.ts` downloads the note (generalised `fetchMediaDataUrl`) and transcribes it through OpenRouter (`input_audio`). The webhook writes the transcript on the inbound row, detects the language, and runs the existing assistant path, extracted into one function shared with text.

**Tech Stack:** Next.js route handler, OpenRouter Chat Completions, Supabase, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-20-whatsapp-vocal-design.md`

## Global Constraints

- Accepted audio: `audio/ogg`, `audio/mpeg`, `audio/mp4`, `audio/aac` (MIME parameters such as `; codecs=opus` ignored), at most 1 MB.
- `MAX_VOICES_PER_DAY = 10` per number (inbound `audio` rows in 24 h, the current one included).
- Transcription timeout 20 s; transcript capped at `MAX_INBOUND_CHARS` (1000).
- Model `WHATSAPP_VOICE_MODEL`, default `google/gemini-3.7-flash`.
- No content in logs. Full suite: only the 10 baseline failures.

## Review Focus

- A forwarded music file or a long note: the 1 MB cap stops it before any model call → unclear reply.
- A note in pure darija: transcript in Arabic letters, contact language switches to `ar`, the assistant answers in darija.
- A replayed delivery: `claimInbound` false → nothing transcribed twice.
- OpenRouter answers non-JSON or an empty text: unclear reply, never an empty WhatsApp message.
- A voice note during a human handoff: silent, like a text.

---

### Task 1: Audio download and transcription

**Files:** Modify `src/lib/whatsapp/media.ts`, `src/lib/whatsapp/payload.ts`, `src/lib/whatsapp/config.ts`, `src/lib/whatsapp/store.ts`; Create `src/lib/whatsapp/voice.ts`; Tests `tests/whatsapp-media.test.js`, `tests/whatsapp-webhook-parsing.test.js`, `tests/whatsapp-voice.test.js`.

**Interfaces:**
- `fetchMediaDataUrl(config, mediaId, fetchImpl?, accept: 'image' | 'audio' = 'image')`. For audio: `maxBytes` 1 MB, `mimeType` normalised (parameters dropped).
- `InboundEvent.mediaId` also set for `audio` (`message.audio.id`).
- `WhatsAppConfig.voiceModel: string`.
- Store: `setInboundBody(db, wamid, body)`, `countInboundMessages(db, waId, kind, since)`.
- `transcribeVoice({ audioBase64, format, apiKey, model, fetchImpl?, timeoutMs? }): Promise<{ status: 'ok'; text } | { status: 'empty' } | { status: 'error'; reason }>`.
- `hearVoice({ config, event, now, countVoices: (since) => Promise<number>, fetchImpl? }): Promise<{ status: 'heard'; text } | { status: 'unheard'; reason }>`.

Steps: failing tests → run (FAIL) → implement → run (PASS) → commit `feat(whatsapp): transcription des messages vocaux`.

### Task 2: Router and webhook

**Files:** Modify `src/lib/whatsapp/router.ts`, `src/lib/whatsapp/copy.ts`, `src/app/api/whatsapp/webhook/route.ts`, `docs/whatsapp-bot.md`; Tests `tests/whatsapp-router.test.js`, `tests/whatsapp-webhook-route.test.js`.

**Interfaces:**
- `Decision` gains `{ action: 'voice' }`.
- `COPY.voiceUnclear: Record<Lang, string>`; `COPY.mediaHandoff` no longer says « écouter ».
- Webhook: heard → `setInboundBody`, language from the transcript, then the shared assistant answer with the transcript as message. Unheard → `voiceUnclear` with the advisor semantics (coexistence: handoff; redirect: redirect text appended).

Steps: failing tests → run (FAIL) → implement → run (PASS) → full suite → commit `feat(whatsapp): le bot répond aux messages vocaux`.
