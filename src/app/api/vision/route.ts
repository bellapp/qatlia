import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminConfig, isPlaceholder, isProductionEnv } from '@/lib/billing/config';
import { MAX_SCANS_PER_ANALYSIS, VISION_CREDIT_COST } from '@/lib/billing/policy';
import { analysisPassSecret, issueAnalysisPass } from '@/lib/billing/analysis-pass';
import { claimScanRead, openScanGroup, requestedScanGroup, scanGroupHasRoom } from '@/lib/billing/scan-group';
import { createRateLimiter, VISION_RATE_LIMIT } from '@/lib/rate-limit';
import { readCutList } from '@/lib/vision/read-cut-list';

const MAX_IMAGE_DATA_URL_LENGTH = 8 * 1024 * 1024;
const VisionSchema = z.object({
  imageBase64: z.string()
    .max(MAX_IMAGE_DATA_URL_LENGTH)
    .regex(/^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=\r\n]+$/),
  sheetMaterial: z.string().default('mdf'),
  // The scan group of the project's earlier photos (see scan-group.ts). Taken
  // only when it is a UUID; anything else reads as no group, never a 400.
  scanGroup: z.unknown().optional(),
});

/**
 * One limiter per server instance, so the counters survive between requests.
 * It brakes a burst from a single account; the ledger is what bounds spend
 * (see the scope note in src/lib/rate-limit.ts).
 */
const visionRateLimiter = createRateLimiter(VISION_RATE_LIMIT);

export const maxDuration = 60; // 60s timeout Vercel
export const dynamic = 'force-dynamic';

type AdminClient = SupabaseClient;

/** The service-role client, or null when the ledger is not configured. */
function createLedgerClient(): AdminClient | null {
  const adminConfig = getSupabaseAdminConfig();
  if (!adminConfig) return null;
  return createAdminClient(adminConfig.url, adminConfig.serviceRoleKey);
}

type PreflightOutcome =
  | { status: 'ok'; balance: number }
  | { status: 'insufficient'; balance: number }
  | { status: 'error' };

/**
 * Read the caller's balance before anything billable happens.
 *
 * `ensure_profile` backfills a missing profile and returns the current credits
 * as an INT — it never rewrites an existing balance. Refusing here is what keeps
 * an account with nothing to spend from driving the upstream model: the debit
 * afterwards is still the authoritative one, this only avoids paying for a call
 * whose result could never be sold.
 */
async function preflightVisionCredits(
  supabaseAdmin: AdminClient,
  userId: string,
  email: string | undefined
): Promise<PreflightOutcome> {
  const { data, error } = await supabaseAdmin.rpc('ensure_profile', {
    p_user_id: userId,
    p_email: email || null,
    p_full_name: null,
  });

  // No readable balance means the ledger is unavailable, not that it is zero.
  if (error || typeof data !== 'number') {
    if (error) console.error('ensure_profile failed:', error.message);
    return { status: 'error' };
  }

  if (data < VISION_CREDIT_COST) return { status: 'insufficient', balance: data };
  return { status: 'ok', balance: data };
}

type ConsumeOutcome =
  | { status: 'charged'; balance: number | null }
  | { status: 'insufficient'; balance: number }
  | { status: 'error' };

/**
 * Debit the single credit this analysis costs.
 *
 * `consume_credit` is a SECURITY DEFINER function that locks the profile row,
 * so two concurrent analyses can never spend the same last credit twice — the
 * preflight above is advisory, this is the decision.
 */
