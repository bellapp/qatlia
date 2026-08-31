import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminConfig, isPlaceholder, isProductionEnv } from '@/lib/billing/config';
import { VISION_CREDIT_COST } from '@/lib/billing/policy';
import { createRateLimiter, VISION_RATE_LIMIT } from '@/lib/rate-limit';

const MAX_IMAGE_DATA_URL_LENGTH = 8 * 1024 * 1024;
const VisionSchema = z.object({
  imageBase64: z.string()
    .max(MAX_IMAGE_DATA_URL_LENGTH)
    .regex(/^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=\r\n]+$/),
  sheetMaterial: z.string().default('mdf'),
});

/**
 * One limiter per server instance, so the counters survive between requests.
 * It brakes a burst from a single account; the ledger is what bounds spend
 * (see the scope note in src/lib/rate-limit.ts).
 */
const visionRateLimiter = createRateLimiter(VISION_RATE_LIMIT);

export const maxDuration = 60; // 60s timeout Vercel
export const dynamic = 'force-dynamic';

function extractJson(text: string): { pieces?: Array<{ name?: string; width: number | string; height: number | string; quantity?: number | string }> } | null {
  let cleaned = text.trim();
  // Strip Markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // Try direct parse
  try {
    return JSON.parse(cleaned);
  } catch {}

  // Find first { and last }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const substr = cleaned.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(substr);
    } catch {}
  }

  // Find [ ... ] if array returned
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    const substr = cleaned.substring(firstBracket, lastBracket + 1);
    try {
      const arr = JSON.parse(substr);
      return { pieces: arr };
    } catch {}
  }

  return null;
}

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

    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const apiKey = openrouterKey || openaiKey;
    const isUsingOpenRouter = !isPlaceholder(openrouterKey);

    // No analysis provider configured.
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

    const systemPrompt = `Tu es un expert en lecture de fiches de débit pour menuisiers et artisans.
Tu dois analyser attentivement l'image et extraire les dimensions EXACTES de chaque ligne sous la convention : HAUTEUR (Y) × LARGEUR (X) = QUANTITÉ en CENTIMÈTRES (cm).

Règles impératives :
1. Extrais les cotes en centimètres (cm). Si l'image contient des millimètres (ex: 2300 x 1200 ou 418.00 x 380.00), convertis en centimètres (ex: 230 x 120, 41.8 x 38).
2. La quantité est le nombre à droite (ex: "418 x 380   7" -> height: 41.8, width: 38, quantity: 7).
3. Retourne STRICTEMENT un objet JSON :
{
  "pieces": [
    { "name": "Pièce 1", "height": 230, "width": 120, "quantity": 2 },
    { "name": "Pièce 2", "height": 118, "width": 48, "quantity": 1 },
    { "name": "Pièce 3", "height": 41.8, "width": 38, "quantity": 7 },
    { "name": "Pièce 4", "height": 53.1, "width": 48, "quantity": 4 },
    { "name": "Pièce 5", "height": 51.3, "width": 48, "quantity": 2 }
  ]
}`;

    const userPrompt = `Extrais la liste des pièces de cette image sous format JSON {"pieces": [...]}.`;

    const endpoint = isUsingOpenRouter
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';

    const model = isUsingOpenRouter
      ? (process.env.OPENROUTER_MODEL || 'google/gemini-3.7-flash')
      : 'gpt-4o-mini';

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(isUsingOpenRouter
          ? {
              'HTTP-Referer': 'https://qatlia.vercel.app',
              'X-Title': 'QatlIA Cutting Optimization',
            }
          : {}),
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: userPrompt },
              { type: 'image_url', image_url: { url: imageBase64 } },
            ],
          },
        ],
      }),
    });

    // Upstream failure: the artisan got nothing, so nothing is debited.
    if (!res.ok) {
      const errText = await res.text();
      console.error('Vision API error:', errText);
      if (errText.includes('rate limit') || errText.includes('429')) {
        return NextResponse.json(
          { error: 'AI_RATE_LIMIT', message: 'Service temporairement saturé. Veuillez réessayer dans un instant.' },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { error: 'AI_SERVICE_ERROR', message: `Erreur d'analyse (${res.status}). Veuillez réessayer avec une photo plus nette.` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content || '';
    const parsedJson = extractJson(rawContent);

    // Nothing readable was extracted: no usable result, so no debit.
    if (!parsedJson || !Array.isArray(parsedJson.pieces) || parsedJson.pieces.length === 0) {
      return NextResponse.json(
        {
          error: 'AI_PARSE_ERROR',
          message: 'Aucune mesure lisible n\'a été détectée. Vérifiez que la photo est nette et bien cadrée.',
        },
        { status: 422 }
      );
    }

    // Normalisation des pièces (toujours en centimètres canoniques)
    const rawPieces = parsedJson.pieces || [];
    const pieces = rawPieces.map((p: { name?: string; height?: number | string; width?: number | string; quantity?: number | string }, i: number) => ({
      name: p.name ? String(p.name).trim() : `Pièce ${i + 1}`,
      height: Math.abs(parseFloat(String(p.height || 10))),
      width: Math.abs(parseFloat(String(p.width || 10))),
      quantity: Math.max(1, parseInt(String(p.quantity || 1), 10) || 1),
    }));

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

    return NextResponse.json({
      success: true,
      extractionId: 'ext_' + Date.now(),
      pieces,
      creditsCharged: VISION_CREDIT_COST,
      ...(outcome.balance !== null ? { creditsRemaining: outcome.balance } : {}),
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
