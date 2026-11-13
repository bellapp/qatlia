import Link from 'next/link';
import { Search } from 'lucide-react';
import { requireAdminPage } from '@/lib/admin/auth';
import { getAdminDb } from '@/lib/admin/db';
import { listPayments, parsePaymentFilters, type PaymentFilters } from '@/lib/admin/payments';
import { ORDER_STATUS_LABELS, ORDER_STATUS_STYLES, PAYMENT_METHOD_LABELS, formatDateTime, formatMoney, packLabel } from '@/lib/admin/format';
import { Badge, Notice } from '../ui';
import { PaymentActions } from './PaymentActions';

export const dynamic = 'force-dynamic';

const SOURCE_LABELS: Record<PaymentFilters['source'], string> = { all: 'Tous', manual: 'Manuels', card: 'Carte' };
const STATUS_LABELS: Record<PaymentFilters['status'], string> = {
  pending: 'En attente',
  granted: 'Crédits ajoutés',
  refused: 'Refusés',
  all: 'Tous',
};
const SOURCE_BADGES = {
  manual: 'bg-white/5 text-slate-300 border-white/10',
  creem: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  stripe: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
};

function hrefWith(filters: PaymentFilters, overrides: Partial<PaymentFilters>): string {
  const next = { ...filters, ...overrides };
  const qs = new URLSearchParams();
  if (next.source !== 'all') qs.set('source', next.source);
  if (next.status !== 'pending') qs.set('status', next.status);
  if (next.search) qs.set('q', next.search);
  const query = qs.toString();
  return query ? `/admin/paiements?${query}` : '/admin/paiements';
}

export default async function PaymentsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireAdminPage('/admin/paiements');
  const filters = parsePaymentFilters(searchParams);
  const db = getAdminDb();
  const result = db ? await listPayments(db, filters) : null;

  const pill = (active: boolean) =>
    `px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${active ? 'bg-white/15 text-white' : 'bg-white/5 text-slate-400 hover:text-slate-200'}`;

  return (
    <>
      <h1 className="text-xl font-black text-white">Paiements</h1>
      <p className="text-xs text-slate-400">
        Vérifiez vous-même le virement ou l’encaissement avant de valider : la validation ajoute les crédits immédiatement.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Statut">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 me-1">Statut</span>
          {(Object.keys(STATUS_LABELS) as PaymentFilters['status'][]).map((status) => (
            <Link key={status} href={hrefWith(filters, { status })} aria-current={filters.status === status ? 'true' : undefined} className={pill(filters.status === status)}>
              {STATUS_LABELS[status]}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Moyen de paiement">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 me-1">Moyen</span>
          {(Object.keys(SOURCE_LABELS) as PaymentFilters['source'][]).map((source) => (
            <Link key={source} href={hrefWith(filters, { source })} aria-current={filters.source === source ? 'true' : undefined} className={pill(filters.source === source)}>
              {SOURCE_LABELS[source]}
            </Link>
          ))}
        </div>
      </div>

      <form method="get" action="/admin/paiements" className="flex gap-2">
        {filters.source !== 'all' ? <input type="hidden" name="source" value={filters.source} /> : null}
        {filters.status !== 'pending' ? <input type="hidden" name="status" value={filters.status} /> : null}
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
          <input
            type="search"
            name="q"
            defaultValue={filters.search}
            placeholder="N° de commande, email, référence"
            aria-label="Rechercher un paiement"
            className="w-full ps-8 pe-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 outline-none focus:border-amber-500/40"
          />
        </div>
        <button type="submit" className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-[11px] font-black uppercase tracking-wider">
          Chercher
        </button>
      </form>

      {!db ? <Notice tone="error">Base non configurée : NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.</Notice> : null}
      {result?.status === 'error' ? <Notice tone="error">Impossible de charger les paiements.</Notice> : null}

      {result?.status === 'ok' ? (
        result.payments.length === 0 ? (
          <div className="text-center py-14 space-y-1">
            <p className="text-sm font-bold text-slate-400">Aucun paiement {filters.status === 'pending' ? 'en attente' : 'ne correspond'}.</p>
            {filters.status === 'pending' ? <p className="text-xs text-slate-500">Les nouvelles commandes manuelles apparaissent ici.</p> : null}
          </div>
        ) : (
          <ul className="space-y-2.5">
            {result.payments.map((p) => (
              <li key={`${p.source}:${p.id}`} className="rounded-2xl bg-white/[0.03] border border-white/10 p-4 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={SOURCE_BADGES[p.source]}>{p.source === 'manual' ? 'Manuel' : p.source === 'creem' ? 'Carte Creem' : 'Carte Stripe'}</Badge>
                    {p.orderNumber ? (
                      <span dir="ltr" className="font-mono font-black text-sm text-amber-400 tracking-wider">
                        {p.orderNumber}
                      </span>
                    ) : null}
                    <Badge className={ORDER_STATUS_STYLES[p.status] ?? ORDER_STATUS_STYLES.expired}>{ORDER_STATUS_LABELS[p.status] ?? p.status}</Badge>
                  </div>
                  <span dir="ltr" className="font-mono text-sm font-bold text-slate-100 whitespace-nowrap">
                    {p.amountIsEstimate ? '≈ ' : ''}
                    {formatMoney(p.amount, p.currency)} · <span className="text-slate-400">{p.credits} cr</span>
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-[11px] text-slate-400">
                  <span>
                    Pack : <strong className="text-slate-200">{packLabel(p.packId)}</strong>
                  </span>
                  <span>
                    Méthode : <strong className="text-slate-200">{p.method ? PAYMENT_METHOD_LABELS[p.method] ?? p.method : '—'}</strong>
                  </span>
                  <span>
                    Créé : <strong className="text-slate-200">{formatDateTime(p.createdAt)}</strong>
                  </span>
                  {p.source === 'manual' && p.decidedAt ? (
                    <span>
                      Décidé : <strong className="text-slate-200">{formatDateTime(p.decidedAt)}</strong>
                    </span>
                  ) : null}
                  <span className="sm:col-span-2 md:col-span-4 truncate">
                    Client :{' '}
                    <Link href={`/admin/clients/${p.userId}`} className="font-bold text-slate-100 hover:text-amber-400">
                      {p.email || p.userId}
                    </Link>
                  </span>
                  {p.reference ? (
                    <span className="sm:col-span-2 md:col-span-4 truncate">
                      Référence : <strong className="text-slate-200 break-all">{p.reference}</strong>
                    </span>
                  ) : null}
                  {p.amountIsEstimate ? (
                    <span className="sm:col-span-2 md:col-span-4 text-slate-500">Montant estimé au prix du pack : paiement antérieur à l’enregistrement des montants.</span>
                  ) : null}
                </div>
                {p.source === 'manual' && p.status === 'pending' && p.orderNumber ? <PaymentActions orderNumber={p.orderNumber} /> : null}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </>
  );
}
