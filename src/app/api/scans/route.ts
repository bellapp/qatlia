import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getSupabaseAdminConfig } from '@/lib/billing/config';
import { createRateLimiter, SCAN_RATE_LIMIT } from '@/lib/rate-limit';
import { SCAN_BUCKET, SCAN_IMAGE_MAX_CHARS, parseScanImage, scanPathFor } from '@/lib/projects/scan-image';

/**
 * `POST /api/scans` — keeps the reduced scan image of a project in the
 * private `scans` bucket and answers with its path. Only server routes reach
 * the bucket, with the service key: the artisan's id comes from the session
 * and the file id from the server, never from the request body. The path is
 * stored with the project by `POST /api/projects`.
 */

/** One limiter per server instance (see the scope note in src/lib/rate-limit.ts). */
const scanRateLimiter = createRateLimiter(SCAN_RATE_LIMIT);

// The dataURL plus the JSON wrapper around it.
const MAX_BODY_BYTES = SCAN_IMAGE_MAX_CHARS + 1_000;

const INVALID_IMAGE = { error: 'INVALID_IMAGE', message: 'Image invalide.' };
const STORAGE_UNAVAILABLE = {
  error: 'SCAN_STORAGE_UNAVAILABLE',
  message: "L'image du scan n'a pas pu être gardée.",
};

export async function POST(request: Request) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'AUTH_REQUIRED', message: 'Connectez-vous pour garder une image.' }, { status: 401 });
    }

    // Free sign-up and a permanent object per call: brake a scripted loop
    // before the body is even read.
    const rateLimit = scanRateLimiter.check(user.id);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: 'RATE_LIMITED',
          message: "Trop d'images en peu de temps. Patientez un instant avant de réessayer.",
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      );
    }

    const declaredLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return NextResponse.json(INVALID_IMAGE, { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(INVALID_IMAGE, { status: 400 });
    }
    const image = parseScanImage(body && typeof body === 'object' ? (body as Record<string, unknown>).image : null);
    if (!image) return NextResponse.json(INVALID_IMAGE, { status: 400 });

    const adminConfig = getSupabaseAdminConfig();
    if (!adminConfig) return NextResponse.json(STORAGE_UNAVAILABLE, { status: 503 });

    const admin = createAdminClient(adminConfig.url, adminConfig.serviceRoleKey);
    const scanPath = scanPathFor(user.id, crypto.randomUUID(), image.ext);
    const { error } = await admin.storage
      .from(SCAN_BUCKET)
      .upload(scanPath, image.bytes, { contentType: image.mime, upsert: false });
    if (error) {
      console.error('Erreur envoi image scan:', error.message);
      return NextResponse.json(STORAGE_UNAVAILABLE, { status: 503 });
    }

    return NextResponse.json({ success: true, scanPath });
  } catch (err: unknown) {
    console.error('Erreur image scan:', err instanceof Error ? err.message : err);
    return NextResponse.json(STORAGE_UNAVAILABLE, { status: 503 });
  }
}
