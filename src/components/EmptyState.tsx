'use client';

import React from 'react';
import { Camera, Scissors, FileText } from 'lucide-react';

interface EmptyStateProps {
  type: 'ready' | 'loading' | 'no-results';
}

export function EmptyState({ type }: EmptyStateProps) {
  if (type === 'loading') {
    return (
      <div className="p-16 rounded-3xl bg-studio-panel/30 border border-dashed border-studio-border/80 text-center flex flex-col items-center gap-6 min-h-[460px] justify-center">
        <div className="relative w-16 h-16 rounded-2xl bg-studio-field border border-studio-border flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
        </div>
        <div className="space-y-2">
          <div className="h-4 w-48 bg-studio-field rounded animate-pulse mx-auto" />
          <div className="h-3 w-32 bg-studio-field rounded animate-pulse mx-auto" />
        </div>
      </div>
    );
  }

  if (type === 'no-results') {
    return (
      <div className="p-16 rounded-3xl bg-studio-panel/30 border border-dashed border-studio-border/80 text-center flex flex-col items-center gap-4 min-h-[460px] justify-center">
        <div className="w-16 h-16 rounded-2xl bg-studio-field border border-studio-border flex items-center justify-center">
          <Scissors className="w-7 h-7 text-slate-600" />
        </div>
        <div>
          <h3 className="text-base font-black text-slate-300 mb-1">Aucun résultat</h3>
          <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
            Aucun projet ne correspond à cette recherche. Essayez un autre filtre.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-12 sm:p-16 rounded-3xl bg-studio-panel/30 border border-dashed border-studio-border/80 text-center flex flex-col items-center gap-5 min-h-[460px] justify-center">
      <div className="w-16 h-16 rounded-2xl bg-studio-field border border-studio-border flex items-center justify-center">
        <Scissors className="w-7 h-7 text-slate-600" />
      </div>
      <div className="space-y-2">
        <h3 className="text-base font-black text-slate-300">Prêt pour le calepinage</h3>
        <p className="text-xs text-slate-500 max-w-sm leading-relaxed">
          Ajoutez vos pièces et lancez l&apos;optimisation pour visualiser le plan de coupe 2D.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-studio-panel/60 border border-studio-border text-left min-w-[200px]">
          <span className="shrink-0 w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
            <Camera className="w-4 h-4 text-sky-400" />
          </span>
          <div>
            <p className="text-[10px] font-bold text-white">1. Photo</p>
            <p className="text-[9px] text-slate-500">Scannez une fiche</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-studio-panel/60 border border-studio-border text-left min-w-[200px]">
          <span className="shrink-0 w-8 h-8 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center">
            <Scissors className="w-4 h-4 text-brand-400" />
          </span>
          <div>
            <p className="text-[10px] font-bold text-white">2. Pièces</p>
            <p className="text-[9px] text-slate-500">Ajoutez les dimensions</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-studio-panel/60 border border-studio-border text-left min-w-[200px]">
          <span className="shrink-0 w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <FileText className="w-4 h-4 text-emerald-400" />
          </span>
          <div>
            <p className="text-[10px] font-bold text-white">3. Optimiser</p>
            <p className="text-[9px] text-slate-500">Générez le plan</p>
          </div>
        </div>
      </div>
    </div>
  );
}