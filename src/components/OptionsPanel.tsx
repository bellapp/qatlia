'use client';

import React, { useState } from 'react';
import { OptimizationOptions } from '@/lib/cutting/binpacking';
import { Settings, ChevronDown, ChevronUp } from 'lucide-react';

interface OptionsPanelProps {
  options: OptimizationOptions;
  onChange: (options: OptimizationOptions) => void;
  disabled?: boolean;
}

export const OptionsPanel: React.FC<OptionsPanelProps> = ({
  options,
  onChange,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(true);

  const updateField = <K extends keyof OptimizationOptions>(key: K, value: OptimizationOptions[K]) => {
    onChange({
      ...options,
      [key]: value,
    });
  };

  const handleKerfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = parseFloat(e.target.value);
    const clamped = isNaN(raw) ? 0 : Math.max(0, Math.min(10, raw));
    updateField('kerfWidth', clamped);
  };

  return (
    <div className="rounded-2xl bg-[#1E293B] border border-[#334155] shadow-lg overflow-hidden transition-all">
      {/* Header Collapsible */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-5 py-4 flex items-center justify-between bg-[#1E293B] hover:bg-[#283548] transition-colors text-left"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-[#F5A623]">
            <Settings className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              Panneau d&apos;Options Avancées
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
                F10-F12
              </span>
            </h3>
            <p className="text-xs text-[#94A3B8]">Kerf, mode 1 feuille, groupement matériaux & priorités</p>
          </div>
        </div>
        <div className="text-[#94A3B8]">
          {isOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
      </button>

      {/* Content Form */}
      {isOpen && (
        <div className="p-5 pt-2 border-t border-[#334155] space-y-4 text-xs">
          {/* 1. Largeur de coupe / Kerf (F10) */}
          <div className="flex items-center justify-between py-1.5">
            <div>
              <label htmlFor="kerfInput" className="font-semibold text-white flex items-center gap-1.5 cursor-pointer">
                Largeur de coupe / lame (Kerf)
              </label>
              <p className="text-[11px] text-[#94A3B8]">Épaisseur de matière retirée par le trait de scie</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="kerfInput"
                type="number"
                min="0"
                max="10"
                step="0.5"
                disabled={disabled}
                value={options.kerfWidth}
                onChange={handleKerfChange}
                className="w-20 px-2.5 py-1.5 rounded-lg bg-[#0F172A] border border-[#475569] focus:border-amber-400 text-right font-mono font-bold text-white outline-none disabled:opacity-50"
              />
              <span className="text-xs font-bold text-amber-400">mm</span>
            </div>
          </div>

          <hr className="border-[#334155]" />

          {/* 2. Étiquettes sur les panneaux */}
          <div className="flex items-center justify-between py-1">
            <div>
              <span className="font-semibold text-white">Étiquette sur les panneaux</span>
              <p className="text-[11px] text-[#94A3B8]">Affiche les numéros et dimensions sur chaque pièce</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                disabled={disabled}
                checked={options.showLabels}
                onChange={(e) => updateField('showLabels', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-[#334155] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#F5A623]"></div>
            </label>
          </div>

          {/* 3. N'utiliser qu'un panneau (F11 - Mode 1 feuille) */}
          <div className="flex items-center justify-between py-1">
            <div>
              <span className="font-semibold text-white flex items-center gap-1.5">
                N&apos;utiliser qu&apos;un panneau du stock
                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300">Mode 1 Feuille</span>
              </span>
              <p className="text-[11px] text-[#94A3B8]">Limite stricte à 1 panneau, alerte sur les pièces restantes</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                disabled={disabled}
                checked={options.singleSheetOnly}
                onChange={(e) => updateField('singleSheetOnly', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-[#334155] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#F5A623]"></div>
            </label>
          </div>

          {/* 4. Tenir compte du matériau (F12 - Groupement Matériaux) */}
          <div className="flex items-center justify-between py-1">
            <div>
              <span className="font-semibold text-white flex items-center gap-1.5">
                Tenir compte du matériau
                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300">Multi-Matériaux</span>
              </span>
              <p className="text-[11px] text-[#94A3B8]">Isole les panneaux MDF, Aluminium et Verre</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                disabled={disabled}
                checked={options.considerMaterial}
                onChange={(e) => updateField('considerMaterial', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-[#334155] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#F5A623]"></div>
            </label>
          </div>

          {/* 5. Chants / Edge Banding */}
          <div className="flex items-center justify-between py-1">
            <div>
              <span className="font-semibold text-white">Chants (Edge Banding)</span>
              <p className="text-[11px] text-[#94A3B8]">Prend en compte la surépaisseur des bandes de chant</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                disabled={disabled}
                checked={options.edgeBanding}
                onChange={(e) => updateField('edgeBanding', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-[#334155] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#F5A623]"></div>
            </label>
          </div>

          {/* 6. Orientation du fil (Grain Direction) */}
          <div className="flex items-center justify-between py-1">
            <div>
              <span className="font-semibold text-white">Tenir compte de l&apos;orientation du fil</span>
              <p className="text-[11px] text-[#94A3B8]">Interdit la rotation 90° pour préserver le veinage</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                disabled={disabled}
                checked={options.grainDirection}
                onChange={(e) => updateField('grainDirection', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-[#334155] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#F5A623]"></div>
            </label>
          </div>

          <hr className="border-[#334155]" />

          {/* 7. Priorité d'optimisation */}
          <div className="flex items-center justify-between py-1">
            <div>
              <label htmlFor="prioSelect" className="font-semibold text-white">Priorité d&apos;optimisation</label>
              <p className="text-[11px] text-[#94A3B8]">Heuristique de découpe préférentielle</p>
            </div>
            <select
              id="prioSelect"
              disabled={disabled}
              value={options.optimizationPriority}
              onChange={(e) => updateField('optimizationPriority', e.target.value as OptimizationOptions['optimizationPriority'])}
              className="px-3 py-1.5 rounded-lg bg-[#0F172A] border border-[#475569] text-white text-xs outline-none focus:border-amber-400 disabled:opacity-50"
            >
              <option value="linear_guillotine">Coupe Linéaire Traversante (Recommandé Atelier)</option>
              <option value="min_waste">Minimiser les chutes (%)</option>
              <option value="min_sheets">Minimiser les panneaux bruts</option>
              <option value="balanced">Équilibré (Facilité de coupe)</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
};
