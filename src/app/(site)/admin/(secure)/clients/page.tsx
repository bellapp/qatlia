import Link from 'next/link';
import { Search } from 'lucide-react';
import { requireAdminPage } from '@/lib/admin/auth';
import { getAdminDb } from '@/lib/admin/db';
import { listClients, parseClientListParams, type ClientListParams, type ClientSegment, type ClientSort } from '@/lib/admin/clients';
import { formatDate, formatMad, formatRelativeDays } from '@/lib/admin/format';
import { Badge, EmptyRow, MigrationBanner, Notice, td, th } from '../ui';

export const dynamic = 'force-dynamic';

const SEGMENT_LABELS: Record<ClientSegment, string> = {
  all: 'Tous',
  paying: 'Payants',
  never_paid: 'Jamais payé',
  out_of_credits: 'Solde à zéro',
  inactive_30d: 'Inactifs 30 j',
  pending_order: 'Commande en attente',
};

const SORT_LABELS: Record<ClientSort, string> = {
  created_desc: 'Inscription récente',
  last_activity_desc: 'Activité récente',
  credits_asc: 'Solde croissant',
  credits_desc: 'Solde décroissant',
  paid_desc: 'Montant payé',
  scans_desc: 'Nombre d’analyses',
};

function hrefWith(params: ClientListParams, overrides: Partial<ClientListParams>): string {
  const next = { ...params, ...overrides };
  const qs = new URLSearchParams();
  if (next.search) qs.set('q', next.search);
  if (next.segment !== 'all') qs.set('segment', next.segment);
  if (next.sort !== 'created_desc') qs.set('sort', next.sort);
  if (next.page > 1) qs.set('page', String(next.page));
  const query = qs.toString();
  return query ? `/admin/clients?${query}` : '/admin/clients';
}

export default async function ClientsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireAdminPage('/admin/clients');
  const params = parseClientListParams(searchParams);
  const db = getAdminDb();
  const result = db ? await listClients(db, params) : null;
  const now = new Date();

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-black text-white">Clients</h1>
        {result?.status === 'ok' ? (
          <span className="text-xs text-slate-400">
            {result.total} client{result.total > 1 ? 's' : ''}
          </span>
        ) : null}
      </div>

      <form method="get" action="/admin/clients" className="flex flex-wrap items-center gap-2">
        {params.segment !== 'all' ? <input type="hidden" name="segment" value={params.segment} /> : null}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
          <input
            type="search"
            name="q"
            defaultValue={params.search}
            placeholder="Email, nom, téléphone ou identifiant"
            aria-label="Rechercher un client"
            className="w-full ps-8 pe-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 outline-none focus:border-amber-500/40"
          />
        </div>
        <select
          name="sort"
          defaultValue={params.sort}
          aria-label="Trier"
          className="py-2 px-2 rounded-lg bg-[#0B1220] border border-white/10 text-xs text-slate-200 outline-none focus:border-amber-500/40"
        >
          {(Object.keys(SORT_LABELS) as ClientSort[]).map((sort) => (
            <option key={sort} value={sort}>
              {SORT_LABELS[sort]}
            </option>
          ))}
        </select>
        <button type="submit" className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black text-[11px] font-black uppercase tracking-wider">
          Filtrer
        </button>
      </form>

      <div className="flex flex-wrap gap-1.5" aria-label="Segments">
        {(Object.keys(SEGMENT_LABELS) as ClientSegment[]).map((segment) => (
          <Link
            key={segment}
            href={hrefWith(params, { segment, page: 1 })}
            aria-current={params.segment === segment ? 'true' : undefined}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
              params.segment === segment ? 'bg-white/15 text-white' : 'bg-white/5 text-slate-400 hover:text-slate-200'
            }`}
          >
            {SEGMENT_LABELS[segment]}
          </Link>
        ))}
      </div>

      {!db ? <Notice tone="error">Base non configurée : NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.</Notice> : null}
      {result?.status === 'migration_missing' ? <MigrationBanner migration="012" /> : null}
      {result?.status === 'error' ? <Notice tone="error">Impossible de charger les clients.</Notice> : null}

      {result?.status === 'ok' ? (
        <>
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full min-w-[860px]">
              <thead className="bg-white/[0.03]">
                <tr>
                  <th className={th}>Client</th>
                  <th className={th}>Inscrit</th>
                  <th className={th}>Activité</th>
                  <th className={`${th} text-end`}>Solde</th>
                  <th className={`${th} text-end`}>Analyses</th>
                  <th className={`${th} text-end`}>Achats</th>
                  <th className={`${th} text-end`}>Payé (manuel)</th>
                  <th className={`${th} text-end`}>Projets</th>
                  <th className={th}>Téléphone</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {result.rows.length === 0 ? (
                  <EmptyRow colSpan={9}>Aucun client ne correspond.</EmptyRow>
                ) : (
                  result.rows.map((row) => (
                    <tr key={row.userId} className="hover:bg-white/[0.03]">
                      <td className={td}>
                        <Link href={`/admin/clients/${row.userId}`} className="block group">
                          <span className="block font-bold text-slate-100 group-hover:text-amber-400">{row.fullName || '—'}</span>
                          <span className="block text-[11px] text-slate-400 break-all">{row.email || row.userId}</span>
                        </Link>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {row.pendingOrders > 0 ? (
                            <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30">
                              {row.pendingOrders} commande{row.pendingOrders > 1 ? 's' : ''} en attente
                            </Badge>
                          ) : null}
                          {row.tags.map((tag) => (
                            <Badge key={tag} className="bg-white/5 text-slate-300 border-white/10">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className={`${td} whitespace-nowrap`}>{formatDate(row.signedUpAt)}</td>
                      <td className={`${td} whitespace-nowrap`}>{formatRelativeDays(row.lastActivityAt, now)}</td>
                      <td className={`${td} text-end tabular-nums font-bold ${row.credits === 0 ? 'text-rose-400' : 'text-slate-100'}`}>{row.credits}</td>
                      <td className={`${td} text-end tabular-nums`}>{row.scans}</td>
                      <td className={`${td} text-end tabular-nums`}>
                        {row.purchases}
                        {row.purchases > 0 ? <span className="block text-[10px] text-slate-500">{row.creditsPurchased} cr</span> : null}
                      </td>
                      <td className={`${td} text-end tabular-nums whitespace-nowrap`}>{row.paidMad > 0 ? formatMad(row.paidMad) : '—'}</td>
                      <td className={`${td} text-end tabular-nums`}>{row.projects}</td>
                      <td className={`${td} whitespace-nowrap`} dir="ltr">
                        {row.phone || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {result.total > result.pageSize ? (
            <nav aria-label="Pagination" className="flex items-center justify-between gap-3 text-xs">
              {params.page > 1 ? (
                <Link href={hrefWith(params, { page: params.page - 1 })} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10">
                  ← Précédent
                </Link>
              ) : (
                <span />
              )}
              <span className="text-slate-500">
                Page {params.page} / {Math.max(1, Math.ceil(result.total / result.pageSize))}
              </span>
              {params.page * result.pageSize < result.total ? (
                <Link href={hrefWith(params, { page: params.page + 1 })} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10">
                  Suivant →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      ) : null}
    </>
  );
}
