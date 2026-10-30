/**
 * The analysis pass: what makes "1 credit per complete analysis" true.
 *
 * A paid analysis (a successful scan, or the first optimization of a list typed
 * by hand) hands the browser a pass. While it is valid, /api/optimize runs for
 * free, so the artisan can fix a dimension, change the blade kerf or the panel
 * size and re-optimize without being charged again.
 *
 * The pass is stateless: an HMAC over `<userId>.<expiresAt>`, keyed from a
 * server-only secret. It carries no piece list, so within its window it covers
 * any re-optimization. That is deliberate: the only per-call cost to us is the
 * AI scan, and every scan is still charged. A forged, expired or foreign pass
 * simply means the optimization is charged as usual.
 *
 * Pure module: the secret and the clock are passed in, so it can be tested
 * without env or time travel.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { ANALYSIS_WINDOW_HOURS } from './policy';
import { isUuid } from './grant';

const WINDOW_MS = ANALYSIS_WINDOW_HOURS * 60 * 60 * 1000;

/** Scopes the derived key, so the service-role key is never used as-is. */
const KEY_LABEL = 'qatlia-analysis-pass-v1';

function sign(secret: string, payload: string): string {
  const key = createHmac('sha256', secret).update(KEY_LABEL).digest();
  return createHmac('sha256', key).update(payload).digest('base64url');
}

/**
 * A new pass for `userId`, valid for ANALYSIS_WINDOW_HOURS from `now`, or null
 * when one cannot be issued. Never throws: it runs after the credit is debited,
 * and a missing pass only means the next optimization is charged.
 */
export function issueAnalysisPass(
  secret: string | null | undefined,
  userId: string,
  now: number = Date.now()
): string | null {
  if (!secret || !isUuid(userId)) return null;
  const payload = `${userId}.${now + WINDOW_MS}`;
  return `${payload}.${sign(secret, payload)}`;
}

/** True only for an unexpired pass this server signed for this very user. */
export function verifyAnalysisPass(
  secret: string | null | undefined,
  pass: unknown,
  userId: string,
  now: number = Date.now()
): boolean {
  if (!secret || typeof pass !== 'string' || pass.length > 256) return false;
  const parts = pass.split('.');
  if (parts.length !== 3) return false;
  const [passUser, expiresRaw, signature] = parts;
  if (passUser !== userId) return false;

  const expiresAt = Number(expiresRaw);
  // A pass can never be valid for longer than one window, whatever it claims.
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + WINDOW_MS) return false;

  const expected = Buffer.from(sign(secret, `${passUser}.${expiresRaw}`));
  const received = Buffer.from(signature);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** The pass secret: the service-role key, already required by every metered route. */
export function analysisPassSecret(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return key ? key : null;
}
