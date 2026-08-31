'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  Calendar,
  ArrowRight,
  Zap,
  ArrowLeft,
  RefreshCw,
  CloudOff,
  Search,
} from 'lucide-react';
import { readLocalHistory, type LocalHistoryItem } from '@/lib/history';
import { AccountMenu } from '@/components/AccountMenu';
import { QatlIALogo } from '@/components/QatlIALogo';
import { EmptyState } from '@/components/EmptyState';
import { LocaleSwitcher, useLocale } from '@/components/LocaleProvider';
import { materialBadgeKey, materialLabelKey } from '@/i18n/domain';
import { formatDateTime, type TranslationKey } from '@/i18n';
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
  };
}

/**
 * The stored panel dimensions are canonical domain values (see src/lib/units.ts),
 * so the card states them in the canonical unit whatever display unit the
 * artisan was working in when the plan was saved. Being geometry, they are not
 * routed through the locale number formatter either: a panel reads the same in
 * every language.
 */
const CANONICAL_UNIT: DisplayUnit = 'cm';

/** Materials an artisan can filter the list by, in the order they are offered. */
const FILTERABLE_MATERIALS = ['mdf', 'aluminium', 'verre'] as const;

/**
 * Card badge tone per material. Only the three materials that have ever had
 * their own colour are listed; everything else keeps the default tone, and the
 * label itself comes from `materialBadgeKey`.
 */
const MATERIAL_BADGE_TONES: Record<string, string> = {
  aluminium: 'bg-slate-500/20 text-slate-700 dark:text-slate-300 border-slate-500/30',
  verre: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  contreplaques: 'bg-brand-600/10 text-brand-400 border-brand-500/20',
};

const DEFAULT_BADGE_TONE = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';

