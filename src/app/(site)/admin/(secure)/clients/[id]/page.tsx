import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminPage } from '@/lib/admin/auth';
import { getAdminDb } from '@/lib/admin/db';
import { getClientDetail, LEDGER_LIMIT } from '@/lib/admin/clients';
import { classifyLedgerEntry, isPaymentKind } from '@/lib/admin/ledger';
import {
  KIND_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_STYLES,
  PAYMENT_METHOD_LABELS,
  PROVIDER_LABELS,
  formatDate,
  formatDateTime,
  formatMad,
  formatMoney,
  formatRelativeDays,
  packLabel,
} from '@/lib/admin/format';
import { Badge, EmptyRow, Field, Notice, Section, Stat, td, th } from '../../ui';
import { ClientNoteForm, CreditAdjustForm } from './ClientActions';

export const dynamic = 'force-dynamic';

const LOCALE_LABELS: Record<string, string> = { fr: 'Français', ar: 'العربية', en: 'English' };

/** wa.me wants the number in international form, digits only. */
function whatsappHref(phone: string): string | null {
  let digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = `212${digits.slice(1)}`;
  return /^\d{8,15}$/.test(digits) ? `https://wa.me/${digits}` : null;
}

export default async function ClientPage({ params }: { params: { id: string } }) {
  await requireAdminPage(`/admin/clients/${params.id}`);
  const db = getAdminDb();
  if (!db) {
    return <Notice tone="error">Base non configurée : NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.</Notice>;
  }
  const result = await getClientDetail(db, params.id);
  if (result.status === 'not_found') notFound();
  if (result.status === 'error') {
    return <Notice tone="error">Impossible de charger ce client. Réessayez dans un instant.</Notice>;
  }

  const { client } = result;
  const { identity, summary } = client;
  const now = new Date();
  const whatsapp = identity.phone ? whatsappHref(identity.phone) : null;
  const lastActivity = [identity.lastSignInAt, summary.lastEntryAt, client.projects[0]?.createdAt ?? null]
    .filter((d): d is string => typeof d === 'string')
    .sort()
    .pop() ?? null;

  return (
    <>
      <div className="space-y-1">
        <Link href="/admin/clients" className="text-xs font-bold text-slate-500 hover:text-slate-300">
          ← Clients
        </Link>
        <h1 className="text-xl font-black text-white break-words">{identity.fullName || identity.email || identity.userId}</h1>
        <div className="flex flex-wrap gap-1.5">
          {client.note?.tags.map((tag) => (
            <Badge key={tag} className="bg-white/5 text-slate-300 border-white/10">
              {tag}
            </Badge>
          ))}
          {client.balance === 0 ? <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/30">Solde à zéro</Badge> : null}
          {summary.purchaseCount === 0 ? <Badge className="bg-slate-500/15 text-slate-400 border-slate-500/30">Jamais payé</Badge> : null}
          {identity.bannedUntil ? <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/30">Compte bloqué</Badge> : null}
        </div>
      </div>

      <Section title="Identité">
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3">
          <Field label="Nom">{identity.fullName || '—'}</Field>
          <Field label="Email">
            {identity.email ? (
              <a href={`mailto:${identity.email}`} className="text-amber-400 hover:underline break-all">
                {identity.email}
              </a>
            ) : (
              '—'
            )}
          </Field>
          <Field label="Téléphone">
            {identity.phone ? (
              <span dir="ltr">
                {identity.phone}
                {whatsapp ? (
                  <>
                    {' · '}
                    <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
                      WhatsApp
                    </a>
                  </>
                ) : null}
              </span>
            ) : (
              '—'
            )}
          </Field>
          <Field label="Langue">{identity.locale ? LOCALE_LABELS[identity.locale] ?? identity.locale : '—'}</Field>
          <Field label="Connexion">{identity.provider ? PROVIDER_LABELS[identity.provider] ?? identity.provider : '—'}</Field>
          <Field label="Email confirmé">{identity.emailConfirmedAt ? formatDate(identity.emailConfirmedAt) : 'Non'}</Field>
          <Field label="Inscrit le">{formatDateTime(identity.signedUpAt)}</Field>
          <Field label="Dernière connexion">
            {formatDateTime(identity.lastSignInAt)}
            {identity.lastSignInAt ? <span className="text-slate-500"> ({formatRelativeDays(identity.lastSignInAt, now)})</span> : null}
          </Field>
          <Field label="Identifiant">
            <span className="font-mono text-[11px] text-slate-400 break-all">{identity.userId}</span>
          </Field>
        </dl>
      </Section>

      <Section title="Chiffres">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
          <Stat label="Solde" value={client.balance ?? '—'} tone={client.balance === 0 ? 'warn' : undefined} hint={client.balance === null ? 'pas de profil' : 'crédits'} />
          {/* Free credits are what the ledger does not explain; on a truncated
              ledger, or a balance that disagrees with it, the figure is not
              meaningful and is shown as a discrepancy instead. */}
          {client.ledgerTruncated || summary.freeCredits === null ? (
            <Stat label="Crédits offerts" value="—" hint={client.ledgerTruncated ? 'grand livre tronqué' : 'pas de profil'} />
          ) : summary.freeCredits < 0 ? (
            <Stat label="Crédits offerts" value={summary.freeCredits} tone="warn" hint="écart solde / grand livre" />
          ) : (
            <Stat label="Crédits offerts" value={summary.freeCredits} hint="inscription, hors grand livre" />
          )}
          <Stat label="Crédits achetés" value={summary.creditsPurchased} hint={`${summary.purchaseCount} achat${summary.purchaseCount > 1 ? 's' : ''}`} />
          <Stat label="Crédits consommés" value={summary.creditsUsed} />
          <Stat label="Analyses photo" value={summary.scans} />
          <Stat label="Optimisations payées" value={summary.optimizations} />
          <Stat label="Total payé (manuel)" value={formatMad(client.paidMad)} tone={client.paidMad > 0 ? 'good' : undefined} />
          <Stat label="Remboursés / ajustés" value={`${summary.creditsRefunded} / ${summary.creditsAdjusted}`} hint="crédits" />
          <Stat label="Premier achat" value={formatDate(summary.firstPurchaseAt)} />
          <Stat label="Dernier achat" value={formatDate(summary.lastPurchaseAt)} />
          <Stat label="Dernière activité" value={formatRelativeDays(lastActivity, now)} hint={formatDate(lastActivity)} />
          <Stat label="Projets / panneaux" value={`${client.projects.length} / ${client.panelPresetCount}`} hint="enregistrés" />
        </div>
      </Section>

      <Section title="Ajuster les crédits">
        <CreditAdjustForm userId={identity.userId} balance={client.balance} />
      </Section>

      <Section title="Commandes manuelles" aside={`${client.orders.length} commande${client.orders.length > 1 ? 's' : ''}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr>
                <th className={th}>Commande</th>
                <th className={th}>Pack</th>
                <th className={`${th} text-end`}>Montant</th>
                <th className={th}>Méthode</th>
                <th className={th}>Statut</th>
                <th className={th}>Créée</th>
                <th className={th}>Décidée</th>
                <th className={th}>Référence / note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {client.orders.length === 0 ? (
                <EmptyRow colSpan={8}>Aucune commande manuelle.</EmptyRow>
              ) : (
                client.orders.map((order) => (
                  <tr key={order.order_number}>
                    <td className={`${td} font-mono font-bold text-amber-400 whitespace-nowrap`} dir="ltr">
                      {order.order_number}
                    </td>
                    <td className={td}>{packLabel(order.pack_id)}</td>
                    <td className={`${td} text-end tabular-nums whitespace-nowrap`}>
                      {formatMad(order.amount_mad)}
                      <span className="block text-[10px] text-slate-500">{order.credits} cr</span>
                    </td>
                    <td className={td}>{order.method ? PAYMENT_METHOD_LABELS[order.method] ?? order.method : '—'}</td>
                    <td className={td}>
                      <Badge className={ORDER_STATUS_STYLES[order.status] ?? ORDER_STATUS_STYLES.expired}>{ORDER_STATUS_LABELS[order.status] ?? order.status}</Badge>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{formatDateTime(order.created_at)}</td>
                    <td className={`${td} whitespace-nowrap`}>{formatDateTime(order.decided_at)}</td>
                    <td className={`${td} break-words`}>
                      {order.payment_reference || '—'}
                      {order.operator_note ? <span className="block text-[11px] text-slate-500">{order.operator_note}</span> : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title="Mouvements de crédits"
        aside={client.ledgerTruncated ? `${LEDGER_LIMIT} derniers mouvements` : `${client.ledger.length} mouvement${client.ledger.length > 1 ? 's' : ''}`}
      >
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full min-w-[720px]">
            <thead className="sticky top-0 bg-[#0B1220]">
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Mouvement</th>
                <th className={th}>Pack</th>
                <th className={`${th} text-end`}>Crédits</th>
                <th className={`${th} text-end`}>Solde après</th>
                <th className={th}>Montant / clé</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {client.ledger.length === 0 ? (
                <EmptyRow colSpan={6}>Aucun mouvement.</EmptyRow>
              ) : (
                client.ledger.map((row) => {
                  const kind = classifyLedgerEntry(row);
                  const payment = isPaymentKind(kind);
                  return (
                    <tr key={row.id}>
                      <td className={`${td} whitespace-nowrap`}>{formatDateTime(row.created_at)}</td>
                      <td className={td}>{KIND_LABELS[kind]}</td>
                      <td className={td}>{payment ? packLabel(row.reason) : '—'}</td>
                      <td className={`${td} text-end tabular-nums font-bold ${row.amount < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {row.amount > 0 ? `+${row.amount}` : row.amount}
                      </td>
                      <td className={`${td} text-end tabular-nums`}>{row.balance_after ?? '—'}</td>
                      <td className={`${td} font-mono text-[10px] text-slate-500 break-all`}>
                        {row.amount_paid !== null && row.amount_paid !== undefined ? (
                          <span className="block font-sans text-xs text-slate-300">{formatMoney(row.amount_paid, row.currency)}</span>
                        ) : null}
                        {row.stripe_payment_id || ''}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Projets" aside={`${client.projects.length} projet${client.projects.length > 1 ? 's' : ''}`}>
        {client.projects.length === 0 ? (
          <p className="text-xs text-slate-500">Aucun projet enregistré dans le cloud.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {client.projects.map((project) => (
              <li key={project.id} className="py-2.5 space-y-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-bold text-slate-100 break-words">{project.name}</span>
                  <span className="text-[11px] text-slate-500 whitespace-nowrap">{formatDateTime(project.createdAt)}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
                  <span>Matériau : {project.material.toUpperCase()}</span>
                  <span dir="ltr">
                    Panneau : {project.sheetWidth} × {project.sheetHeight}
                  </span>
                  <span>Pièces : {project.pieceCount}</span>
                  <span>Panneaux utilisés : {project.sheetsUsed ?? '—'}</span>
                  <span>Chute : {project.wastePercentage === null ? '—' : `${project.wastePercentage.toFixed(1)} %`}</span>
                  {project.pdfGeneratedAt ? <span>PDF : {formatDateTime(project.pdfGeneratedAt)}</span> : null}
                  {project.hasQuotation ? <Badge className="bg-sky-500/15 text-sky-400 border-sky-500/30">Devis</Badge> : null}
                </div>
                {project.scanThumb ? (
                  <details>
                    <summary className="cursor-pointer text-[11px] text-amber-400">Voir la photo scannée</summary>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a stored data: URL, not an optimisable asset */}
                    <img src={project.scanThumb} alt={`Photo scannée du projet ${project.name}`} className="mt-2 max-h-80 rounded-lg border border-white/10" />
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Note, téléphone, étiquettes" aside={client.note?.updatedAt ? `modifiée le ${formatDateTime(client.note.updatedAt)}` : undefined}>
        <ClientNoteForm
          userId={identity.userId}
          initial={{ phone: client.note?.phone ?? null, tags: client.note?.tags ?? [], note: client.note?.note ?? null }}
        />
      </Section>

      <Section title="Actions admin" aside={client.audit.length > 0 ? `${client.audit.length} dernière${client.audit.length > 1 ? 's' : ''}` : undefined}>
        {client.audit.length === 0 ? (
          <p className="text-xs text-slate-500">Aucune action admin sur ce client.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {client.audit.map((entry, index) => (
              <li key={`${entry.createdAt}-${index}`} className="py-2 flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs text-slate-200">
                  <strong>{AUDIT_LABELS[entry.action] ?? entry.action}</strong>
                  <span className="text-slate-400"> {describeAudit(entry.action, entry.details)}</span>
                </span>
                <span className="text-[11px] text-slate-500 whitespace-nowrap">{formatDateTime(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

const AUDIT_LABELS: Record<string, string> = {
  payment_granted: 'Paiement validé',
  payment_refused: 'Paiement refusé',
  credits_adjusted: 'Crédits ajustés',
  note_updated: 'Note modifiée',
};

const FIELD_LABELS: Record<string, string> = { phone: 'téléphone', tags: 'étiquettes', note: 'note' };

function describeAudit(action: string, details: Record<string, unknown>): string {
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
