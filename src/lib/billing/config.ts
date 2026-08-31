/**
 * Fail-safe reads of the billing-related environment.
 *
 * Every helper takes the environment explicitly (defaulting to `process.env`)
 * so the behaviour can be asserted without mutating the ambient process, and so
 * "configured" always means "a real, non-placeholder value is present".
 */

export type Env = Record<string, string | undefined>;

const PLACEHOLDER_MARKERS = ['placeholder', 'your_', 'your-', 'xxx', 'changeme', 'todo'];

/** A value is a placeholder when it is missing, blank, or a template default. */
export function isPlaceholder(value: string | undefined | null): boolean {
  if (typeof value !== 'string') return true;
  const trimmed = value.trim();
  if (trimmed === '') return true;
  const lowered = trimmed.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lowered.includes(marker));
}

export function isProductionEnv(env: Env = process.env): boolean {
  return env.NODE_ENV === 'production';
}

/** True only when a real Stripe secret key is present. */
export function isStripeConfigured(env: Env = process.env): boolean {
  const key = env.STRIPE_SECRET_KEY;
  return !isPlaceholder(key) && /^sk_/.test((key as string).trim());
}

/**
 * The demo checkout link grants nothing but *looks* like a successful purchase,
 * so it is only ever acceptable outside production and only while Stripe is
 * genuinely unconfigured. Production with a placeholder key must fail closed.
 */
export function allowDemoCheckout(env: Env = process.env): boolean {
  return !isProductionEnv(env) && !isStripeConfigured(env);
}

/** The verified webhook secret, or null when it is absent/placeholder. */
export function getWebhookSecret(env: Env = process.env): string | null {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  return isPlaceholder(secret) ? null : (secret as string).trim();
}

/** True only when a real Supabase URL *and* service-role key are both present. */
export function isSupabaseAdminConfigured(env: Env = process.env): boolean {
  return !isPlaceholder(env.NEXT_PUBLIC_SUPABASE_URL) && !isPlaceholder(env.SUPABASE_SERVICE_ROLE_KEY);
}

export function getSupabaseAdminConfig(env: Env = process.env): { url: string; serviceRoleKey: string } | null {
  if (!isSupabaseAdminConfigured(env)) return null;
  return {
    url: (env.NEXT_PUBLIC_SUPABASE_URL as string).trim(),
    serviceRoleKey: (env.SUPABASE_SERVICE_ROLE_KEY as string).trim(),
  };
}
