import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminPage } from '@/lib/admin/auth';
import { getAdminDb } from '@/lib/admin/db';
import { getClientProject } from '@/lib/admin/project-detail';
import { formatDateTime } from '@/lib/admin/format';
import { Badge, Field, Notice, Section } from '../../../../ui';
import { PlanSheet } from '../../../../PlanSheet';
import { SortableTable } from '../../../../SortableTable';

/**
 * One saved project of a client, in full (spec 2026-11-25): what the artisan
 * photographed, the pieces as they were when the plan was computed, and the
 * plan. The photo links are signed for 5 minutes, so the page is never cached.
 */

export const dynamic = 'force-dynamic';

const PRIORITY_LABELS: Record<string, string> = {
  linear_guillotine: 'Coupe linéaire traversante',
  min_waste: 'Minimiser les chutes',
  min_sheets: 'Minimiser les panneaux',
  balanced: 'Équilibré',
};

/** Panels drawn on the page; the count above always says how many there are. */
const MAX_DRAWN_SHEETS = 12;

const cm = (n: number | null) => (n === null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(1));
const withCm = (n: number | null) => (n === null ? '—' : `${cm(n)} cm`);

export default async function ClientProjectPage({ params }: { params: { id: string; projectId: string } }) {
  await requireAdminPage(`/admin/clients/${params.id}/projets/${params.projectId}`);
  const db = getAdminDb();
  if (!db) {
    return <Notice tone="error">Base non configurée : NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.</Notice>;
  }
  const res = await getClientProject(db, params.id, params.projectId);
  if (res.status === 'not_found') notFound();
  if (res.status === 'error') {
    return <Notice tone="error">Impossible de charger ce projet. Réessayez dans un instant.</Notice>;
  }

  const { project, scanUrls } = res;
  const { result } = project;
  const pieceTotal = project.pieces.reduce((sum, piece) => sum + piece.quantity, 0);
  const fromSheets = project.pieces.some((piece) => piece.scanIndex !== null);

  return (
    <>
      <div className="space-y-1">
        <Link href={`/admin/clients/${params.id}`} className="text-xs font-bold text-slate-500 hover:text-slate-300">
          ← Fiche client
        </Link>
        <h1 className="text-xl font-black text-white break-words">{project.name}</h1>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          <span>Plan calculé le {formatDateTime(project.createdAt)}</span>
          <span>· {project.material.toUpperCase()}</span>
          {project.pdfGeneratedAt ? <span>· PDF le {formatDateTime(project.pdfGeneratedAt)}</span> : null}
          {project.hasQuotation ? <Badge className="bg-sky-500/15 text-sky-400 border-sky-500/30">Devis (contenu non affiché)</Badge> : null}
        </div>
      </div>

      <Section
        title="Photo de la fiche"
        aside={project.scans.length > 1 ? `${project.scans.length} fiches` : undefined}
      >
        {project.scans.length === 0 ? (
          <p className="text-xs text-slate-500">Pas de photo : la liste a été saisie à la main, ou la photo n’a pas été gardée.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {project.scans.map((scan, index) => {
              const url = scanUrls[index];
              const src = url ?? scan.thumb;
              return (
                <figure key={index} className="space-y-1.5">
                  <figcaption className="text-[11px] text-slate-400">
                    Fiche {index + 1}
                    {!url && scan.thumb ? <span className="text-amber-400"> · version réduite (photo complète indisponible)</span> : null}
                    {url ? (
                      <>
                        {' · '}
                        <a href={url} target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline">
                          ouvrir en grand
                        </a>
                        <span className="text-slate-500"> (lien valable 5 min)</span>
                      </>
                    ) : null}
                  </figcaption>
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a signed private link or a stored data: URL, not an optimisable asset
                    <img src={src} alt={`Fiche ${index + 1} du projet ${project.name}`} className="w-full max-h-[720px] object-contain rounded-lg border border-white/10 bg-black/30" />
                  ) : (
                    <p className="text-xs text-slate-500">Image non gardée pour cette fiche.</p>
                  )}
                </figure>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Pièces au moment du calcul" aside={`${project.pieces.length} ligne${project.pieces.length > 1 ? 's' : ''} · ${pieceTotal} pièce${pieceTotal > 1 ? 's' : ''}`}>
        <p className="text-[11px] text-slate-500">
          C’est la liste après les éventuelles corrections du client, pas forcément ce que la photo a donné.
          {fromSheets ? ' La colonne « Origine » dit de quelle fiche vient chaque ligne.' : ''}
        </p>
        <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
          <SortableTable
            minWidth={620}
            stickyHead
            columns={[
              { label: '#', align: 'end', firstDir: 'asc' },
              { label: 'Nom', firstDir: 'asc' },
              { label: 'Long.', align: 'end' },
              { label: 'Larg.', align: 'end' },
              { label: 'Qté', align: 'end' },
              { label: 'Origine', firstDir: 'asc' },
              { label: 'Chants', firstDir: 'asc' },
              { label: 'Fil', firstDir: 'asc' },
            ]}
            rows={project.pieces.map((piece, index) => ({
              key: String(index),
              cells: [
                index + 1,
                piece.name ?? <span className="text-slate-500">sans nom</span>,
                cm(piece.width),
                cm(piece.height),
                piece.quantity,
                piece.scanIndex !== null ? `Fiche ${piece.scanIndex}` : <span className="text-slate-500">ajoutée à la main</span>,
                piece.edges ?? '—',
                piece.grain ?? '—',
              ],
              sort: [index + 1, piece.name, piece.width, piece.height, piece.quantity, piece.scanIndex ?? 99, piece.edges, piece.grain],
            }))}
            empty="Aucune pièce enregistrée."
          />
        </div>
      </Section>

      <Section title="Résultat">
        {result ? (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
              <Field label="Panneaux utilisés">{result.sheetsUsed ?? result.sheets.length}</Field>
              <Field label="Chute">{result.wastePercentage === null ? '—' : `${result.wastePercentage.toFixed(1)} %`}</Field>
              <Field label="Pièces non placées">
                <span className={result.unplaced.length > 0 ? 'text-rose-400 font-bold' : undefined}>{result.unplaced.length}</span>
              </Field>
              <Field label="Panneau saisi">
                <span dir="ltr">
                  {project.sheet ? `${cm(project.sheet.width)} × ${cm(project.sheet.height)}` : '—'}
                </span>
                {project.sheet?.label ? <span className="block text-[11px] text-slate-500">{project.sheet.label}</span> : null}
              </Field>
              <Field label="Trait de scie">{withCm(project.options?.kerf ?? project.sheet?.kerf ?? null)}</Field>
              <Field label="Marge">{withCm(project.sheet?.margin ?? null)}</Field>
              <Field label="Objectif">{project.options?.priority ? PRIORITY_LABELS[project.options.priority] ?? project.options.priority : '—'}</Field>
            </dl>

            {result.unplaced.length > 0 ? (
              <ul className="space-y-1 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
                {result.unplaced.map((piece, index) => (
                  <li key={index}>
                    <strong>{piece.name ?? 'Pièce sans nom'}</strong>{' '}
                    <span dir="ltr">
                      ({cm(piece.width)} × {cm(piece.height)})
                    </span>
                    {piece.reason ? <span className="text-rose-300/80"> — {piece.reason}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}

            {result.sheets.length === 0 ? (
              <p className="text-xs text-slate-500">Le détail des panneaux n’a pas été enregistré avec ce projet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {result.sheets.slice(0, MAX_DRAWN_SHEETS).map((sheet, index) => (
                  <PlanSheet key={index} sheet={sheet} number={index + 1} />
                ))}
              </div>
            )}
            {result.sheets.length > MAX_DRAWN_SHEETS ? (
              <p className="text-[11px] text-slate-500">
                {MAX_DRAWN_SHEETS} premiers panneaux dessinés sur {result.sheets.length}.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-slate-500">Aucun résultat enregistré pour ce projet.</p>
        )}
      </Section>
    </>
  );
}
