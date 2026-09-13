import { NextResponse } from 'next/server';
import { optimizeCutting2D, optimizeCutting1D, Piece, Sheet, OptimizationOptions } from '@/lib/cutting/binpacking';
import { OptimizeSchema, MAX_EXPANDED_PIECES } from '@/lib/cutting/optimize-schema';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminConfig } from '@/lib/billing/config';
import { OPTIMIZE_CREDIT_COST } from '@/lib/billing/policy';

/**
 * POST /api/optimize — the credit-metered optimization entry point.
 *
 * Optimization computes entirely server-side here (the browser bundle also
 * ships the algorithm for offline display, but a PAID run must go through
 * this route: the debit is atomic, ownership-checked and cannot be skipped
 * client-side). 1 credit per successful run, manual entry and post-scan
 * alike — see CREDIT_POLICY in src/lib/billing/policy.ts.
 *
 * Anonymous visitors: the optimizer runs free WITHOUT persisting (no
 * project save, no history). This keeps the landing "try it" honest while
 * making saving + history the signed-in, metered feature. Wait — no: the
 * pricing decision is 1 credit per optimization, period. Anonymous users
 * have no wallet to debit, so they are asked to sign in (401), exactly like
 * the vision route.
 */

// 60s is the ceiling on Vercel's Hobby plan and the highest value that is
// valid on every plan we may run on (Pro allows more, Hobby hard-caps at 60).
// It must stay in sync with the pre-debit workload guard below: the guard's
// job is to reject anything that could not finish inside this window, because
// a platform timeout kills the function before any refund path can run.
export const maxDuration = 60;

type AdminClient = SupabaseClient;

/**
 * Total number of pieces the optimizer would actually place, i.e. the sum of
 * the per-row `quantity` after expansion. Runs on the RAW body, before the
 * credit is debited and before Zod validation, so every field is untrusted:
 * anything non-numeric or non-positive counts as the schema's default of 1,
 * and a non-array `pieces` yields 0 (the schema will reject it later, on the
 * refundable path).
 */
function estimateExpandedPieceCount(body: unknown): number {
  const pieces = (body as { pieces?: unknown } | null)?.pieces;
  if (!Array.isArray(pieces)) return 0;
  let total = 0;
  for (const piece of pieces) {
    const raw = Number((piece as { quantity?: unknown } | null)?.quantity);
    total += Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1;
  }
  return total;
}

function createLedgerClient(): AdminClient | null {
  const adminConfig = getSupabaseAdminConfig();
  if (!adminConfig) return null;
  return createAdminClient(adminConfig.url, adminConfig.serviceRoleKey);
}

type ConsumeOutcome =
  | { status: 'charged'; balance: number | null }
  | { status: 'insufficient'; balance: number }
  | { status: 'error' };

