/**
 * The credit policy, stated once.
 *
 * Customer copy, the atelier UI and the API routes all read this table, so the
 * product can no longer claim "exports are free" while debiting a credit on PDF
 * export. One credit buys one complete analysis of a cut list: the photo scan
 * (or, for a list typed by hand, its first optimization) plus every
 * re-optimization of it for ANALYSIS_WINDOW_HOURS. Exports are always free.
 *
 * Pure module: no env, no I/O.
 */

export type BillableAction = 'vision' | 'optimize' | 'pdf' | 'dxf' | 'json' | 'png' | 'quotation';

export const BILLABLE_ACTIONS: readonly BillableAction[] = [
  'vision',
  'optimize',
  'pdf',
  'dxf',
  'json',
  'png',
  'quotation',
];

/** One credit per complete analysis — user pricing 2026-10-30 (was 2 for the
 *  scan plus 1 per optimization). A successful scan costs 1 credit; an
 *  optimization costs 1 credit only when no analysis is already open (see
 *  src/lib/billing/analysis-pass.ts). Measured AI cost: ~$0.0067 per scan. */
export const VISION_CREDIT_COST = 1;
export const OPTIMIZE_CREDIT_COST = 1;

/** How long a paid analysis keeps re-optimizations free. */
export const ANALYSIS_WINDOW_HOURS = 24;

/**
 * Credits granted to a new account on sign-up.
 *
 * Stated once here because three surfaces quote it (landing page, auth modal,
 * login page) and the database grants it. The SQL side is kept in step by
 * `supabase/migrations/010_pricing_v3.sql`; changing this number alone
 * would make the copy promise what the ledger does not give.
 */
export const SIGNUP_FREE_CREDITS = 20;

/** Credits charged per action. Anything not listed here is not a known action. */
export const CREDIT_POLICY: Record<BillableAction, number> = {
  vision: VISION_CREDIT_COST,
  optimize: OPTIMIZE_CREDIT_COST,
  pdf: 0,
  dxf: 0,
  json: 0,
  png: 0,
  quotation: 0,
};

export const CHARGED_ACTIONS: readonly BillableAction[] = BILLABLE_ACTIONS.filter(
  (action) => CREDIT_POLICY[action] > 0
);

export const FREE_ACTIONS: readonly BillableAction[] = BILLABLE_ACTIONS.filter(
  (action) => CREDIT_POLICY[action] === 0
);

function assertKnownAction(action: string): BillableAction {
  if (!(action in CREDIT_POLICY)) {
    throw new Error(`UNKNOWN_ACTION: ${action}`);
  }
  return action as BillableAction;
}

export function creditCostFor(action: string): number {
  return CREDIT_POLICY[assertKnownAction(action)];
}

export function isFreeAction(action: string): boolean {
  return CREDIT_POLICY[assertKnownAction(action)] === 0;
}
