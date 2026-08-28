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
} from 'lucide-react';

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
  cut_results?: Array<{
    id: string;
    sheets_used: number;
    waste_percentage: number;
    total_area_used: number;
    layout_data: unknown;
    created_at: string;
  }>;
}

export default function HistoryPage() {
  const [projects, setProjects] = useState<ProjectHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userCredits, setUserCredits] = useState<number>(5);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserEmail(user.email || null);
        const { data: profile } = await supabase
          .from('profiles')
          .select('credits')
          .eq('id', user.id)
          .single();
        if (profile) setUserCredits(profile.credits);

        const res = await fetch('/api/projects');
        const data = await res.json();
        if (data.success && Array.isArray(data.projects)) {
          setProjects(data.projects);
        }
      }
    } catch (err) {
      console.error('Erreur chargement historique:', err);
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
    <div className="min-h-screen bg-[#0F172A] text-[#F1F5F9] font-sans antialiased selection:bg-amber-500 selection:text-black pb-16">
      
      {/* Top Navbar */}
      <header className="sticky top-0 z-40 bg-[#0F172A]/90 backdrop-blur-md border-b border-[#334155]/60 px-4 sm:px-8 py-3.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#1E293B] hover:bg-[#283548] text-slate-300 text-xs font-bold border border-[#334155] transition-all"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Nouveau Débit</span>
            </Link>

            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-amber-400" />
              <h1 className="font-extrabold text-base text-white tracking-tight">Historique de Débitage</h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/credits"
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#1E293B] hover:bg-[#283548] border border-[#334155] transition-all"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
              <span className="text-xs font-bold text-white font-mono">{userCredits}</span>
              <span className="text-[11px] text-[#94A3B8] hidden sm:inline">crédits IA</span>
            </Link>

            {userEmail ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#1E293B] border border-[#334155]">
                <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
                <span className="text-xs text-slate-200 font-medium truncate max-w-[120px]">{userEmail}</span>
              </div>
            ) : (
              <Link
                href="/auth/login"
                className="px-4 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs transition-colors"
              >
                Connexion
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-4 sm:px-8 mt-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              Vos Projets & Débits Sauvegardés
            </h2>
            <p className="text-xs text-[#94A3B8] mt-1">
              Retrouvez, modifiez et téléchargez les plans de coupe de tous vos projets passés.
            </p>
          </div>

          <button
            onClick={fetchHistory}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1E293B] hover:bg-[#283548] text-slate-300 text-xs font-semibold border border-[#334155] transition-all cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualiser</span>
          </button>
        </div>

        {loading ? (
          <div className="p-16 rounded-3xl bg-[#1E293B]/50 border border-[#334155] text-center flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-8 h-8 text-amber-400 animate-spin" />
            <p className="text-sm font-bold text-white">Chargement de votre historique...</p>
          </div>
        ) : !userEmail ? (
          <div className="p-12 rounded-3xl bg-[#1E293B]/60 border border-[#334155] text-center space-y-4">
            <Layers className="w-12 h-12 text-[#64748B] mx-auto" />
            <h3 className="text-base font-bold text-white">Connectez-vous pour voir votre historique</h3>
            <p className="text-xs text-[#94A3B8] max-w-sm mx-auto">
              Vos projets de découpe sont automatiquement sauvegardés et synchronisés sur votre compte artisan.
            </p>
            <Link
              href="/auth/login?redirect=/history"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20"
            >
              <span>Se connecter / Créer un compte</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        ) : projects.length === 0 ? (
          <div className="p-12 rounded-3xl bg-[#1E293B]/60 border border-[#334155] text-center space-y-4">
            <FolderOpen className="w-12 h-12 text-[#64748B] mx-auto" />
            <h3 className="text-base font-bold text-white">Aucun débit enregistré pour le moment</h3>
            <p className="text-xs text-[#94A3B8] max-w-sm mx-auto">
              Vos prochains plans de coupe générés et exportés apparaîtront automatiquement ici.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20"
            >
              <span>Créer mon premier plan de coupe</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {projects.map((proj) => {
                const optJson = proj.options_json || {};
                const res = optJson.result as { sheetsUsed?: number; wastePercentage?: number } | undefined;
                const pieceCount = optJson.pieces?.reduce((s: number, p: { quantity?: number }) => s + (p.quantity || 1), 0) || 0;
                const wasteRate = res?.wastePercentage !== undefined ? res.wastePercentage : 0;
                const sheetsUsed = res?.sheetsUsed !== undefined ? res.sheetsUsed : 1;

                return (
                  <div
                    key={proj.id}
                    className="p-5 rounded-2xl bg-[#1E293B] border border-[#334155] hover:border-amber-400/50 transition-all shadow-lg flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-mono text-[#94A3B8] flex items-center gap-1">
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

                      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#334155]/60 text-xs font-mono">
                        <div className="p-2 rounded-lg bg-[#0F172A]">
                          <span className="text-[10px] text-[#94A3B8] block">Panneau</span>
                          <span className="font-bold text-white">{proj.sheet_height} × {proj.sheet_width} cm</span>
                        </div>
                        <div className="p-2 rounded-lg bg-[#0F172A]">
                          <span className="text-[10px] text-[#94A3B8] block">Pièces</span>
                          <span className="font-bold text-amber-400">{pieceCount} pcs</span>
                        </div>
                        <div className="p-2 rounded-lg bg-[#0F172A]">
                          <span className="text-[10px] text-[#94A3B8] block">Chute</span>
                          <span className="font-bold text-emerald-400">
                            {wasteRate > 0 ? `${wasteRate}%` : 'Optimal'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2">
                      <span className="text-[11px] font-mono font-bold text-slate-300">
                        {sheetsUsed} feuille(s) requise(s)
                      </span>

                      <button
                        onClick={() => handleLoadProject(proj)}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs transition-all shadow-md cursor-pointer"
                      >
                        <span>Ouvrir le projet</span>
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