async function consumeOptimizeCredit(supabaseAdmin: AdminClient, userId: string): Promise<ConsumeOutcome> {
  const { data, error } = await supabaseAdmin.rpc('consume_credit', {
    p_user_id: userId,
    p_amount: OPTIMIZE_CREDIT_COST,
    p_reason: 'optimize',
  });

  if (error) {
    console.error('consume_credit (optimize) failed:', error.message);
    return { status: 'error' };
  }

  const result = (data || {}) as { success?: boolean; balance?: number; error?: string };
  if (result.success === true) {
    return { status: 'charged', balance: typeof result.balance === 'number' ? result.balance : null };
  }
  if (result.error === 'INSUFFICIENT_CREDITS') {
    return { status: 'insufficient', balance: typeof result.balance === 'number' ? result.balance : 0 };
  }
  return { status: 'error' };
}

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'AUTH_REQUIRED', message: 'Connectez-vous pour lancer une optimisation.' },
        { status: 401 }
      );
    }

    const supabaseAdmin = createLedgerClient();
    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: 'CREDIT_LEDGER_UNAVAILABLE', message: 'Le décompte des crédits est indisponible. Réessayez dans un instant.' },
        { status: 503 }
      );
    }

    const body = await req.json();

    // Pre-debit workload guard. Everything below the debit is refundable only
    // as long as our own code keeps running; a Vercel timeout is not — the
    // platform kills the function mid-computation and the refund RPC never
    // fires, leaving the artisan charged for nothing. So any payload that
    // could plausibly outlive `maxDuration` is rejected HERE, before a single
    // credit is spent. The cap is on the EXPANDED piece count (sum of
    // quantities), which is what drives binpacking cost — not on the number
    // of rows, which MAX_PIECES already bounds further down.
    const expandedPieceCount = estimateExpandedPieceCount(body);
    if (expandedPieceCount > MAX_EXPANDED_PIECES) {
      return NextResponse.json(
        {
          error: 'WORKLOAD_TOO_LARGE',
          message: `Plan trop volumineux : ${expandedPieceCount} pièces à placer pour un maximum de ${MAX_EXPANDED_PIECES}. Découpez le projet en plusieurs lots.`,
          maxPieces: MAX_EXPANDED_PIECES,
          requestedPieces: expandedPieceCount,
        },
        { status: 400 }
      );
    }

    // Debit BEFORE computing: the row lock in consume_credit serializes
    // concurrent runs, so two tabs can never spend the same last credit.
    // The computation below is deterministic and cannot fail on valid input
    // (it either throws 500 — in which case we refund — or produces a plan).
    const outcome = await consumeOptimizeCredit(supabaseAdmin, user.id);
    if (outcome.status === 'insufficient') {
      return NextResponse.json(
        {
          error: 'INSUFFICIENT_CREDITS',
          message: 'Votre solde de crédits est épuisé. Rechargez votre compte pour relancer une optimisation.',
          creditsRemaining: outcome.balance,
        },
        { status: 402 }
      );
    }
    if (outcome.status === 'error') {
      return NextResponse.json(
        { error: 'CREDIT_LEDGER_UNAVAILABLE', message: 'Le décompte des crédits est indisponible. Réessayez dans un instant.' },
        { status: 503 }
      );
    }

    // cutMode rides outside the strict geometry schema (1D bars reuse the
    // sheet width; the mode is a presentation-level switch, not geometry).
    const cutMode = body?.cutMode === '1d' ? '1d' as const : '2d' as const;
    const parsed = OptimizeSchema.safeParse(body);
    if (!parsed.success) {
      // Invalid input is the caller's fault: refund the debit.
      await supabaseAdmin.rpc('add_credits', {
        p_user_id: user.id,
        p_credits: OPTIMIZE_CREDIT_COST,
        p_stripe_payment_id: `optimize_refund_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        p_pack_id: 'refund',
      });
      console.error('Validation Optimize error:', JSON.stringify(parsed.error.format()));
      return NextResponse.json(
        { error: 'INVALID_INPUT', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { sheet, sheets, pieces, options } = parsed.data;
    const stockSheets = sheets ?? (sheet ? [sheet] : []);
    if (stockSheets.length === 0) {
      await supabaseAdmin.rpc('add_credits', {
        p_user_id: user.id,
        p_credits: OPTIMIZE_CREDIT_COST,
        p_stripe_payment_id: `optimize_refund_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        p_pack_id: 'refund',
      });
      return NextResponse.json(
        { error: 'INVALID_INPUT', details: 'Either `sheet` or a non-empty `sheets` array must be provided' },
        { status: 400 }
      );
    }

    let result;
    try {
      result = cutMode === '1d'
        ? optimizeCutting1D(pieces as Piece[], stockSheets[0].width, (options as Partial<OptimizationOptions>).kerfWidth ?? 0.3)
        : optimizeCutting2D(pieces as Piece[], stockSheets as Sheet[], options as Partial<OptimizationOptions>);
    } catch (err) {
      // Computation failed (invalid geometry combination): refund.
      await supabaseAdmin.rpc('add_credits', {
        p_user_id: user.id,
        p_credits: OPTIMIZE_CREDIT_COST,
        p_stripe_payment_id: `optimize_refund_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        p_pack_id: 'refund',
      });
      throw err;
    }

    return NextResponse.json({
      success: true,
      result,
      creditsCharged: OPTIMIZE_CREDIT_COST,
      ...(outcome.balance !== null ? { creditsRemaining: outcome.balance } : {}),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erreur inconnue';
    return NextResponse.json(
      { error: 'OPTIMIZATION_FAILED', message },
      { status: 500 }
    );
  }
}
