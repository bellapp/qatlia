'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  Zap,
  ArrowLeft,
  RefreshCw,
  CloudOff,
  Search,
} from 'lucide-react';
import { readLocalHistory, renameLocalHistoryItem, type LocalHistoryItem } from '@/lib/history';
import { AccountMenu } from '@/components/AccountMenu';
import { QatlIALogo } from '@/components/QatlIALogo';
import { EmptyState } from '@/components/EmptyState';
import { ScanViewer, useScanViewer } from '@/components/ScanViewer';
import { LocaleSwitcher, useLocale } from '@/components/LocaleProvider';
import { HistoryCards } from '@/components/history/HistoryCards';
import { HistoryTable } from '@/components/history/HistoryTable';
import { HistoryViewToggle } from '@/components/history/HistoryViewToggle';
import { materialLabelKey } from '@/i18n/domain';
import { type TranslationKey } from '@/i18n';
import { readHistoryView, restoreSeedFromRow, toHistoryRow, writeHistoryView, type HistoryView } from '@/lib/projects/history-row';
import type { DisplayUnit } from '@/lib/units';

interface ProjectHistoryItem {
  id: string;
  name: string;
  material: string;
  sheet_width: number;
  sheet_height: number;
  kerf: number;
  grain_direction: boolean;
  status: string;
  created_at: string;
  options_json?: {
    pieces?: Array<{ name: string; height: number; width: number; quantity: number }>;
    sheet?: { width: number; height: number; material: string };
    options?: Record<string, unknown>;
    result?: { sheetsUsed?: number; wastePercentage?: number };
    // Persistence metadata (see src/lib/units.ts ProjectUnitPersistenceMetadata):
    // which display unit the artisan was using, and whether this record's
    // unit metadata traces back to a legacy (pre-metadata) project.
    displayUnit?: DisplayUnit;
    canonicalUnit?: 'cm';
    migratedFromLegacyUnit?: boolean;
    projectName?: string;
  };
}

/**
 * A local-only history entry's `id` (see src/lib/history.ts's
 * `writeLocalHistoryItem`, e.g. `optimize_1699999999999`) is never a real
 * server project id — only a cloud-synced entry's id (a genuine Supabase
 * UUID) is safe to hand to `/api/export-quotation` as `projectId`, which
 * validates it as a UUID and would otherwise 400 the whole quote.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Materials an artisan can filter the list by, in the order they are offered. */
const FILTERABLE_MATERIALS = ['mdf', 'aluminium', 'verre'] as const;

/** The browser's localStorage, or null where reaching it throws (blocked storage). */
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function mergeHistory(cloud: ProjectHistoryItem[], local: LocalHistoryItem[]): ProjectHistoryItem[] {
  const mappedLocal: ProjectHistoryItem[] = local.map((p) => ({
    id: p.id, name: p.name, material: p.material,
    sheet_width: p.sheet_width, sheet_height: p.sheet_height,
    kerf: p.kerf, grain_direction: p.grain_direction,
    status: p.status, created_at: p.created_at,
    options_json: p.options_json as ProjectHistoryItem['options_json'],
  }));
  const seen = new Set<string>();
  const out: ProjectHistoryItem[] = [];
  // Cloud rows are inserted FIRST so that when a local fallback copy exists
  // for the same run (same name + same minute — the pre-cloud-save era wrote
  // both), the cloud row wins and the local twin is dropped.
  for (const item of [...cloud, ...mappedLocal]) {
    const key = `${item.name}|${item.created_at.slice(0, 16)}`;
    if (seen.has(item.id) || seen.has(key)) continue;
    seen.add(item.id); seen.add(key); out.push(item);
  }
  return out.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
}

function SkeletonCard() {
  return (
    <div className="p-5 rounded-2xl bg-studio-panel/70 border border-studio-border animate-pulse space-y-3">
      <div className="flex justify-between">
        <div className="h-3 w-28 bg-studio-field rounded" />
        <div className="h-4 w-14 bg-studio-field rounded" />
      </div>
      <div className="h-5 w-3/4 bg-studio-field rounded" />
      <div className="grid grid-cols-3 gap-2 pt-2">
        <div className="h-12 bg-studio-field rounded-lg" />
        <div className="h-12 bg-studio-field rounded-lg" />
        <div className="h-12 bg-studio-field rounded-lg" />
      </div>
      <div className="flex justify-between pt-1">
        <div className="h-3 w-24 bg-studio-field rounded" />
        <div className="h-8 w-20 bg-studio-field rounded-xl" />
      </div>
    </div>
  );
}

