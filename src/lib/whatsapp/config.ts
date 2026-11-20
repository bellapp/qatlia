/**
 * Fail-safe read of the WhatsApp bot environment.
 *
 * Pure: the environment is passed in (defaulting to `process.env`), so the
 * behaviour can be asserted without touching the ambient process.
 */

import { isPlaceholder } from '@/lib/billing/config';

export type HandoffMode = 'coexistence' | 'redirect';
/** Who the bot answers in coexistence mode: only people who came from the ad, or everyone. */
export type BotScope = 'ads' | 'all';

/**
 * Replies go through YCloud when the bot number was onboarded with it: Meta then
 * only lets YCloud send from that number. Inbound still arrives through Meta.
 */
export interface YCloudConfig {
  apiKey: string;
  /** The bot number in E.164 (e.g. +212726263686). */
  from: string;
}

export interface WhatsAppConfig {
  appSecret: string;
  verifyToken: string;
  accessToken: string;
  phoneNumberId: string;
  graphVersion: string;
  enabled: boolean;
  handoffMode: HandoffMode;
  scope: BotScope;
  model: string;
  openrouterKey: string | null;
  /** `null`: replies go straight to the Meta Graph API. */
  ycloud: YCloudConfig | null;
  /** Photos of cut lists the bot may read per 24 hours, all numbers together; 0 turns the reading off. */
  photoDailyCap: number;
  /** Voice notes are transcribed and answered; `WHATSAPP_VOICE_ENABLED=false` brings back the old "write to me" reply. */
  voiceEnabled: boolean;
  /** Its own model: the text model of the bot may not take audio. */
  voiceModel: string;
}

const DEFAULT_PHOTO_DAILY_CAP = 300;

function readPhotoDailyCap(env: Env): number {
  const raw = env.WHATSAPP_PHOTO_DAILY_CAP;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return DEFAULT_PHOTO_DAILY_CAP;
  return Number(raw.trim());
}

const DEFAULT_GRAPH_VERSION = 'v23.0';
const DEFAULT_MODEL = 'google/gemini-3.7-flash';
const DEFAULT_VOICE_MODEL = 'google/gemini-3.7-flash';

type Env = Record<string, string | undefined>;

function read(env: Env, key: string): string | null {
  const value = env[key];
  return isPlaceholder(value) ? null : (value as string).trim();
}

// Real tokens are long random strings that can contain "xxx" or "todo" by
// chance, so the four secrets are only rejected when they are exactly a known
// placeholder (or start with the usual template markers).
const EXACT_PLACEHOLDERS: ReadonlySet<string> = new Set(['changeme', 'todo', 'xxx', 'placeholder']);

function readSecret(env: Env, key: string): string | null {
  const value = env[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const lowered = trimmed.toLowerCase();
  if (EXACT_PLACEHOLDERS.has(lowered) || lowered.startsWith('your_') || lowered.startsWith('<')) return null;
  return trimmed;
}

/** The sender number in E.164, or `null` when it is missing or not a phone number. */
function readFromNumber(env: Env): string | null {
  const value = read(env, 'WHATSAPP_FROM_NUMBER');
  if (!value) return null;
  const digits = value.replace(/[\s().-]/g, '').replace(/^\+/, '');
  return /^[0-9]{8,15}$/.test(digits) ? `+${digits}` : null;
}

function readYCloud(env: Env): YCloudConfig | null {
  const apiKey = readSecret(env, 'YCLOUD_API_KEY');
  const from = readFromNumber(env);
  return apiKey && from ? { apiKey, from } : null;
}

/** Returns `null` when any credential is missing or still a placeholder. */
export function getWhatsAppConfig(env: Env = process.env): WhatsAppConfig | null {
  const appSecret = readSecret(env, 'WHATSAPP_APP_SECRET');
  const verifyToken = readSecret(env, 'WHATSAPP_VERIFY_TOKEN');
  const accessToken = readSecret(env, 'WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = readSecret(env, 'WHATSAPP_PHONE_NUMBER_ID');
  if (!appSecret || !verifyToken || !accessToken || !phoneNumberId) return null;

  return {
    appSecret,
    verifyToken,
    accessToken,
    phoneNumberId,
    graphVersion: read(env, 'WHATSAPP_GRAPH_VERSION') ?? DEFAULT_GRAPH_VERSION,
    enabled: env.WHATSAPP_BOT_ENABLED === 'true',
    handoffMode: env.WHATSAPP_HANDOFF_MODE === 'redirect' ? 'redirect' : 'coexistence',
    scope: env.WHATSAPP_BOT_SCOPE === 'all' ? 'all' : 'ads',
    model: read(env, 'WHATSAPP_BOT_MODEL') ?? read(env, 'OPENROUTER_MODEL') ?? DEFAULT_MODEL,
    openrouterKey: read(env, 'OPENROUTER_API_KEY'),
    ycloud: readYCloud(env),
    photoDailyCap: readPhotoDailyCap(env),
    voiceEnabled: env.WHATSAPP_VOICE_ENABLED?.trim().toLowerCase() !== 'false',
    voiceModel: read(env, 'WHATSAPP_VOICE_MODEL') ?? DEFAULT_VOICE_MODEL,
  };
}
