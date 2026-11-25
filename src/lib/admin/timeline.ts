/**
 * « Dernières activités » of one client (spec 2026-11-25): one list, newest
 * first, built only from what the client page already loads — no new query.
 *
 * Supabase keeps the last sign-in only, not a history of them: it is one entry.
 *
 * Pure module: safe to import from a client component or a plain Node test.
 */

import type { ClientAuditEntry, ManualOrderRow } from './clients';
import { KIND_LABELS, ORDER_STATUS_LABELS, formatMad, packLabel } from './format';
import { classifyLedgerEntry, isPaymentKind, type LedgerRow } from './ledger';
import type { ProjectSummary } from './projects';

export type TimelineKind = 'signup' | 'last_sign_in' | 'ledger' | 'project' | 'pdf' | 'order_created' | 'order_decided' | 'admin';

export interface TimelineEvent {
  at: string;
  kind: TimelineKind;
  label: string;
  detail: string | null;
  /** The saved project the event opens, if any. */
  projectId: string | null;
  /** Credits moved, for a ledger entry. */
  amount: number | null;
}

export interface TimelineInput {
  identity: { signedUpAt: string | null; lastSignInAt: string | null };
  ledger: LedgerRow[];
  orders: ManualOrderRow[];
  projects: ProjectSummary[];
  audit: ClientAuditEntry[];
}

export const TIMELINE_LIMIT = 100;

export const AUDIT_LABELS: Record<string, string> = {
  payment_granted: 'Paiement validé',
  payment_refused: 'Paiement refusé',
  credits_adjusted: 'Crédits ajustés',
  note_updated: 'Note modifiée',
  account_deleted: 'Compte supprimé',
};

const FIELD_LABELS: Record<string, string> = { phone: 'téléphone', tags: 'étiquettes', note: 'note' };

export function describeAudit(action: string, details: Record<string, unknown>): string {
  if (action === 'credits_adjusted') {
    const delta = Number(details.delta);
    const sign = delta > 0 ? `+${delta}` : String(delta);
    return `${sign} cr${typeof details.reason === 'string' ? ` — ${details.reason}` : ''}${details.balance !== null && details.balance !== undefined ? ` (solde ${details.balance})` : ''}`;
  }
  if (action === 'payment_granted' || action === 'payment_refused') {
    return [details.order_number, details.amount_mad !== undefined ? formatMad(Number(details.amount_mad)) : null, details.operator_note]
      .filter((part) => typeof part === 'string' && part !== '')
      .join(' · ');
  }
  if (action === 'note_updated' && Array.isArray(details.fields)) {
    return details.fields.map((field) => FIELD_LABELS[String(field)] ?? String(field)).join(', ');
  }
  return '';
}

const valid = (iso: string | null | undefined): iso is string => typeof iso === 'string' && !Number.isNaN(Date.parse(iso));

function projectDetail(project: ProjectSummary): string {
  const parts = [
    `${project.pieceCount} pièce${project.pieceCount > 1 ? 's' : ''}`,
    project.sheetsUsed !== null ? `${project.sheetsUsed} panneau${project.sheetsUsed > 1 ? 'x' : ''}` : null,
    project.wastePercentage !== null ? `chute ${project.wastePercentage.toFixed(1)} %` : null,
    project.scanThumbs.length > 0 ? `${project.scanThumbs.length} photo${project.scanThumbs.length > 1 ? 's' : ''}` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

export function buildClientTimeline(input: TimelineInput, limit: number = TIMELINE_LIMIT): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const push = (event: Omit<TimelineEvent, 'detail' | 'projectId' | 'amount'> & Partial<TimelineEvent>) => {
    if (!valid(event.at)) return;
    events.push({ detail: null, projectId: null, amount: null, ...event });
  };

  push({ at: input.identity.signedUpAt ?? '', kind: 'signup', label: 'Inscription' });
  push({ at: input.identity.lastSignInAt ?? '', kind: 'last_sign_in', label: 'Dernière connexion' });

  for (const row of input.ledger) {
    const kind = classifyLedgerEntry(row);
    push({
      at: row.created_at,
      kind: 'ledger',
      label: KIND_LABELS[kind],
      detail: isPaymentKind(kind) ? packLabel(row.reason) : row.description,
      amount: row.amount,
    });
  }

  for (const project of input.projects) {
    push({ at: project.createdAt, kind: 'project', label: `Plan calculé : ${project.name}`, detail: projectDetail(project), projectId: project.id });
    if (project.pdfGeneratedAt) {
      push({ at: project.pdfGeneratedAt, kind: 'pdf', label: `PDF généré : ${project.name}`, projectId: project.id });
    }
  }

  for (const order of input.orders) {
    const summary = `${order.order_number} · ${packLabel(order.pack_id)} · ${formatMad(order.amount_mad)}`;
    push({ at: order.created_at, kind: 'order_created', label: 'Commande manuelle créée', detail: summary });
    if (order.decided_at) {
      push({
        at: order.decided_at,
        kind: 'order_decided',
        label: `Commande : ${ORDER_STATUS_LABELS[order.status] ?? order.status}`,
        detail: summary,
      });
    }
  }

  for (const entry of input.audit) {
    push({ at: entry.createdAt, kind: 'admin', label: `Admin : ${AUDIT_LABELS[entry.action] ?? entry.action}`, detail: describeAudit(entry.action, entry.details) || null });
  }

  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, Math.max(0, limit));
}