export default function HistoryPage() {
  const { t, tn, n, locale } = useLocale();
  const [projects, setProjects] = useState<ProjectHistoryItem[]>([]);
  const [filtered, setFiltered] = useState<ProjectHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userCredits, setUserCredits] = useState<number | null>(null);
  // The note is held as a key, not as rendered copy, so a language switch
  // re-renders it instead of leaving the previous locale on screen.
  const [syncNote, setSyncNote] = useState<TranslationKey | null>(null);
  const [filterText, setFilterText] = useState('');
  const [materialFilter, setMaterialFilter] = useState('');
  // Cards until the remembered choice is read after mounting (the server has
  // no localStorage, and the first render has to match it).
  const [view, setView] = useState<HistoryView>('cards');
  // Rows whose PDF is being built (their button is busy), and whether the
  // last attempt failed (a line above the list says so).
  const [pdfPendingIds, setPdfPendingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pdfFailed, setPdfFailed] = useState(false);

  useEffect(() => { setView(readHistoryView(browserStorage())); }, []);

  const changeView = (next: HistoryView) => {
    setView(next);
    writeHistoryView(browserStorage(), next);
  };

  /** Renames a project: cloud rows go through PATCH /api/projects/[id]
   *  (ownership-checked); local-only rows update localStorage directly.
   *  Resolves true only once the new name is saved, false on any failure. */
  const commitRename = async (id: string, nextName: string): Promise<boolean> => {
    const proj = projects.find((p) => p.id === id);
    const name = nextName.trim();
    if (!proj || !name) return false;
    let ok = false;
    if (UUID_PATTERN.test(proj.id)) {
      try {
        const res = await fetch(`/api/projects/${proj.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        ok = res.ok;
      } catch { ok = false; }
    } else {
      // Local-only item: rename inside the localStorage history.
      ok = renameLocalHistoryItem(proj.id, name);
    }
    if (ok) {
      // The atelier reads `options_json.projectName` on reopening, so the card
      // in memory carries the new name there too (as the server and the local
      // history now do).
      setProjects((prev) => prev.map((p) => (
        p.id === proj.id ? { ...p, name, options_json: { ...p.options_json, projectName: name } } : p
      )));
    }
    return ok;
  };

  /** Rebuilds and downloads the cutting-plan PDF from the stored project
   *  data — the PDF itself is never persisted, only regenerated on demand.
   *  Resolves true once the file is handed to the browser, false otherwise. */
  const downloadPdf = async (proj: ProjectHistoryItem): Promise<boolean> => {
    try {
      const optJson = (proj.options_json || {}) as {
        sheet?: unknown; sheets?: unknown; pieces?: unknown; options?: unknown; result?: unknown;
        displayUnit?: string; projectName?: string; name?: string;
        scanThumb?: string; pdfGeneratedAt?: string;
      };
      const payload = {
        projectName: optJson.projectName || proj.name,
        sheet: optJson.sheet,
        pieces: optJson.pieces,
        result: optJson.result,
        displayUnit: optJson.displayUnit || 'cm',
        locale,
      };
      const res = await fetch('/api/export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return false;
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `QatliA_${(optJson.projectName || proj.name).replace(/\s+/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      return true;
    } catch {
      return false;
    }
  };


  const fetchHistory = async () => {
    setLoading(true);
    setSyncNote(null);
    const local = readLocalHistory();
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserEmail(user.email || null);
        try {
          const { data: p } = await supabase.from('profiles').select('credits').eq('id', user.id).single();
          setUserCredits(typeof p?.credits === 'number' ? p.credits : null);
        } catch {
          setUserCredits(null);
        }
        const res = await fetch('/api/projects');
        const data = await res.json();
        if (data.success && Array.isArray(data.projects)) {
          setProjects(mergeHistory(data.projects, local));
          if (data.projects.length === 0 && local.length > 0) {
            setSyncNote('historyPage.sync.localOnly');
          }
        } else {
          setProjects(mergeHistory([], local));
          // The upstream message is only ever read to tell the two cases
          // apart; it is never rendered.
          const raw = String(data.message || '');
          const missingTable = /schema cache|could not find the table|public\.projects/i.test(raw);
          setSyncNote(missingTable ? 'historyPage.sync.cloudDisabled' : 'historyPage.sync.cloudUnavailable');
        }
      } else {
        setUserEmail(null);
        setProjects(mergeHistory([], local));
      }
    } catch {
      setProjects(mergeHistory([], local));
      setSyncNote('historyPage.sync.offline');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchHistory(); }, []);

  useEffect(() => {
    let list = projects;
    if (filterText) {
      const q = filterText.toLowerCase();
      list = list.filter(p => (p.name || '').toLowerCase().includes(q) || `${p.sheet_height}x${p.sheet_width}`.includes(q));
    }
    if (materialFilter) {
      list = list.filter(p => p.material === materialFilter);
    }
    setFiltered(list);
  }, [projects, filterText, materialFilter]);

  const rows = useMemo(() => filtered.map(toHistoryRow), [filtered]);

  const handleLoadProject = (id: string) => {
    const project = projects.find((p) => p.id === id);
    // An old project that kept no saved data still opens: the atelier skips
    // every missing field and starts without a plan, linked to this entry.
    if (project) {
      // A project renamed from the history before the name was also kept in its
      // saved data still carries the old name there: the name on the card wins,
      // but only over a name that is stored (an automatic name is never typed
      // into the atelier's field).
      const storedName = project.options_json?.projectName;
      const restoredOptions =
        UUID_PATTERN.test(project.id)
        && project.name.trim()
        && typeof storedName === 'string'
        && storedName.trim()
        && storedName.trim() !== project.name.trim()
          ? { ...project.options_json, projectName: project.name.trim() }
          : project.options_json ?? restoreSeedFromRow(project);
      sessionStorage.setItem('qatlia_saved_project', JSON.stringify(restoredOptions));
      // Read back by atelier/page.tsx's restore effect so QuotationDialog's
      // `projectId` targets the project the artisan actually opened here,
      // not only the most recent auto-save (Task 8 remediation — item 10).
      // A locally-only history entry's id is never a real server UUID (see
      // UUID_PATTERN's own doc comment): it goes under its own key, so a name
      // typed in the atelier is written back to that local entry.
      if (UUID_PATTERN.test(project.id)) {
        sessionStorage.setItem('qatlia_restored_project_id', project.id);
        sessionStorage.removeItem('qatlia_restored_local_id');
      } else {
        sessionStorage.removeItem('qatlia_restored_project_id');
        sessionStorage.setItem('qatlia_restored_local_id', project.id);
      }
      // The atelier says when the plan it reopens was saved.
      sessionStorage.setItem('qatlia_restored_project_meta', JSON.stringify({ createdAt: project.created_at }));
      window.location.href = '/atelier';
    }
  };

  const handleDownloadPdf = async (id: string) => {
    const project = projects.find((p) => p.id === id);
    if (!project || pdfPendingIds.has(id)) return;
    setPdfPendingIds((prev) => new Set(prev).add(id));
    setPdfFailed(false);
    const ok = await downloadPdf(project);
    setPdfPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (!ok) setPdfFailed(true);
  };

  const scanViewer = useScanViewer();

  /**
   * Shows a project's scan in the viewer: the full image through a short
   * signed link when the project kept it (a cloud row only), else the
   * thumbnail, marked as reduced. Seeing it spends no credit.
   */
  const openScan = (id: string) => {
    const row = rows.find((candidate) => candidate.id === id);
    if (!row) return;
    void scanViewer.show(row.id, {
      projectId: row.isCloud ? row.id : null,
      hasFullScan: row.hasFullScan,
      thumb: row.scanThumb,
    }, row.name);
  };

  const listProps = {
    rows,
    onOpen: handleLoadProject,
    onRename: commitRename,
    onDownloadPdf: (id: string) => { void handleDownloadPdf(id); },
    pdfPendingIds,
    onViewScan: openScan,
    scanPendingId: scanViewer.pendingKey,
  };

  return (
    <div className="min-h-screen bg-studio-canvas text-slate-900 dark:text-slate-100 font-sans antialiased selection:bg-brand-400 selection:text-black pb-16">
      <header className="sticky top-0 z-40 border-b border-studio-border/70 bg-studio-canvas/70 backdrop-blur-2xl backdrop-saturate-150">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2 px-4 sm:px-8 h-16">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link
              href="/atelier"
              aria-label={t('historyPage.backToAtelier')}
              className="shrink-0 flex items-center justify-center gap-2 min-w-10 min-h-10 px-2.5 sm:px-3 py-2 rounded-xl bg-studio-panel hover:bg-studio-field text-slate-700 dark:text-slate-300 text-xs font-semibold border border-studio-border transition-all"
            >
              <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" aria-hidden="true" /><span className="hidden sm:inline">{t('historyPage.backToAtelier')}</span>
            </Link>
            <div className="flex items-center gap-2 min-w-0">
              <div className="hidden sm:block text-brand-400"><QatlIALogo size="sm" /></div>
              {/* On a phone the language, credits and account controls fill the
                  bar; the title stays for screen readers (the page heading
                  below names the page too). */}
              <h1 className="sr-only sm:not-sr-only font-display font-extrabold text-base text-slate-900 dark:text-white tracking-tight truncate">{t('atelier.header.history')}</h1>
            </div>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <LocaleSwitcher />
            <Link
              href="/credits"
              aria-label={`${t('atelier.header.creditsAria')}: ${userCredits === null ? '—' : n(userCredits)}`}
              className="flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 rounded-xl bg-brand-400/10 border border-brand-500/25 text-brand-400 hover:bg-brand-500/15 text-xs font-semibold transition-all"
            >
              <Zap className="w-3.5 h-3.5 fill-brand-400 text-brand-400" aria-hidden="true" />
              <span dir="ltr" className="font-mono font-bold">{userCredits === null ? '—' : n(userCredits)}</span>
            </Link>
            {userEmail ? (<AccountMenu email={userEmail} />) : (
              <Link href="/auth/login?redirect=/history" className="px-3 sm:px-4 py-2 rounded-xl bg-white dark:bg-studio-field text-slate-950 font-bold text-xs hover:bg-slate-100 transition-all">{t('nav.login')}</Link>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-8 mt-8 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400/80">{t('historyPage.eyebrow')}</p>
            <h2 className="text-2xl font-black text-slate-900 dark:text-white mt-1">{t('historyPage.heading')}</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{t('historyPage.subtitle')}</p>
          </div>
          <button onClick={fetchHistory} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-studio-panel hover:bg-studio-field text-slate-700 dark:text-slate-300 text-xs font-semibold border border-studio-border transition-all">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> {t('historyPage.refresh')}
          </button>
        </div>

        {syncNote && (
          <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-brand-400/10 border border-brand-500/20 text-brand-300 text-xs">
            <CloudOff className="w-4 h-4 shrink-0" aria-hidden="true" />{t(syncNote)}
          </div>
        )}

        {/* Filters, then the view toggle at the end. On a phone the search takes
            the first line and the rest wraps onto a second one. */}
        {projects.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-auto sm:flex-1 sm:max-w-xs">
              <Search className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 absolute start-2.5 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input type="text" placeholder={t('historyPage.filterPlaceholder')} aria-label={t('historyPage.filterAria')} value={filterText}
                onChange={e => setFilterText(e.target.value)}
                className="w-full ps-7 pe-2 py-2.5 rounded-lg bg-studio-field/60 border border-studio-border/80 text-slate-800 dark:text-slate-200 text-xs outline-none focus:border-brand-500/50" />
            </div>
            <select value={materialFilter} onChange={e => setMaterialFilter(e.target.value)}
              aria-label={t('historyPage.materialFilterAria')}
              className="min-w-0 px-2.5 py-2.5 rounded-lg bg-studio-field/60 border border-studio-border/80 text-slate-700 dark:text-slate-300 text-xs outline-none focus:border-brand-500/50 [&>option]:bg-white [&>option]:text-slate-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100">
              <option value="">{t('historyPage.allMaterials')}</option>
              {FILTERABLE_MATERIALS.map((material) => (
                <option key={material} value={material}>{t(materialLabelKey(material))}</option>
              ))}
            </select>
            <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 ms-auto">{tn('historyPage.resultCount', filtered.length)}</span>
            <HistoryViewToggle view={view} onChange={changeView} />
          </div>
        )}

        {/* Always in the page, so a screen reader hears the failure when it appears. */}
        <p role="status" aria-live="polite" data-testid="history-pdf-failed" className={pdfFailed ? 'text-xs font-semibold text-red-600 dark:text-red-400' : 'sr-only'}>
          {pdfFailed ? t('historyPage.pdfFailed') : ''}
        </p>

        {loading ? (
          <div role="status" aria-label={t('historyPage.loadingAria')} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1,2,3,4].map(i => <SkeletonCard key={i} />)}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState type="ready" />
        ) : filtered.length === 0 ? (
          <EmptyState type="no-results" />
        ) : view === 'table' ? (
          <HistoryTable {...listProps} />
        ) : (
          <HistoryCards {...listProps} />
        )}
      </main>

      {scanViewer.view && <ScanViewer {...scanViewer.view} onClose={scanViewer.close} />}
    </div>
  );
}
