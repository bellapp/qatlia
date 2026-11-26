import Link from 'next/link';
import { Search } from 'lucide-react';
import { requireAdminPage } from '@/lib/admin/auth';
import { getAdminDb } from '@/lib/admin/db';
import { listClients, parseClientListParams, type ClientListParams, type ClientSegment, type ClientSort } from '@/lib/admin/clients';
import { formatDate, formatMad, formatRelativeDays } from '@/lib/admin/format';
import { Badge, EmptyRow, MigrationBanner, Notice, td, th } from '../ui';
import { PhoneList } from './PhoneList';

export const dynamic = 'force-dynamic';

const SEGMENT_LABELS: Record<ClientSegment, string> = {
  all: 'Tous',
  paying: 'Payants',
  never_paid: 'Jamais payé',
  out_of_credits: 'Solde à zéro',
  inactive_30d: 'Inactifs 30 j',
  pending_order: 'Commande en attente',
};

/**
 * The sortable columns: the sort of a first click (dates and counts start with
 * the largest, names with A), and the reverse of a second one.
 */
const SORTABLE: Record<string, { first: ClientSort; second: ClientSort }> = {
  Client: { first: 'email_asc', second: 'email_desc' },
  Inscrit: { first: 'created_desc', second: 'created_asc' },
  Activité: { first: 'last_activity_desc', second: 'last_activity_asc' },
  Solde: { first: 'credits_desc', second: 'credits_asc' },
  Analyses: { first: 'scans_desc', second: 'scans_asc' },
  Achats: { first: 'purchases_desc', second: 'purchases_asc' },
  'Payé (manuel)': { first: 'paid_desc', second: 'paid_asc' },
  Projets: { first: 'projects_desc', second: 'projects_asc' },
};

const COLUMNS: { label: string; end?: boolean }[] = [
  { label: 'Client' },
  { label: 'Inscrit' },
  { label: 'Activité' },
  { label: 'Solde', end: true },
  { label: 'Analyses', end: true },
  { label: 'Achats', end: true },
  { label: 'Payé (manuel)', end: true },
  { label: 'Projets', end: true },
  { label: 'Téléphones' },
];

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
            placeholder="Email, nom, téléphone (0612…, +212…) ou identifiant"
            aria-label="Rechercher un client"
            className="w-full ps-8 pe-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 outline-none focus:border-amber-500/40"
          />
        </div>
        {params.sort !== 'created_desc' ? <input type="hidden" name="sort" value={params.sort} /> : null}
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
                  {COLUMNS.map((column) => {
                    const sortable = SORTABLE[column.label];
                    const align = column.end ? 'text-end' : '';
                    if (!sortable) {
                      return (
                        <th key={column.label} className={`${th} ${align}`}>
                          {column.label}
                        </th>
                      );
                    }
                    const active = params.sort === sortable.first ? 'first' : params.sort === sortable.second ? 'second' : null;
                    const next = active === 'first' ? sortable.second : sortable.first;
                    const arrow = active ? (params.sort.endsWith('_asc') ? '↑' : '↓') : '↕';
                    return (
                      <th
                        key={column.label}
                        className={`${th} ${align}`}
                        aria-sort={active ? (params.sort.endsWith('_asc') ? 'ascending' : 'descending') : 'none'}
                      >
                        <Link
                          href={hrefWith(params, { sort: next, page: 1 })}
                          className={`inline-flex items-center gap-1 hover:text-slate-200 ${active ? 'text-amber-400' : ''}`}
                        >
                          {column.label}
                          <span aria-hidden="true">{arrow}</span>
                        </Link>
                      </th>
                    );
                  })}
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
                      <td className={td}>
                        <PhoneList note={row.phone} whatsapp={row.whatsapp} atelier={row.atelierPhone} />
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