const CARD_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

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

  const handleLoadProject = (project: ProjectHistoryItem) => {
    if (project.options_json) {
      sessionStorage.setItem('qatlia_saved_project', JSON.stringify(project.options_json));
      window.location.href = '/atelier';
    }
  };

  const getMaterialBadge = (mat?: string) => {
    const material = mat?.toLowerCase();
    const tone = (material && MATERIAL_BADGE_TONES[material]) || DEFAULT_BADGE_TONE;
    return (
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${tone}`}>
        {t(materialBadgeKey(material))}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-studio-canvas text-slate-900 dark:text-slate-100 font-sans antialiased selection:bg-brand-500 selection:text-black pb-16">
      <header className="sticky top-0 z-40 border-b border-studio-border/70 bg-studio-canvas/70 backdrop-blur-2xl backdrop-saturate-150">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 sm:px-8 h-16">
          <div className="flex items-center gap-3">
            <Link href="/atelier" className="flex items-center gap-2 px-3 py-2 rounded-xl bg-studio-panel hover:bg-studio-field text-slate-700 dark:text-slate-300 text-xs font-semibold border border-studio-border transition-all">
              <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" aria-hidden="true" /><span>{t('historyPage.backToAtelier')}</span>
            </Link>
            <div className="flex items-center gap-2">
              <div className="text-brand-400"><QatlIALogo size="sm" /></div>
              <h1 className="font-display font-extrabold text-base text-slate-900 dark:text-white tracking-tight">{t('atelier.header.history')}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <Link
              href="/credits"
              aria-label={`${t('atelier.header.creditsAria')}: ${userCredits === null ? '—' : n(userCredits)}`}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-500/10 border border-brand-500/25 text-brand-400 hover:bg-brand-500/15 text-xs font-semibold transition-all"
            >
              <Zap className="w-3.5 h-3.5 fill-brand-400 text-brand-400" aria-hidden="true" />
              <span dir="ltr" className="font-mono font-bold">{userCredits === null ? '—' : n(userCredits)}</span>
            </Link>
            {userEmail ? (<AccountMenu email={userEmail} />) : (
              <Link href="/auth/login?redirect=/history" className="px-4 py-2 rounded-xl bg-white dark:bg-studio-field text-slate-950 font-bold text-xs hover:bg-slate-100 transition-all">{t('nav.login')}</Link>
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
          <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-brand-500/10 border border-brand-500/20 text-brand-300 text-xs">
            <CloudOff className="w-4 h-4 shrink-0" aria-hidden="true" />{t(syncNote)}
          </div>
        )}

        {/* Filters */}
        {projects.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-xs">
              <Search className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 absolute start-2.5 top-2.5" aria-hidden="true" />
              <input type="text" placeholder={t('historyPage.filterPlaceholder')} aria-label={t('historyPage.filterAria')} value={filterText}
                onChange={e => setFilterText(e.target.value)}
                className="w-full ps-7 pe-2 py-1.5 rounded-lg bg-studio-field/60 border border-studio-border/80 text-slate-800 dark:text-slate-200 text-xs outline-none focus:border-brand-500/50" />
            </div>
            <select value={materialFilter} onChange={e => setMaterialFilter(e.target.value)}
              aria-label={t('historyPage.materialFilterAria')}
              className="px-2.5 py-1.5 rounded-lg bg-studio-field/60 border border-studio-border/80 text-slate-700 dark:text-slate-300 text-xs outline-none focus:border-brand-500/50">
              <option value="">{t('historyPage.allMaterials')}</option>
              {FILTERABLE_MATERIALS.map((material) => (
                <option key={material} value={material}>{t(materialLabelKey(material))}</option>
              ))}
            </select>
            <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 ms-auto">{tn('historyPage.resultCount', filtered.length)}</span>
          </div>
        )}

        {loading ? (
          <div role="status" aria-label={t('historyPage.loadingAria')} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1,2,3,4].map(i => <SkeletonCard key={i} />)}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState type="ready" />
        ) : filtered.length === 0 ? (
          <EmptyState type="no-results" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map((proj) => {
              const optJson = proj.options_json || {};
              const res = optJson.result;
              const pieceCount = optJson.pieces?.reduce((s, p) => s + (p.quantity || 1), 0) || 0;
              const wasteRate = res?.wastePercentage ?? 0;
              const sheetsUsed = res?.sheetsUsed ?? 1;
              return (
                <div key={proj.id} className="p-5 rounded-2xl bg-studio-panel/70 border border-studio-border hover:border-brand-400/40 transition-all flex flex-col justify-between gap-4 group">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono text-slate-600 dark:text-slate-400 flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                        {formatDateTime(locale, proj.created_at, CARD_DATE_OPTIONS)}
                      </span>
                      {getMaterialBadge(proj.material)}
                    </div>
                    <h3 className="text-base font-black text-slate-900 dark:text-white truncate">{proj.name}</h3>
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-studio-border text-xs font-mono">
                      <div className="p-2 rounded-lg bg-studio-canvas"><span className="text-[10px] text-slate-500 dark:text-slate-400 block">{t('historyPage.stats.panel')}</span><span dir="ltr" className="font-bold text-slate-900 dark:text-white">{t('historyPage.sheetSize', { height: proj.sheet_height, width: proj.sheet_width, unit: CANONICAL_UNIT })}</span></div>
                      <div className="p-2 rounded-lg bg-studio-canvas"><span className="text-[10px] text-slate-500 dark:text-slate-400 block">{t('historyPage.stats.pieces')}</span><span className="font-bold text-brand-400">{t('historyPage.piecesValue', { count: n(pieceCount) })}</span></div>
                      <div className="p-2 rounded-lg bg-studio-canvas"><span className="text-[10px] text-slate-500 dark:text-slate-400 block">{t('historyPage.stats.waste')}</span><span dir="ltr" className="font-bold text-emerald-400">{wasteRate > 0 ? `${wasteRate}%` : '—'}</span></div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-[11px] font-mono font-bold text-slate-600 dark:text-slate-400">{tn('historyPage.sheetsUsed', sheetsUsed)}</span>
                    <button onClick={() => handleLoadProject(proj)} aria-label={t('historyPage.openAria', { name: proj.name })} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-brand-500 hover:bg-brand-400 text-slate-950 font-black text-xs transition-all group-hover:shadow-lg group-hover:shadow-brand-500/20">{t('historyPage.open')}<ArrowRight className="w-3.5 h-3.5 rtl:-scale-x-100" aria-hidden="true" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
