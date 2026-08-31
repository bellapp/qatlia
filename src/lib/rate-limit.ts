/**
 * A small sliding-window rate limiter.
 *
 * SCOPE — read this before relying on it.
 *
 * The counters live in the memory of a single Node process. On a multi-instance
 * or serverless deployment (which is how this app is hosted) each instance
 * keeps its own counters, so the effective ceiling is roughly
 * `limit x number of live instances`, and a cold start resets it. This is a
 * best-effort brake on one caller hammering one instance — it is deliberately
 * *not* a distributed quota, and nothing here should be described as one. The
 * hard bound on what a user can spend remains the credit ledger, which is
 * atomic and shared (see supabase/migrations/005_credit_policy.sql).
 *
 * Everything is injected — the clock and the store — so the behaviour is
 * asserted deterministically in tests instead of by sleeping.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Requests still available in the current window (0 once denied). */
  remaining: number;
  limit: number;
  /** Whole seconds until the caller may retry; 0 while allowed. */
  retryAfterSeconds: number;
}

export interface RateLimiterOptions {
  /** Requests permitted per key per window. */
  limit: number;
  windowMs: number;
  /** Injected clock; defaults to the wall clock. */
  now?: () => number;
  /**
   * Hard cap on tracked keys, so a flood of distinct keys cannot grow the map
   * without bound. Expired keys are pruned first; the least recently seen keys
   * are evicted only if that is not enough.
   */
  maxKeys?: number;
}

export interface RateLimiter {
  /** Records a hit for `key` and reports whether it is permitted. */
  check(key: string): RateLimitDecision;
  /** Number of keys currently tracked. Exposed for tests and diagnostics. */
  size(): number;
}

/**
 * The Vision preflight budget: 10 analyses per minute per user.
 *
 * Sized to be invisible to an artisan photographing a stack of cut lists one
 * after another, while stopping a scripted loop from driving the upstream model
 * flat out. Chosen conservatively because the cost of being slightly too strict
 * is a 429 the client can retry, and the cost of being too loose is a bill.
 */
export const VISION_RATE_LIMIT = { limit: 10, windowMs: 60_000 } as const;

/**
 * The client-quotation PDF budget: 15 generations per minute per user.
 *
 * A quotation render is real work (jsPDF + autoTable + optionally the
 * embedded Amiri font, plus a DB read/write when a projectId is supplied) but
 * costs no credit — sized generously enough that an artisan iterating on a
 * quote's discount/notes before sending it never sees a 429, while still
 * stopping a scripted loop from hammering the renderer or the DB.
 */
export const QUOTATION_RATE_LIMIT = { limit: 15, windowMs: 60_000 } as const;

export function createRateLimiter({ limit, windowMs, now = Date.now, maxKeys = 10_000 }: RateLimiterOptions): RateLimiter {
  if (!Number.isInteger(limit) || limit <= 0 || !Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error(`INVALID_RATE_LIMIT: limit=${String(limit)} windowMs=${String(windowMs)}`);
  }

  // key -> timestamps of the hits still inside the window, oldest first.
  const hits = new Map<string, number[]>();

  const prune = (cutoff: number) => {
    hits.forEach((timestamps: number[], key: string) => {
      const live = timestamps.filter((timestamp: number) => timestamp > cutoff);
      if (live.length === 0) hits.delete(key);
      else hits.set(key, live);
    });
  };

  return {
    check(key: string): RateLimitDecision {
      const current = now();
      const cutoff = current - windowMs;

      const live = (hits.get(key) || []).filter((timestamp) => timestamp > cutoff);

      if (live.length >= limit) {
        // Denied requests are not recorded: otherwise a caller that keeps
        // retrying would keep pushing its own window forward and never recover.
        hits.set(key, live);
        const retryAfterMs = live[0] + windowMs - current;
        return {
          allowed: false,
          remaining: 0,
          limit,
          retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
        };
      }

      live.push(current);
      hits.set(key, live);

      if (hits.size > maxKeys) {
        prune(cutoff);
        // Still over: drop the least recently seen keys. Evicting a key only
        // forgives past requests, it never denies a legitimate one.
        if (hits.size > maxKeys) {
          const byRecency = Array.from(hits.entries()).sort(
            (a, b) => a[1][a[1].length - 1] - b[1][b[1].length - 1]
          );
          for (const [staleKey] of byRecency.slice(0, hits.size - maxKeys)) {
            if (staleKey !== key) hits.delete(staleKey);
          }
        }
      }

      return { allowed: true, remaining: limit - live.length, limit, retryAfterSeconds: 0 };
    },

    size(): number {
      prune(now() - windowMs);
      return hits.size;
    },
  };
}