async function consumeVisionCredit(supabaseAdmin: AdminClient, userId: string): Promise<ConsumeOutcome> {
  const { data, error } = await supabaseAdmin.rpc('consume_credit', {
    p_user_id: userId,
    p_amount: VISION_CREDIT_COST,
    p_reason: 'vision',
  });

  if (error) {
    console.error('consume_credit failed:', error.message);
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
        { error: 'AUTH_REQUIRED', message: 'Connectez-vous pour analyser une photo de fiche de débit.' },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = VisionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'INVALID_INPUT', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { imageBase64 } = parsed.data;
    const presentedGroup = requestedScanGroup(parsed.data.scanGroup);

    // Authenticated but scripted: brake the burst before it can spend anything.
    const rateLimit = visionRateLimiter.check(user.id);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: 'RATE_LIMITED',
          message: 'Trop d\'analyses en peu de temps. Patientez un instant avant de réessayer.',
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      );
    }

    const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;

    // No analysis provider configured: checked before anything billable.
    if (isPlaceholder(apiKey)) {
      // In production that is a broken deployment, not a demo: handing out
      // sample pieces would look like a successful analysis of the real photo.
      if (isProductionEnv()) {
        return NextResponse.json(
          {
            error: 'VISION_UNAVAILABLE',
            message: 'L\'analyse photo est momentanément indisponible. Réessayez dans un instant.',
          },
          { status: 503 }
        );
      }

      // Outside production: sample data only, and never a debit.
      return NextResponse.json({
        success: true,
        demo: true,
        extractionId: 'demo_' + Date.now(),
        pieces: [
          { name: 'Panneau Haut', width: 200, height: 60, quantity: 2 },
          { name: 'Panneau Bas', width: 200, height: 60, quantity: 2 },
          { name: 'Côté Droit', width: 180, height: 50, quantity: 2 },
          { name: 'Étagère', width: 96, height: 48, quantity: 4 },
          { name: 'Séparation', width: 85, height: 45, quantity: 2 },
        ],
        creditsCharged: 0,
        notes: 'Mode Démo : 5 types de pièces extraites. Aucun crédit débité.',
      });
    }

    // From here the call is billable, so it may only happen once we know we can
    // bill for it. The same client serves the preflight and the debit below.
    const supabaseAdmin = createLedgerClient();
    if (!supabaseAdmin) {
      console.error('Vision refused: Supabase admin credentials are not configured');
      return NextResponse.json(
        { error: 'CREDIT_LEDGER_UNAVAILABLE', message: 'Le décompte des crédits est indisponible. Réessayez dans un instant.' },
        { status: 503 }
      );
    }

    // A later photo of a project whose first was paid: while its group has
    // room, the read is covered and the balance is not the question. The claim
    // after the read decides; a group that filled up meanwhile is charged then.
    const coveredGroup =
      presentedGroup && (await scanGroupHasRoom(supabaseAdmin, user.id, presentedGroup)) ? presentedGroup : null;

    if (!coveredGroup) {
      const preflight = await preflightVisionCredits(supabaseAdmin, user.id, user.email);

      if (preflight.status === 'error') {
        return NextResponse.json(
          { error: 'CREDIT_LEDGER_UNAVAILABLE', message: 'Le décompte des crédits est indisponible. Réessayez dans un instant.' },
          { status: 503 }
        );
      }

      if (preflight.status === 'insufficient') {
        return NextResponse.json(
          {
            error: 'INSUFFICIENT_CREDITS',
            message: 'Votre solde de crédits est épuisé. Rechargez votre compte pour analyser une nouvelle photo.',
            creditsRemaining: preflight.balance,
          },
          { status: 402 }
        );
      }
    }

    // The read itself (src/lib/vision/read-cut-list.ts): the same request the
    // site always sent. Any failure means the artisan got nothing, so nothing is debited.
    const read = await readCutList(imageBase64);
    if (read.status === 'unavailable') {
      return NextResponse.json(
        {
          error: 'VISION_UNAVAILABLE',
          message: 'L\'analyse photo est momentanément indisponible. Réessayez dans un instant.',
        },
        { status: 503 }
      );
    }
    if (read.status === 'error') {
      if (read.rateLimited) {
        return NextResponse.json(
          { error: 'AI_RATE_LIMIT', message: 'Service temporairement saturé. Veuillez réessayer dans un instant.' },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { error: 'AI_SERVICE_ERROR', message: `Erreur d'analyse (${read.httpStatus}). Veuillez réessayer avec une photo plus nette.` },
        { status: 502 }
      );
    }
    if (read.status === 'unreadable') {
      return NextResponse.json(
        {
          error: 'AI_PARSE_ERROR',
          message: 'Aucune mesure lisible n\'a été détectée. Vérifiez que la photo est nette et bien cadrée.',
        },
        { status: 422 }
      );
    }
    const { pieces } = read;

    // A covered read counts in its group and costs nothing. One conditional
    // update decides, so two photos racing for the last place cannot both win:
    // the loser is charged below like any first photo.
    if (coveredGroup) {
      const readsUsed = await claimScanRead(supabaseAdmin, user.id, coveredGroup);
      if (readsUsed !== null) {
        return NextResponse.json({
          success: true,
          extractionId: 'ext_' + Date.now(),
          pieces,
          creditsCharged: 0,
          scanGroup: coveredGroup,
          scansLeft: Math.max(0, MAX_SCANS_PER_ANALYSIS - readsUsed),
          notes: `${pieces.length} pièces extraites avec succès`,
        });
      }
    }

    // A valid, successfully parsed analysis is the only thing that costs a credit.
    const outcome = await consumeVisionCredit(supabaseAdmin, user.id);

    // The preflight saw credits, so reaching this means a concurrent analysis
    // took the last one. The loser of that race pays nothing and, because the
    // result was never paid for, is not shown it either.
    if (outcome.status === 'insufficient') {
      return NextResponse.json(
        {
          error: 'INSUFFICIENT_CREDITS',
          message: 'Votre solde de crédits est épuisé. Rechargez votre compte pour analyser une nouvelle photo.',
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

    // The scan opens the analysis: re-optimizing this list is free for the
    // window (see src/lib/billing/analysis-pass.ts).
    const analysisPass = issueAnalysisPass(analysisPassSecret(), user.id);
    // The paid read opens the project's group: its next photos ride on it. No
    // group (ledger error, migration 018 not applied) only means they are
    // charged one by one, as before.
    const openedGroup = await openScanGroup(supabaseAdmin, user.id);

    return NextResponse.json({
      success: true,
      extractionId: 'ext_' + Date.now(),
      ...(analysisPass ? { analysisPass } : {}),
      pieces,
      creditsCharged: VISION_CREDIT_COST,
      ...(outcome.balance !== null ? { creditsRemaining: outcome.balance } : {}),
      ...(openedGroup ? { scanGroup: openedGroup, scansLeft: MAX_SCANS_PER_ANALYSIS - 1 } : {}),
      notes: `${pieces.length} pièces extraites avec succès`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erreur inconnue';
    console.error('Vision processing failed:', message);
    return NextResponse.json(
      { error: 'VISION_PROCESSING_FAILED', message: 'L\'analyse a échoué. Réessayez avec une photo plus nette.' },
      { status: 500 }
    );
  }
}
