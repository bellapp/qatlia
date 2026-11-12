import Link from 'next/link';
import { requireAdminPage } from '@/lib/admin/auth';
import { getAdminDb } from '@/lib/admin/db';
import { conversionRate, getKpis } from '@/lib/admin/kpis';
import { formatDateTime, formatMad, formatMoney, formatRelativeDays } from '@/lib/admin/format';
import { MigrationBanner, Notice, Section, Stat, td, th } from './ui';

export const dynamic = 'force-dynamic';

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const monthLabel = (yyyyMm: string) => {
  const [year, month] = yyyyMm.split('-');
  const index = Number(month) - 1;
  return MONTHS[index] ? `${MONTHS[index]} ${year}` : yyyyMm;
};

export default async function AdminOverviewPage() {
  await requireAdminPage('/admin');
  const db = getAdminDb();
  if (!db) {
    return <Notice tone="error">Base non configurée : NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.</Notice>;
  }
  const result = await getKpis(db);
  if (result.status === 'migration_missing') return <MigrationBanner migration="013" />;
  if (result.status === 'error') return <Notice tone="error">Impossible de calculer les indicateurs.</Notice>;

  const { kpis } = result;
  const conversion = conversionRate(kpis);
  const now = new Date();

  return (
    <>
      <h1 className="text-xl font-black text-white">Vue d’ensemble</h1>

      {kpis.pendingOrders.count > 0 ? (
        <Link
          href="/admin/paiements"
          className="block rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm font-bold text-amber-300 hover:bg-amber-500/15"
        >
          {kpis.pendingOrders.count} commande{kpis.pendingOrders.count > 1 ? 's' : ''} manuelle{kpis.pendingOrders.count > 1 ? 's' : ''} en attente
          {kpis.pendingOrders.oldestCreatedAt ? (
            <span className="font-normal text-amber-200/80">
              {' '}
              · la plus ancienne {formatRelativeDays(kpis.pendingOrders.oldestCreatedAt, now)} ({formatDateTime(kpis.pendingOrders.oldestCreatedAt)})
            </span>
          ) : null}{' '}
          →
        </Link>
      ) : null}

      <Section title="Clients">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <Stat label="Inscrits" value={kpis.signups.total} hint={`aujourd’hui ${kpis.signups.today} · 7 j ${kpis.signups.d7} · 30 j ${kpis.signups.d30}`} />
          <Stat label="Actifs" value={kpis.active.d30} hint={`30 j · ${kpis.active.d7} sur 7 j`} />
          <Stat
            label="Clients payants"
            value={kpis.payingClients}
            hint={conversion === null ? '—' : `${(conversion * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % des inscrits`}
            tone="good"
          />
          <Stat
            label="À relancer"
            value={
              <Link href="/admin/clients?segment=out_of_credits" className="hover:text-amber-400">
                {kpis.outOfCreditsNeverPaid}
              </Link>
            }
            hint="solde à zéro, jamais payé"
            tone={kpis.outOfCreditsNeverPaid > 0 ? 'warn' : undefined}
          />
        </div>
      </Section>

      <Section title="Revenus">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <Stat label="Manuel ce mois" value={formatMad(kpis.revenueMad.month)} tone="good" />
          <Stat label="Manuel 30 j" value={formatMad(kpis.revenueMad.d30)} />
          <Stat label="Manuel total" value={formatMad(kpis.revenueMad.total)} />
          <Stat
            label="Carte"
            value={`${kpis.cardPayments.countTotal} paiement${kpis.cardPayments.countTotal > 1 ? 's' : ''}`}
            hint={`${kpis.cardPayments.countD30} sur 30 j · ${formatMoney(kpis.cardPayments.usdTotal, 'USD')}${
              kpis.cardPayments.withoutAmount > 0 ? ` · dont ${kpis.cardPayments.withoutAmount} sans montant enregistré` : ''
            }`}
          />
        </div>
      </Section>

      <Section title="Usage">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          <Stat label="Analyses 7 j" value={kpis.usage.scansD7} />
          <Stat label="Analyses 30 j" value={kpis.usage.scansD30} />
          <Stat label="Optimisations payées 30 j" value={kpis.usage.optimizationsD30} />
          <Stat label="Crédits consommés 30 j" value={kpis.usage.creditsUsedD30} />
        </div>
      </Section>

      <Section title="Six derniers mois" aside="revenu manuel daté par la validation">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px]">
            <thead>
              <tr>
                <th className={th}>Mois</th>
                <th className={`${th} text-end`}>Inscrits</th>
                <th className={`${th} text-end`}>Analyses</th>
                <th className={`${th} text-end`}>Revenu manuel</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {[...kpis.monthly].reverse().map((m) => (
                <tr key={m.month}>
                  <td className={td}>{monthLabel(m.month)}</td>
                  <td className={`${td} text-end tabular-nums`}>{m.signups}</td>
                  <td className={`${td} text-end tabular-nums`}>{m.scans}</td>
                  <td className={`${td} text-end tabular-nums`}>{m.revenueMad > 0 ? formatMad(m.revenueMad) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
