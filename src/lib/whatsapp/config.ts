/**
 * Fail-safe read of the WhatsApp bot environment.
 *
 * Pure: the environment is passed in (defaulting to `process.env`), so the
 * behaviour can be asserted without touching the ambient process.
 */

import { isPlaceholder } from '@/lib/billing/config';

export type HandoffMode = 'coexistence' | 'redirect';

export interface WhatsAppConfig {
  appSecret: string;
  verifyToken: string;
  accessToken: string;
  phoneNumberId: string;
  graphVersion: string;
  enabled: boolean;
  handoffMode: HandoffMode;
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

/** Returns `null` when any credential is missing or still a placeholder. */
export function getWhatsAppConfig(env: Env = process.env): WhatsAppConfig | null {
  const appSecret = read(env, 'WHATSAPP_APP_SECRET');
  const verifyToken = read(env, 'WHATSAPP_VERIFY_TOKEN');
  const accessToken = read(env, 'WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = read(env, 'WHATSAPP_PHONE_NUMBER_ID');
  if (!appSecret || !verifyToken || !accessToken || !phoneNumberId) return null;

  return {
    appSecret,
    verifyToken,
    accessToken,
    phoneNumberId,
    graphVersion: read(env, 'WHATSAPP_GRAPH_VERSION') ?? DEFAULT_GRAPH_VERSION,
    enabled: env.WHATSAPP_BOT_ENABLED === 'true',
    handoffMode: env.WHATSAPP_HANDOFF_MODE === 'redirect' ? 'redirect' : 'coexistence',
    model: read(env, 'WHATSAPP_BOT_MODEL') ?? read(env, 'OPENROUTER_MODEL') ?? DEFAULT_MODEL,
    openrouterKey: read(env, 'OPENROUTER_API_KEY'),
  };
}
