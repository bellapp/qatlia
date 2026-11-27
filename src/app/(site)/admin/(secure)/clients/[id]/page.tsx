import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isAdminUserId, requireAdminPage } from '@/lib/admin/auth';
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
import { buildClientTimeline, AUDIT_LABELS, describeAudit, type TimelineEvent } from '@/lib/admin/timeline';
import { Badge, Field, Notice, Section, Stat } from '../../ui';
import { SortableTable } from '../../SortableTable';
import { ClientNoteForm, CreditAdjustForm, DeleteAccountForm } from './ClientActions';
import { DetachReferralButton, RefundPurchaseButton } from './ReferralActions';
import { getClientReferral, refundedPurchaseKeys } from '@/lib/admin/referrals';

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
  const [result, referralResult] = await Promise.all([getClientDetail(db, params.id), getClientReferral(db, params.id)]);
  if (result.status === 'not_found') notFound();
  if (result.status === 'error') {
    return <Notice tone="error">Impossible de charger ce client. Réessayez dans un instant.</Notice>;
  }

  const { client } = result;
  const { identity, summary } = client;
  const referral = referralResult.status === 'ok' ? referralResult.referral : null;
  const refunded = refundedPurchaseKeys(client.ledger);
  const now = new Date();
  const whatsapp = identity.phone ? whatsappHref(identity.phone) : null;
  const lastActivity = [identity.lastSignInAt, summary.lastEntryAt, client.projects[0]?.createdAt ?? null]
    .filter((d): d is string => typeof d === 'string')
    .sort()
    .pop() ?? null;
  const timeline = buildClientTimeline({
    identity,
    ledger: client.ledger,
    orders: client.orders,
    projects: client.projects,
    audit: client.audit,
  });
  // The delete route checks all of this again, on the whole ledger.
  const deleteBlockedReason = isAdminUserId(identity.userId)
    ? 'Compte admin : il ne peut pas être supprimé d’ici.'
    : summary.purchaseCount > 0 || client.orders.some((order) => ['pending', 'paid', 'granted', 'refunded'].includes(order.status))
      ? 'Ce client a payé ou a une commande en cours : son compte ne peut pas être supprimé d’ici.'
      : null;

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
          <Field label="Provenance">
            {identity.signupSource
              ? `${identity.signupSource}${identity.signupCampaign ? ` · ${identity.signupCampaign}` : ''}`
              : '—'}
          </Field>
          <Field label="WhatsApp">
            {identity.whatsapp ? (
              identity.whatsapp.startsWith('+') ? (
                <a
                  href={`https://wa.me/${identity.whatsapp.slice(1)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-emerald-400 hover:underline"
                >
                  {identity.whatsapp}
                </a>
              ) : (
                <span>
                  <span className="font-mono text-[11px]">{identity.whatsapp}</span>
                  <span className="text-slate-500"> (nom d’utilisateur, numéro masqué)</span>
                </span>
              )
            ) : (
              '—'
            )}
          </Field>
          <Field label="Téléphone entreprise">
            {identity.atelierPhone ? <span dir="ltr">{identity.atelierPhone}</span> : '—'}
          </Field>
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
          <Stat label="Parrainage" value={summary.creditsReferral} hint="crédits de bonus reçus (net)" />
          {summary.creditsPurchaseRefunded > 0 ? (
            <Stat label="Achats remboursés" value={summary.creditsPurchaseRefunded} tone="warn" hint="crédits repris" />
          ) : null}
          <Stat label="Premier achat" value={formatDate(summary.firstPurchaseAt)} />
          <Stat label="Dernier achat" value={formatDate(summary.lastPurchaseAt)} />
          <Stat label="Dernière activité" value={formatRelativeDays(lastActivity, now)} hint={formatDate(lastActivity)} />
          <Stat label="Projets / panneaux" value={`${client.projects.length} / ${client.panelPresetCount}`} hint="enregistrés" />
        </div>
      </Section>

      <Section title="Dernières activités" aside={timeline.length > 0 ? `${timeline.length} dernière${timeline.length > 1 ? 's' : ''}` : undefined}>
        {timeline.length === 0 ? (
          <p className="text-xs text-slate-500">Aucune activité enregistrée.</p>
        ) : (
          <ol className="max-h-[420px] overflow-y-auto divide-y divide-white/5">
            {timeline.map((event, index) => (
              <li key={`${event.at}-${index}`} className="py-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="min-w-0 text-xs text-slate-200">
                  <TimelineLabel event={event} clientId={identity.userId} />
                  {event.detail ? <span className="text-slate-400"> · {event.detail}</span> : null}
                </span>
                <span className="text-[11px] text-slate-500 whitespace-nowrap tabular-nums">
                  {event.amount !== null ? (
                    <strong className={`me-2 ${event.amount < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {event.amount > 0 ? `+${event.amount}` : event.amount} cr
                    </strong>
                  ) : null}
                  {formatDateTime(event.at)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section title="Ajuster les crédits">
        <CreditAdjustForm userId={identity.userId} balance={client.balance} />
      </Section>

      <Section title="Commandes manuelles" aside={`${client.orders.length} commande${client.orders.length > 1 ? 's' : ''}`}>
        <div className="overflow-x-auto">
          <SortableTable
            minWidth={760}
            columns={[
              { label: 'Commande', firstDir: 'asc' },
              { label: 'Pack', firstDir: 'asc' },
              { label: 'Montant', align: 'end' },
              { label: 'Méthode', firstDir: 'asc' },
              { label: 'Statut', firstDir: 'asc' },
              { label: 'Créée' },
              { label: 'Décidée' },
              { label: 'Référence / note', sortable: false },
            ]}
            initial={{ col: 5, dir: 'desc' }}
            rows={client.orders.map((order) => ({
              key: order.order_number,
              cells: [
                <span key="n" className="font-mono font-bold text-amber-400 whitespace-nowrap" dir="ltr">
                  {order.order_number}
                </span>,
                packLabel(order.pack_id),
                <span key="m" className="whitespace-nowrap">
                  {formatMad(order.amount_mad)}
                  <span className="block text-[10px] text-slate-500">{order.credits} cr</span>
                </span>,
                order.method ? PAYMENT_METHOD_LABELS[order.method] ?? order.method : '—',
                <Badge key="s" className={ORDER_STATUS_STYLES[order.status] ?? ORDER_STATUS_STYLES.expired}>
                  {ORDER_STATUS_LABELS[order.status] ?? order.status}
                </Badge>,
                <span key="c" className="whitespace-nowrap">{formatDateTime(order.created_at)}</span>,
                <span key="d" className="whitespace-nowrap">{formatDateTime(order.decided_at)}</span>,
                <span key="r" className="break-words">
                  {order.payment_reference || '—'}
                  {order.operator_note ? <span className="block text-[11px] text-slate-500">{order.operator_note}</span> : null}
                </span>,
              ],
              sort: [
                order.order_number,
                packLabel(order.pack_id),
                order.amount_mad,
                order.method,
                ORDER_STATUS_LABELS[order.status] ?? order.status,
                order.created_at,
                order.decided_at,
                null,
              ],
            }))}
            empty="Aucune commande manuelle."
          />
        </div>
      </Section>

      <Section title="Parrainage" aside={referral ? `${referral.referees.length} filleul${referral.referees.length > 1 ? 's' : ''}` : undefined}>
        {referralResult.status === 'unavailable' ? (
          <p className="text-xs text-slate-500">Migration 022 non appliquée : le parrainage n’est pas encore actif.</p>
        ) : !referral ? (
          <p className="text-xs text-rose-400">Impossible de lire le parrainage de ce client.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-300">
                Parrain :{' '}
                {referral.referrer ? (
                  <>
                    <Link href={`/admin/clients/${referral.referrer.id}`} className="font-bold text-amber-400 hover:underline">
                      {referral.referrer.email ?? referral.referrer.id}
                    </Link>{' '}
                    <span className="text-slate-500">depuis le {formatDate(referral.referrer.since)}</span>
                  </>
                ) : (
                  <span className="text-slate-500">aucun</span>
                )}
              </p>
              {referral.referrer ? <DetachReferralButton userId={identity.userId} /> : null}
            </div>
            <div className="overflow-x-auto">
              <SortableTable
                minWidth={520}
                columns={[{ label: 'Filleul', firstDir: 'asc' }, { label: 'Rattaché le' }, { label: 'Bonus gagnés', align: 'end' }]}
                initial={{ col: 1, dir: 'desc' }}
                rows={referral.referees.map((referee) => ({
                  key: referee.id,
                  cells: [
                    <Link key="e" href={`/admin/clients/${referee.id}`} className="text-amber-400 hover:underline">
                      {referee.email ?? referee.id}
                    </Link>,
                    formatDate(referee.joinedAt),
                    <strong key="b" className={referee.earned > 0 ? 'text-emerald-400' : 'text-slate-500'}>
                      {referee.earned > 0 ? `+${referee.earned}` : '0'}
                    </strong>,
                  ],
                  sort: [referee.email, referee.joinedAt, referee.earned],
                }))}
                empty="Aucun filleul."
              />
            </div>
          </div>
        )}
      </Section>

      <Section
        title="Mouvements de crédits"
        aside={client.ledgerTruncated ? `${LEDGER_LIMIT} derniers mouvements` : `${client.ledger.length} mouvement${client.ledger.length > 1 ? 's' : ''}`}
      >
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <SortableTable
            minWidth={920}
            stickyHead
            columns={[
              { label: 'Date' },
              { label: 'Mouvement', firstDir: 'asc' },
              { label: 'Pack', firstDir: 'asc' },
              { label: 'Crédits', align: 'end' },
              { label: 'Solde après', align: 'end' },
              { label: 'Montant / clé', sortable: false },
              { label: 'Parrainage / remboursement', sortable: false },
            ]}
            initial={{ col: 0, dir: 'desc' }}
            rows={client.ledger.map((row) => {
              const kind = classifyLedgerEntry(row);
              const payment = isPaymentKind(kind);
              const key = row.stripe_payment_id ?? '';
              const bonuses = payment ? referral?.bonusesByPurchase[key] : undefined;
              return {
                key: row.id,
                cells: [
                  <span key="d" className="whitespace-nowrap">{formatDateTime(row.created_at)}</span>,
                  KIND_LABELS[kind],
                  payment ? packLabel(row.reason) : '—',
                  <strong key="a" className={row.amount < 0 ? 'text-rose-400' : 'text-emerald-400'}>
                    {row.amount > 0 ? `+${row.amount}` : row.amount}
                  </strong>,
                  row.balance_after ?? '—',
                  <span key="k" className="font-mono text-[10px] text-slate-500 break-all">
                    {row.amount_paid !== null && row.amount_paid !== undefined ? (
                      <span className="block font-sans text-xs text-slate-300">{formatMoney(row.amount_paid, row.currency)}</span>
                    ) : null}
                    {row.stripe_payment_id || ''}
                  </span>,
                  payment ? (
                    <div key="r" className="space-y-1 text-[11px]">
                      {bonuses && (bonuses.referral > 0 || bonuses.welcome > 0) ? (
                        <p className="text-slate-400">
                          {[bonuses.welcome > 0 ? `bienvenue +${bonuses.welcome}` : null, bonuses.referral > 0 ? `parrain +${bonuses.referral}` : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      ) : null}
                      {refunded.has(key) ? (
                        <Badge className="bg-rose-500/15 text-rose-300 border-rose-500/30">Remboursé</Badge>
                      ) : referral ? (
                        <RefundPurchaseButton userId={identity.userId} purchaseKey={key} credits={row.amount} />
                      ) : null}
                    </div>
                  ) : (
                    '—'
                  ),
                ],
                sort: [row.created_at, KIND_LABELS[kind], payment ? packLabel(row.reason) : null, row.amount, row.balance_after, null, null],
              };
            })}
            empty="Aucun mouvement."
          />
        </div>
      </Section>

      <Section title="Projets" aside={`${client.projects.length} projet${client.projects.length > 1 ? 's' : ''}`}>
        <p className="text-[11px] text-slate-500">Un projet est enregistré chaque fois que le client calcule un plan. Ouvrez-le pour voir la photo, les pièces et le plan.</p>
        <div className="overflow-x-auto">
          <SortableTable
            minWidth={760}
            columns={[
              { label: 'Projet', firstDir: 'asc' },
              { label: 'Calculé le' },
              { label: 'Matériau', firstDir: 'asc' },
              { label: 'Pièces', align: 'end' },
              { label: 'Panneaux', align: 'end' },
              { label: 'Chute', align: 'end' },
              { label: 'Photos', align: 'end' },
              { label: 'PDF' },
            ]}
            initial={{ col: 1, dir: 'desc' }}
            rows={client.projects.map((project) => ({
              key: project.id,
              cells: [
                <Link
                  key="p"
                  href={`/admin/clients/${identity.userId}/projets/${project.id}`}
                  className="flex items-center gap-2 font-bold text-slate-100 hover:text-amber-400 break-words"
                >
                  {project.scanThumb ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a stored data: URL, not an optimisable asset
                    <img src={project.scanThumb} alt="" className="w-9 h-9 shrink-0 object-cover rounded border border-white/10" />
                  ) : null}
                  <span>
                    {project.name}
                    {project.hasQuotation ? <Badge className="ms-1.5 bg-sky-500/15 text-sky-400 border-sky-500/30">Devis</Badge> : null}
                  </span>
                </Link>,
                <span key="c" className="whitespace-nowrap">{formatDateTime(project.createdAt)}</span>,
                <span key="m" className="whitespace-nowrap">
                  {project.material.toUpperCase()}
                  <span className="block text-[10px] text-slate-500" dir="ltr">
                    {project.sheetWidth} × {project.sheetHeight}
                  </span>
                </span>,
                project.pieceCount,
                project.sheetsUsed ?? '—',
                project.wastePercentage === null ? '—' : `${project.wastePercentage.toFixed(1)} %`,
                project.scanThumbs.length,
                <span key="f" className="whitespace-nowrap">{project.pdfGeneratedAt ? formatDateTime(project.pdfGeneratedAt) : '—'}</span>,
              ],
              sort: [
                project.name,
                project.createdAt,
                project.material,
                project.pieceCount,
                project.sheetsUsed,
                project.wastePercentage,
                project.scanThumbs.length,
                project.pdfGeneratedAt,
              ],
            }))}
            empty="Aucun projet enregistré dans le cloud."
          />
        </div>
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

      <Section title="Supprimer le compte">
        <DeleteAccountForm userId={identity.userId} confirmValue={identity.email ?? identity.userId} blockedReason={deleteBlockedReason} />
      </Section>
    </>
  );
}

/** The event's label; a computed plan opens its project page. */
function TimelineLabel({ event, clientId }: { event: TimelineEvent; clientId: string }) {
  if (event.projectId) {
    return (
      <Link href={`/admin/clients/${clientId}/projets/${event.projectId}`} className="font-bold text-amber-400 hover:underline">
        {event.label}
      </Link>
    );
  }
  return <strong>{event.label}</strong>;
}
