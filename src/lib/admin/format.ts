/**
 * Display helpers for the back office: French, Casablanca time.
 *
 * Pure module: safe to import from a client component or a plain Node test.
 */

import type { LedgerKind } from './ledger';

const TIME_ZONE = 'Africa/Casablanca';

const DATE_TIME = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const DATE_ONLY = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function parse(iso: string | null | undefined): Date | null {
  if (typeof iso !== 'string' || iso === '') return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(iso: string | null | undefined): string {
  const date = parse(iso);
  return date ? DATE_TIME.format(date) : '—';
}

export function formatDate(iso: string | null | undefined): string {
  const date = parse(iso);
  return date ? DATE_ONLY.format(date) : '—';
}

/** "aujourd'hui", "hier", "il y a 12 j", "il y a 3 mois", or "—". */
export function formatRelativeDays(iso: string | null | undefined, now: Date = new Date()): string {
  const date = parse(iso);
  if (!date) return '—';
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 60) return `il y a ${days} j`;
  return `il y a ${Math.floor(days / 30)} mois`;
}

export function formatMad(amount: number | null | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—';
  return `${amount.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} MAD`;
}

export function formatMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—';
  const code = (currency || 'MAD').toUpperCase();
  if (code === 'MAD') return formatMad(amount);
  return `${amount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code}`;
}

export const KIND_LABELS: Record<LedgerKind, string> = {
  manual_payment: 'Paiement manuel',
  card_creem: 'Carte (Creem)',
  card_stripe: 'Carte (Stripe)',
  refund: 'Remboursement',
  admin_adjustment: 'Ajustement admin',
  scan: 'Analyse photo',
  optimization: 'Optimisation',
  other: 'Autre',
};

const PACK_LABELS: Record<string, string> = {
  starter: 'Découverte',
  standard: 'Artisan',
  pro: 'Atelier Pro',
  atelier_max: 'Atelier Max',
};

export function packLabel(packId: string | null | undefined): string {
  if (!packId) return '—';
  return PACK_LABELS[packId] ?? packId;
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'En attente',
  paid: 'Payée (à créditer)',
  granted: 'Crédits ajoutés',
  refused: 'Refusée',
  expired: 'Expirée',
};

export const ORDER_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  paid: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  granted: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  refused: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  expired: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  manual: 'Manuel',
  cashplus_agency: 'CashPlus (agence)',
  bank_transfer: 'Virement',
  wafacash: 'Wafacash',
};

export const PROVIDER_LABELS: Record<string, string> = {
  email: 'Email + mot de passe',
  google: 'Google',
};
