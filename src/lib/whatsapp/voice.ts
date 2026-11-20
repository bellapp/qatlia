/**
 * Voice notes sent to the bot (plan 2026-11-20-whatsapp-vocal): downloaded
 * from Meta like the photos, transcribed word for word by Gemini through
 * OpenRouter, then answered by the webhook like a typed question.
 *
 * The note is never stored; only the transcript is, as a typed message would
 * be. Logs carry reason codes only: no content, no phone number.
 */

import type { WhatsAppConfig } from '@/lib/whatsapp/config';
import { fetchMediaDataUrl } from '@/lib/whatsapp/media';
import { MAX_INBOUND_CHARS } from '@/lib/whatsapp/assistant';
import type { InboundEvent } from '@/lib/whatsapp/payload';

/** Voice notes heard per number in 24 hours; more get the "write it" reply. */
export const MAX_VOICES_PER_DAY = 10;
export const VOICE_TIMEOUT_MS = 20_000;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const SITE_URL = 'https://qatlia.ma';
const DAY_MS = 24 * 60 * 60 * 1000;

/** The Gemini `input_audio.format` for each type the download accepts. */
const AUDIO_FORMATS: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/aac': 'aac',
};

const TRANSCRIBE_PROMPT = `Transcris mot pour mot ce message vocal WhatsApp. La personne parle darija marocaine, arabe ou français, souvent mélangés.
- Écris la darija et l'arabe en lettres arabes, le français en lettres latines, comme la personne les dit.
- Ne réponds pas au message, ne le traduis pas, ne le résume pas, n'ajoute aucun commentaire.
- S'il n'y a pas de parole compréhensible (silence, bruit, musique), renvoie un texte vide.
Réponds uniquement avec un objet JSON {"text": "..."}.`;

export type TranscribeResult = { status: 'ok'; text: string } | { status: 'empty' } | { status: 'error'; reason: string };

export type HearResult = { status: 'heard'; text: string } | { status: 'unheard'; reason: string };

/** No Latin or Arabic letter and no digit (silence, "...", an emoji): nothing to answer. */
const hasWords = (text: string) => /[A-Za-zÀ-ÖØ-öø-ÿ0-9ء-ي٠-٩ٱ-ۓ]/.test(text);

/** The transcript from a JSON object (fenced or not), or the plain text the model gave instead. */
function readTranscript(content: string): string {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!cleaned.startsWith('{')) return cleaned;
  try {
    const parsed = JSON.parse(cleaned) as { text?: unknown };
    return typeof parsed?.text === 'string' ? parsed.text.trim() : '';
  } catch {
    return '';
  }
}

export async function transcribeVoice(input: {
  audioBase64: string;
  format: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<TranscribeResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? VOICE_TIMEOUT_MS);

  try {
    const res = await fetchImpl(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
        'HTTP-Referer': SITE_URL,
        'X-Title': 'QatliA WhatsApp',
      },
      body: JSON.stringify({
        model: input.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: TRANSCRIBE_PROMPT },
              { type: 'input_audio', input_audio: { data: input.audioBase64, format: input.format } },
            ],
          },
        ],
        max_tokens: 1000,
        temperature: 0,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`[whatsapp] voice: OpenRouter answered ${res.status}`);
      return { status: 'error', reason: `http_${res.status}` };
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }> };
    const choice = data?.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== 'string') {
      const reason = typeof choice?.finish_reason === 'string' ? choice.finish_reason.slice(0, 40) : 'unknown';
      console.error(`[whatsapp] voice: unusable transcription (finish_reason=${reason})`);
      return { status: 'error', reason: 'unusable' };
    }

    const text = readTranscript(content);
    if (!hasWords(text)) return { status: 'empty' };
    return { status: 'ok', text: text.slice(0, MAX_INBOUND_CHARS) };
  } catch (error) {
    const name = error instanceof Error ? error.name : 'unknown';
    console.error(`[whatsapp] voice: transcription request failed (${name})`);
    return { status: 'error', reason: 'request_failed' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Hears one voice note: the daily cap of the number, the download, the
 * transcription. Never throws; whatever stops it is a reason code, logged.
 */
export async function hearVoice(input: {
  config: Pick<WhatsAppConfig, 'accessToken' | 'graphVersion' | 'openrouterKey' | 'voiceModel'>;
  event: Pick<InboundEvent, 'mediaId'>;
  now: Date;
  /** Voice notes this number sent since the given instant, the current one included. */
  countVoices: (since: Date) => Promise<number>;
  fetchImpl?: typeof fetch;
}): Promise<HearResult> {
  const unheard = (reason: string, status?: number): HearResult => {
    console.error(`[whatsapp] voice: not heard (${reason}${status ? `, status ${status}` : ''})`);
    return { status: 'unheard', reason };
  };
  const { config, event } = input;
  if (!config.openrouterKey) return unheard('no_key');
  if (!event.mediaId) return unheard('no_media');

  if ((await input.countVoices(new Date(input.now.getTime() - DAY_MS))) > MAX_VOICES_PER_DAY) return unheard('daily_cap');

  const media = await fetchMediaDataUrl(config, event.mediaId, input.fetchImpl, 'audio');
  if (!media.ok) return unheard(`media_${media.reason}`, media.status);
  const format = AUDIO_FORMATS[media.mimeType];
  if (!format) return unheard('media_bad_type');

  const transcript = await transcribeVoice({
    audioBase64: media.dataUrl.slice(media.dataUrl.indexOf(',') + 1),
    format,
    apiKey: config.openrouterKey,
    model: config.voiceModel,
    fetchImpl: input.fetchImpl,
  });
  if (transcript.status === 'ok') return { status: 'heard', text: transcript.text };
  return unheard(transcript.status === 'empty' ? 'empty' : transcript.reason);
}
