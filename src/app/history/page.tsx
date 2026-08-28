'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  History,
  Layers,
  Calendar,
  ArrowRight,
  FolderOpen,
  Zap,
  ArrowLeft,
  RefreshCw,
  CloudOff,
} from 'lucide-react';
import { readLocalHistory, type LocalHistoryItem } from '@/lib/history';
import { AccountMenu } from '@/components/AccountMenu';

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
    id: p.id,
    name: p.name,
    material: p.material,
    sheet_width: p.sheet_width,
    sheet_height: p.sheet_height,
    kerf: p.kerf,
    grain_direction: p.grain_direction,
    status: p.status,
    created_at: p.created_at,
    options_json: p.options_json as ProjectHistoryItem['options_json'],
  }));

  const seen = new Set<string>();
  const out: ProjectHistoryItem[] = [];
  for (const item of [...cloud, ...mappedLocal]) {
    const key = `${item.name}|${item.created_at.slice(0, 16)}`;
    if (seen.has(item.id) || seen.has(key)) continue;
    seen.add(item.id);
    seen.add(key);
    out.push(item);
  }
  return out.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
}

export default function HistoryPage() {
  const [projects, setProjects] = useState<ProjectHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userCredits, setUserCredits] = useState<number>(5);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const fetchHistory = async () => {
    setLoading(true);
    setSyncNote(null);
    const local = readLocalHistory();
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        setUserEmail(user.email || null);
        const { data: profile } = await supabase.from('profiles').select('credits').eq('id', user.id).single();
        if (profile) setUserCredits(profile.credits);

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
          setSyncNote(
            missingTable
              ? 'Historique cloud pas encore activé — vos débits de cet appareil s’affichent ci-dessous.'
              : 'Historique cloud indisponible — affichage local.'
          );
        }
      } else {
        setUserEmail(null);
        setProjects(mergeHistory([], local));
      }
    } catch (err) {
      console.error('Erreur chargement historique:', err);
      setProjects(mergeHistory([], local));
      setSyncNote('Impossible de joindre le serveur — historique local affiché.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const handleLoadProject = (project: ProjectHistoryItem) => {
    if (project.options_json) {
      sessionStorage.setItem('qatlia_saved_project', JSON.stringify(project.options_json));
      window.location.href = '/';
    }
  };

  const getMaterialBadge = (mat?: string) => {
    switch (mat?.toLowerCase()) {
      case 'aluminium':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-500/20 text-slate-300 border border-slate-500/30">Aluminium</span>;
      case 'verre':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">Verre</span>;
      case 'contreplaques':
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-600/20 text-amber-300 border border-amber-600/30">Contreplaqué</span>;
      default:
        return <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">MDF</span>;
    }
  };

  return (
    <div className="min-h-screen bg-[#070C18] text-slate-100 font-sans antialiased selection:bg-amber-500 selection:text-black pb-16">
      <header className="sticky top-0 z-40 bg-[#070C18]/90 backdrop-blur-xl border-b border-slate-800/80 px-4 sm:px-8 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-800 transition-all"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Atelier</span>
            </Link>
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-amber-400" />
              <h1 className="font-extrabold text-base text-white tracking-tight">Historique</h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Link
              href="/credits"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold"
            >
              <Zap className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
              <span className="font-mono font-bold">{userCredits}</span>
            </Link>
            {userEmail ? (
              <AccountMenu email={userEmail} />
            ) : (
              <Link href="/auth/login?redirect=/history" className="px-3.5 py-1.5 rounded-xl bg-white text-slate-950 font-bold text-xs">
                Connexion
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-8 mt-8 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-400/80">Atelier</p>
            <h2 className="text-2xl font-black text-white mt-1">Vos débits</h2>
            <p className="text-sm text-slate-400 mt-1">Rouvrir un plan, relancer le calepinage ou réexporter le PDF.</p>
          </div>
          <button
            onClick={fetchHistory}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-semibold border border-slate-800"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
        </div>

        {syncNote && (
          <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs">
            <CloudOff className="w-4 h-4 shrink-0" />
            {syncNote}
          </div>
        )}

        {loading ? (
          <div className="p-16 rounded-3xl bg-slate-900/50 border border-slate-800 text-center">
            <RefreshCw className="w-8 h-8 text-amber-400 animate-spin mx-auto" />
            <p className="text-sm font-bold text-white mt-3">Chargement de l&apos;historique…</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="p-12 rounded-3xl bg-slate-900/60 border border-slate-800 text-center space-y-4">
            {userEmail ? <FolderOpen className="w-12 h-12 text-slate-600 mx-auto" /> : <Layers className="w-12 h-12 text-slate-600 mx-auto" />}
            <h3 className="text-base font-bold text-white">
              {userEmail ? 'Aucun débit enregistré' : 'Connectez-vous pour synchroniser vos débits'}
            </h3>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              {userEmail
                ? 'Générez un plan de coupe : il s’enregistre automatiquement ici, y compris après un export PDF.'
                : 'Les plans calculés sur cet appareil restent visibles. La connexion Google / email les synchronise sur votre compte.'}
            </p>
            <Link
              href={userEmail ? '/' : '/auth/login?redirect=/history'}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider"
            >
              {userEmail ? 'Créer un plan de coupe' : 'Se connecter'}
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {projects.map((proj) => {
              const optJson = proj.options_json || {};
              const res = optJson.result;
              const pieceCount = optJson.pieces?.reduce((s, p) => s + (p.quantity || 1), 0) || 0;
              const wasteRate = res?.wastePercentage ?? 0;
              const sheetsUsed = res?.sheetsUsed ?? 1;

              return (
                <div
                  key={proj.id}
                  className="p-5 rounded-2xl bg-slate-900/70 border border-slate-800 hover:border-amber-400/40 transition-all flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {new Date(proj.created_at).toLocaleDateString('fr-FR', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {getMaterialBadge(proj.material)}
                    </div>
                    <h3 className="text-base font-black text-white truncate">{proj.name}</h3>
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800 text-xs font-mono">
                      <div className="p-2 rounded-lg bg-[#070C18]">
                        <span className="text-[10px] text-slate-500 block">Panneau</span>
                        <span className="font-bold text-white">
                          {proj.sheet_height} × {proj.sheet_width} cm
                        </span>
                      </div>
                      <div className="p-2 rounded-lg bg-[#070C18]">
                        <span className="text-[10px] text-slate-500 block">Pièces</span>
                        <span className="font-bold text-amber-400">{pieceCount} pcs</span>
                      </div>
                      <div className="p-2 rounded-lg bg-[#070C18]">
                        <span className="text-[10px] text-slate-500 block">Chute</span>
                        <span className="font-bold text-emerald-400">{wasteRate > 0 ? `${wasteRate}%` : '—'}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="text-[11px] font-mono font-bold text-slate-400">{sheetsUsed} feuille(s)</span>
                    <button
                      onClick={() => handleLoadProject(proj)}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs"
                    >
                      Ouvrir
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
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
