'use client';

import React from 'react';
import { OptimizationOptions } from '@/lib/cutting/binpacking';

interface OptionsPanelProps {
  options: OptimizationOptions;
  onChange: (newOptions: OptimizationOptions) => void;
  disabled?: boolean;
}

export const OptionsPanel: React.FC<OptionsPanelProps> = ({
  options,
  onChange,
  disabled = false,
}) => {
  const updateField = <K extends keyof OptimizationOptions>(
    field: K,
    value: OptimizationOptions[K]
  ) => {
    onChange({
      ...options,
      [field]: value,
    });
  };

  return (
    <div className="space-y-4 text-xs">
      {/* Kerf & Priorité */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="p-3 rounded-xl bg-studio-panel/60 border border-studio-border/80">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-medium text-slate-300">Trait de scie (Kerf)</span>
            <span className="text-[10px] font-mono font-semibold text-brand-400 bg-brand-400/10 px-1.5 py-0.5 rounded">mm</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="0"
              max="10"
              step="0.5"
              disabled={disabled}
              value={options.kerfWidth}
              onChange={(e) => updateField('kerfWidth', parseFloat(e.target.value) || 0)}
              className="w-full accent-brand-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
            />
            <span className="font-mono font-bold text-slate-100 w-8 text-right text-xs">
              {options.kerfWidth}
            </span>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-studio-panel/60 border border-studio-border/80">
          <span className="text-[11px] font-medium text-slate-300 block mb-1.5">Priorité d&apos;optimisation</span>
          <select
            disabled={disabled}
            value={options.optimizationPriority}
            onChange={(e) => updateField('optimizationPriority', e.target.value as OptimizationOptions['optimizationPriority'])}
            className="w-full px-2.5 py-1.5 rounded-lg bg-studio-field border border-studio-border text-slate-200 text-xs outline-none focus:border-brand-500/50"
          >
            <option value="linear_guillotine">Coupe Linéaire (Atelier)</option>
            <option value="min_waste">Minimiser les chutes (%)</option>
            <option value="min_sheets">Minimiser les panneaux</option>
            <option value="balanced">Équilibré</option>
          </select>
        </div>
      </div>

      {/* Toggles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
        {/* Toggle 1: Étiquettes */}
        <label className="flex items-center justify-between p-2.5 rounded-xl bg-studio-panel/40 border border-studio-border/60 hover:border-studio-border-hover/60 cursor-pointer transition-colors">
          <span className="text-slate-300 text-[11px]">Étiquettes sur les pièces</span>
          <input
            type="checkbox"
            disabled={disabled}
            checked={options.showLabels}
            onChange={(e) => updateField('showLabels', e.target.checked)}
            className="w-4 h-4 rounded text-brand-500 bg-studio-field border-studio-border-hover focus:ring-0 focus:ring-offset-0"
          />
        </label>

        {/* Toggle 2: Mode 1 Feuille */}
        <label className="flex items-center justify-between p-2.5 rounded-xl bg-studio-panel/40 border border-studio-border/60 hover:border-studio-border-hover/60 cursor-pointer transition-colors">
          <div className="flex items-center gap-1">
            <span className="text-slate-300 text-[11px]">Mode 1 Feuille Unique</span>
          </div>
          <input
            type="checkbox"
            disabled={disabled}
            checked={options.singleSheetOnly}
            onChange={(e) => updateField('singleSheetOnly', e.target.checked)}
            className="w-4 h-4 rounded text-brand-500 bg-studio-field border-studio-border-hover focus:ring-0 focus:ring-offset-0"
          />
        </label>

        {/* Toggle 3: Multi-Matériaux */}
        <label className="flex items-center justify-between p-2.5 rounded-xl bg-studio-panel/40 border border-studio-border/60 hover:border-studio-border-hover/60 cursor-pointer transition-colors">
          <span className="text-slate-300 text-[11px]">Répartition Multi-Matériaux</span>
          <input
            type="checkbox"
            disabled={disabled}
            checked={options.considerMaterial}
            onChange={(e) => updateField('considerMaterial', e.target.checked)}
            className="w-4 h-4 rounded text-brand-500 bg-studio-field border-studio-border-hover focus:ring-0 focus:ring-offset-0"
          />
        </label>

        {/* Toggle 4: Sens du fil */}
        <label className="flex items-center justify-between p-2.5 rounded-xl bg-studio-panel/40 border border-studio-border/60 hover:border-studio-border-hover/60 cursor-pointer transition-colors">
          <span className="text-slate-300 text-[11px]">Bloquer le sens du fil</span>
          <input
            type="checkbox"
            disabled={disabled}
            checked={options.grainDirection}
            onChange={(e) => updateField('grainDirection', e.target.checked)}
            className="w-4 h-4 rounded text-brand-500 bg-studio-field border-studio-border-hover focus:ring-0 focus:ring-offset-0"
          />
        </label>
      </div>
    </div>
  );
};
