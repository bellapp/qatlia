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
  };
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
  const [projects, setProjects] = useState<ProjectHistoryItem[]>([]);
  const [filtered, setFiltered] = useState<ProjectHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userCredits, setUserCredits] = useState<number>(5);
  const [syncNote, setSyncNote] = useState<string | null>(null);
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
        try { const { data: p } = await supabase.from('profiles').select('credits').eq('id', user.id).single(); if (p) setUserCredits(p.credits); } catch {/* noop */}
        const res = await fetch('/api/projects');
        const data = await res.json();
        if (data.success && Array.isArray(data.projects)) {
          setProjects(mergeHistory(data.projects, local));
          if (data.projects.length === 0 && local.length > 0) {
            setSyncNote('Plans enregistrés sur cet appareil. La sync cloud se fera dès que la base atelier sera prête.');
          }
        } else {
          setProjects(mergeHistory([], local));
          const raw = String(data.message || '');
          const missingTable = /schema cache|could not find the table|public\.projects/i.test(raw);
          setSyncNote(missingTable ? 'Historique cloud pas encore activé — vos débits de cet appareil s\'affichent ci-dessous.' : 'Historique cloud indisponible — affichage local.');
        }
      } else {
        setUserEmail(null);
        setProjects(mergeHistory([], local));
      }
    } catch {
      setProjects(mergeHistory([], local));
      setSyncNote('Impossible de joindre le serveur — historique local affiché.');
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
    switch (mat?.toLowerCase()) {
      case 'aluminium': return <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-500/20 text-slate-300 border border-slate-500/30">Alu</span>;
      case 'verre': return <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">Verre</span>;
      case 'contreplaques': return <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-brand-600/10 text-brand-400 border border-brand-500/20">CTP</span>;
      default: return <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">MDF</span>;
    }
  };

  return (
    <div className="min-h-screen bg-studio-canvas text-slate-100 font-sans antialiased selection:bg-brand-500 selection:text-black pb-16">
      <header className="sticky top-0 z-40 border-b border-studio-border/70 bg-studio-canvas/70 backdrop-blur-2xl backdrop-saturate-150">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 sm:px-8 h-16">
          <div className="flex items-center gap-3">
            <Link href="/atelier" className="flex items-center gap-2 px-3 py-2 rounded-xl bg-studio-panel hover:bg-studio-field text-slate-300 text-xs font-semibold border border-studio-border transition-all">
              <ArrowLeft className="w-4 h-4" /><span>Atelier</span>
            </Link>
            <div className="flex items-center gap-2">
              <div className="text-brand-400"><QatlIALogo size="sm" /></div>
              <h1 className="font-display font-extrabold text-base text-white tracking-tight">Historique</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/credits" className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-500/10 border border-brand-500/25 text-brand-400 hover:bg-brand-500/15 text-xs font-semibold transition-all">
              <Zap className="w-3.5 h-3.5 fill-brand-400 text-brand-400" />
              <span className="font-mono font-bold">{userCredits}</span>
            </Link>
            {userEmail ? (<AccountMenu email={userEmail} />) : (
              <Link href="/auth/login?redirect=/history" className="px-4 py-2 rounded-xl bg-white text-slate-950 font-bold text-xs hover:bg-slate-100 transition-all">Connexion</Link>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-8 mt-8 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-400/80">Atelier</p>
            <h2 className="text-2xl font-black text-white mt-1">Vos débits</h2>
            <p className="text-sm text-slate-400 mt-1">Rouvrir un plan, relancer le calepinage ou réexporter le PDF.</p>
          </div>
          <button onClick={fetchHistory} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-studio-panel hover:bg-studio-field text-slate-300 text-xs font-semibold border border-studio-border transition-all">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualiser
          </button>
        </div>

        {syncNote && (
          <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-brand-500/10 border border-brand-500/20 text-brand-300 text-xs">
            <CloudOff className="w-4 h-4 shrink-0" />{syncNote}
          </div>
        )}

        {/* Filters */}
        {projects.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-xs">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
              <input type="text" placeholder="Filtrer par nom ou dimension..." value={filterText}
                onChange={e => setFilterText(e.target.value)}
                className="w-full pl-7 pr-2 py-1.5 rounded-lg bg-studio-field/60 border border-studio-border/80 text-slate-200 text-xs outline-none focus:border-brand-500/50" />
            </div>
            <select value={materialFilter} onChange={e => setMaterialFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-studio-field/60 border border-studio-border/80 text-slate-300 text-xs outline-none focus:border-brand-500/50">
              <option value="">Tous matériaux</option>
              <option value="mdf">MDF</option>
              <option value="aluminium">Aluminium</option>
              <option value="verre">Verre</option>
            </select>
            <span className="text-[10px] font-mono text-slate-500 ml-auto">{filtered.length} résultat{filtered.length !== 1 ? 's' : ''}</span>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                      <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {new Date(proj.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {getMaterialBadge(proj.material)}
                    </div>
                    <h3 className="text-base font-black text-white truncate">{proj.name}</h3>
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-studio-border text-xs font-mono">
                      <div className="p-2 rounded-lg bg-studio-canvas"><span className="text-[10px] text-slate-500 block">Panneau</span><span className="font-bold text-white">{proj.sheet_height} × {proj.sheet_width} cm</span></div>
                      <div className="p-2 rounded-lg bg-studio-canvas"><span className="text-[10px] text-slate-500 block">Pièces</span><span className="font-bold text-brand-400">{pieceCount} pcs</span></div>
                      <div className="p-2 rounded-lg bg-studio-canvas"><span className="text-[10px] text-slate-500 block">Chute</span><span className="font-bold text-emerald-400">{wasteRate > 0 ? `${wasteRate}%` : '—'}</span></div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-[11px] font-mono font-bold text-slate-400">{sheetsUsed} feuille(s)</span>
                    <button onClick={() => handleLoadProject(proj)} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-brand-500 hover:bg-brand-400 text-slate-950 font-black text-xs transition-all group-hover:shadow-lg group-hover:shadow-brand-500/20">Ouvrir<ArrowRight className="w-3.5 h-3.5" /></button>
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