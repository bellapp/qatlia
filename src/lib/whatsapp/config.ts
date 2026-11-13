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
}

const DEFAULT_GRAPH_VERSION = 'v23.0';
const DEFAULT_MODEL = 'google/gemini-3.7-flash';

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
  };
}
