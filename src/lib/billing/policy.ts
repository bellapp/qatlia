/**
 * The credit policy, stated once.
 *
 * Customer copy, the atelier UI and the API routes all read this table, so the
 * product can no longer claim "exports are free" while debiting a credit on PDF
 * export. Exactly one action costs a credit: a successful, authenticated Vision
 * analysis of a photographed cut list.
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

/** A successful photo analysis costs exactly one credit. */
export const VISION_CREDIT_COST = 1;

/** Credits charged per action. Anything not listed here is not a known action. */
export const CREDIT_POLICY: Record<BillableAction, number> = {
  vision: VISION_CREDIT_COST,
  optimize: 0,
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
