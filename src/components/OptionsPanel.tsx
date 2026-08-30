'use client';

import React from 'react';
import { OptimizationOptions, OptimizationPriority, OPTIMIZATION_PRIORITY_VALUES } from '@/lib/cutting/binpacking';
import { Gauge, Layers3, Lock, ScanLine, Scissors } from 'lucide-react';
import { Tooltip } from '@/components/Tooltip';

interface OptionsPanelProps {
  options: OptimizationOptions;
  onChange: (newOptions: OptimizationOptions) => void;
  disabled?: boolean;
}

function Switch({
  checked, onChange, disabled,
  label, description, icon: Icon, tooltip,
}: {
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
  label: string; description: string;
  icon: React.ComponentType<{ className?: string }>;
  tooltip: string;
}) {
  return (
    <Tooltip text={tooltip}>
      <button
        type="button" disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`w-full flex items-start gap-3 p-3 rounded-xl text-left transition-all border ${
          checked ? 'bg-brand-500/10 border-brand-500/30' : 'bg-studio-panel/40 border-studio-border/60 hover:border-studio-border-hover/60'
        } disabled:opacity-50 cursor-pointer`}
      >
        <span className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${checked ? 'bg-brand-500/15 text-brand-400' : 'bg-studio-field text-slate-500'}`}>
          <Icon className="w-3.5 h-3.5" />
        </span>
        <span className="flex-1 min-w-0">
          <span className={`block text-[11px] font-semibold ${checked ? 'text-white' : 'text-slate-300'}`}>{label}</span>
          <span className="block text-[10px] text-slate-500 mt-0.5 leading-tight">{description}</span>
        </span>
        <span className={`shrink-0 relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${checked ? 'bg-brand-500' : 'bg-studio-border'}`}>
          <span className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200" style={{ transform: checked ? 'translateX(18px)' : 'translateX(4px)' }} />
        </span>
      </button>
    </Tooltip>
  );
}

// Exhaustive over `OptimizationPriority`: TypeScript rejects this object if a
// value is missing or an extra key is added, keeping the rendered <select>
// permanently in sync with the values the optimizer/API schema support.
const PRIORITY_LABELS: Record<OptimizationPriority, string> = {
  linear_guillotine: 'Coupe linéaire traversante (atelier)',
  min_waste: 'Minimiser les chutes (%)',
  min_sheets: 'Minimiser les panneaux',
  balanced: 'Équilibré (facilité de coupe)',
};

export const OptionsPanel: React.FC<OptionsPanelProps> = ({ options, onChange, disabled = false }) => {
  const updateField = <K extends keyof OptimizationOptions>(field: K, value: OptimizationOptions[K]) => {
    onChange({ ...options, [field]: value });
  };
  const kerfPercent = ((options.kerfWidth || 0) / 10) * 100;

  return (
    <div className="space-y-5 text-xs">
      <Tooltip text="Épaisseur de matière retirée par le trait de scie entre chaque coupe. Standard : 3 mm pour lame carbure.">
        <div className="p-4 rounded-xl bg-studio-panel/50 border border-studio-border/70">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center">
                <Scissors className="w-3.5 h-3.5 text-brand-400" />
              </span>
              <div><span className="block text-[11px] font-semibold text-white">Épaisseur de lame (Kerf)</span>
                <span className="block text-[10px] text-slate-500">Trait de scie retiré entre chaque coupe</span></div>
            </div>
            <span className="shrink-0 px-2 py-1 rounded-lg bg-studio-field border border-studio-border font-mono font-bold text-sm text-brand-400 tabular-nums">{options.kerfWidth}<span className="text-[9px] text-slate-500 ml-0.5">mm</span></span>
          </div>
          <input type="range" min="0" max="10" step="0.5" disabled={disabled}
            value={options.kerfWidth}
            onChange={(e) => updateField('kerfWidth', parseFloat(e.target.value) || 0)}
            className="w-full appearance-none h-1.5 rounded-full bg-studio-border cursor-pointer disabled:opacity-50"
            style={{ background: `linear-gradient(to right, #F5A623 ${kerfPercent}%, #1A2744 ${kerfPercent}%)` }} />
          <div className="flex justify-between mt-1.5 text-[9px] font-mono text-slate-600"><span>0</span><span>5</span><span>10 mm</span></div>
        </div>
      </Tooltip>
      <Tooltip text="Algorithme de placement : Guillotine = coupes droites traversantes (standard atelier). Min chutes = meilleur rendement surface.">
        <div className="flex items-center gap-3">
          <span className="shrink-0 w-7 h-7 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center"><Gauge className="w-3.5 h-3.5 text-brand-400" /></span>
          <select disabled={disabled} value={options.optimizationPriority}
            onChange={(e) => updateField('optimizationPriority', e.target.value as OptimizationOptions['optimizationPriority'])}
            className="flex-1 px-3 py-2 rounded-xl bg-studio-field border border-studio-border text-slate-200 text-xs outline-none focus:border-brand-500/50 disabled:opacity-50">
            {OPTIMIZATION_PRIORITY_VALUES.map((value) => (
              <option key={value} value={value}>{PRIORITY_LABELS[value]}</option>
            ))}
          </select>
        </div>
      </Tooltip>
      <Switch checked={options.showLabels} onChange={(v) => updateField('showLabels', v)} disabled={disabled}
        label="Étiquettes sur les pièces" description="N° et dimensions visibles sur le plan"
        icon={ScanLine}
        tooltip="Affiche le numéro et les dimensions (H×L) au centre de chaque pièce sur le schéma de coupe." />
      <Switch checked={options.singleSheetOnly} onChange={(v) => updateField('singleSheetOnly', v)} disabled={disabled}
        label="Mode 1 feuille unique" description="Limite stricte, alerte si des pièces restent"
        icon={Layers3}
        tooltip="Force l'optimisation sur un seul panneau. Utile si vous n'avez qu'une chute à optimiser." />
      <Switch checked={options.considerMaterial} onChange={(v) => updateField('considerMaterial', v)} disabled={disabled}
        label="Répartition multi-matériaux" description="Isole MDF, aluminium et verre"
        icon={Layers3}
        tooltip="Sépare les pièces par matériau. Chaque matériau est optimisé sur ses propres panneaux." />
      <Switch checked={options.grainDirection} onChange={(v) => updateField('grainDirection', v)} disabled={disabled}
        label="Verrouiller le sens du fil" description="Interdit la rotation 90° des pièces"
        icon={Lock}
        tooltip="Empêche la rotation des pièces. À activer pour le bois massif ou le stratifié avec sens de veinage." />
    </div>
  );
};