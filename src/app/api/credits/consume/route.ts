import { NextResponse } from 'next/server';
import { CHARGED_ACTIONS, FREE_ACTIONS } from '@/lib/billing/policy';

export const dynamic = 'force-dynamic';

/**
 * Retired endpoint.
 *
 * This route used to debit a credit on PDF export, contradicting the pricing
 * copy ("exports are free, only a successful photo analysis costs a credit").
 * Credits are now debited exclusively server-side inside `/api/vision`, through
 * the atomic `consume_credit` RPC, so no client-triggered debit path exists.
 *
 * It is kept as an explicit 410 so a stale cached client build gets a clear,
 * non-charging answer instead of a 404.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'ENDPOINT_RETIRED',
      message: 'Les crédits sont débités uniquement lors d\'une analyse photo réussie.',
      chargedActions: CHARGED_ACTIONS,
      freeActions: FREE_ACTIONS,
    },
    { status: 410 }
  );
}
