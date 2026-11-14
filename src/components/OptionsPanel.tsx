'use client';

import React from 'react';
import {
  OptimizationOptions,
  OPTIMIZATION_PRIORITY_VALUES,
  MAX_EDGE_MARGIN_MM,
  EDGEBANDING_PRESETS,
} from '@/lib/cutting/binpacking';
import type { LaborPricing } from '@/lib/costing';
import { Frame, Gauge, Layers3, Lock, ScanLine, Scissors, Coins } from 'lucide-react';
import { Tooltip } from '@/components/Tooltip';
import { useLocale } from '@/components/LocaleProvider';
import {
  LABOR_PRICING_MODE_KEYS,
  OPTIMIZATION_PRIORITY_LABEL_KEYS,
} from '@/i18n/domain';

interface OptionsPanelProps {
  options: OptimizationOptions;
  onChange: (newOptions: OptimizationOptions) => void;
  disabled?: boolean;
  /** Margin kept clear along every edge of the panel, in mm. */
  edgeMarginMm?: number;
  onEdgeMarginChange?: (marginMm: number) => void;
  /** The artisan's price per metre of edge banding, every colour; null: catalog prices. */
  edgePrice?: number | null;
  /** A price typed (null: back to the catalog prices). */
  onEdgePriceChange?: (price: number | null) => void;
  /** The last price could not be saved in the account. */
  edgePriceSaveFailed?: boolean;
}

/** '' resets, '8', '8,5' or '8.5' set, anything else is ignored. */
function parseEdgePrice(raw: string): number | null | undefined {
  const text = raw.trim().replace(',', '.');
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 && value <= 1_000_000 ? Math.round(value * 100) / 100 : undefined;
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
        className={`w-full flex items-start gap-3 p-3 rounded-xl text-start transition-all border ${
          checked ? 'bg-brand-400/10 border-brand-500/30' : 'bg-studio-panel/40 border-studio-border/60 hover:border-studio-border-hover/60'
        } disabled:opacity-50 cursor-pointer`}
      >
        <span className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${checked ? 'bg-brand-500/15 text-brand-400' : 'bg-studio-field text-slate-500'}`}>
          <Icon className="w-3.5 h-3.5" />
        </span>
        <span className="flex-1 min-w-0">
          <span className={`block text-[11px] font-semibold ${checked ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-300'}`}>{label}</span>
          <span className="block text-[10px] text-slate-500 mt-0.5 leading-tight">{description}</span>
        </span>
        {/* The knob track is a control, not text: it keeps its physical
            left-to-right travel so the "on" position stays on the same side. */}
        <span dir="ltr" className={`shrink-0 relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${checked ? 'bg-brand-400' : 'bg-studio-border'}`}>
          <span className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200" style={{ transform: checked ? 'translateX(18px)' : 'translateX(4px)' }} />
        </span>
      </button>
    </Tooltip>
  );
}

// Compact pricing controls default to today's behavior when a caller never
// touches them: fixed MAD 0 labor — see OPTIONS_DEFAULTS/DEFAULT_LABOR_PRICING
// in src/lib/cutting/binpacking.ts, which this UI must never drift from. The
// panel price is set on the stock panel itself (atelier), not here.
const DEFAULT_LABOR_PRICING: LaborPricing = { mode: 'fixed', value: 0 };

export const OptionsPanel: React.FC<OptionsPanelProps> = ({
  options,
  onChange,
  disabled = false,
  edgeMarginMm = 0,
  onEdgeMarginChange,
  edgePrice = null,
  onEdgePriceChange,
  edgePriceSaveFailed = false,
}) => {
  const { t } = useLocale();
  const updateField = <K extends keyof OptimizationOptions>(field: K, value: OptimizationOptions[K]) => {
    onChange({ ...options, [field]: value });
  };
  const kerfPercent = ((options.kerfWidth || 0) / 10) * 100;
  const marginPercent = Math.min(100, (edgeMarginMm / MAX_EDGE_MARGIN_MM) * 100);

  const laborPricing: LaborPricing = options.laborPricing ?? DEFAULT_LABOR_PRICING;
  const updateLaborPricing = (next: LaborPricing) => updateField('laborPricing', next);
  // Catalog prices per metre still differ by colour; the hint shows their range.
  const catalogEdgePrices = EDGEBANDING_PRESETS.filter((e) => e.id !== 'none').map((e) => e.pricePerM);
  const catalogEdgeRange = `${Math.min(...catalogEdgePrices)}–${Math.max(...catalogEdgePrices)}`;

  return (
    <div className="space-y-5 text-xs">
      <Tooltip text={t('options.kerf.tooltip')}>
        <div className="p-4 rounded-xl bg-studio-panel/50 border border-studio-border/70">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-brand-400/10 border border-brand-500/20 flex items-center justify-center">
                <Scissors className="w-3.5 h-3.5 text-brand-400" />
              </span>
              <div><span className="block text-[11px] font-semibold text-slate-900 dark:text-white">{t('options.kerf.title')}</span>
                <span className="block text-[10px] text-slate-500">{t('options.kerf.desc')}</span></div>
            </div>
            {/* The kerf figure and its SI unit read left-to-right in every locale. */}
            <span dir="ltr" className="shrink-0 px-2 py-1 rounded-lg bg-studio-field border border-studio-border font-mono font-bold text-sm text-brand-400 tabular-nums">{options.kerfWidth}<span className="text-[9px] text-slate-500 ms-0.5">{t('options.kerf.unit')}</span></span>
          </div>
          <input type="range" dir="ltr" min="0" max="10" step="0.5" disabled={disabled}
            value={options.kerfWidth}
            aria-label={t('options.kerf.aria')}
            onChange={(e) => updateField('kerfWidth', parseFloat(e.target.value) || 0)}
            className="w-full appearance-none h-1.5 rounded-full bg-studio-border cursor-pointer disabled:opacity-50"
            style={{ background: `linear-gradient(to right, #F5A623 ${kerfPercent}%, #1A2744 ${kerfPercent}%)` }} />
          <div dir="ltr" className="flex justify-between mt-1.5 text-[9px] font-mono text-slate-600"><span>0</span><span>5</span><span>{t('options.kerf.scaleMax')}</span></div>
        </div>
      </Tooltip>
      {onEdgeMarginChange && (
        <Tooltip text={t('options.margin.tooltip')}>
          <div className="p-4 rounded-xl bg-studio-panel/50 border border-studio-border/70">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-brand-400/10 border border-brand-500/20 flex items-center justify-center">
                  <Frame className="w-3.5 h-3.5 text-brand-400" />
                </span>
                <div><span className="block text-[11px] font-semibold text-slate-900 dark:text-white">{t('options.margin.title')}</span>
                  <span className="block text-[10px] text-slate-500">{t('options.margin.desc')}</span></div>
              </div>
              {/* Like the kerf, the figure and its SI unit read left-to-right in every locale. */}
              <span dir="ltr" className="shrink-0 px-2 py-1 rounded-lg bg-studio-field border border-studio-border font-mono font-bold text-sm text-brand-400 tabular-nums">{edgeMarginMm}<span className="text-[9px] text-slate-500 ms-0.5">{t('options.kerf.unit')}</span></span>
            </div>
            <input type="range" dir="ltr" min="0" max={MAX_EDGE_MARGIN_MM} step="1" disabled={disabled}
              value={Math.min(edgeMarginMm, MAX_EDGE_MARGIN_MM)}
              aria-label={t('options.margin.aria')}
              onChange={(e) => onEdgeMarginChange(parseFloat(e.target.value) || 0)}
              className="w-full appearance-none h-1.5 rounded-full bg-studio-border cursor-pointer disabled:opacity-50"
              style={{ background: `linear-gradient(to right, #F5A623 ${marginPercent}%, #1A2744 ${marginPercent}%)` }} />
            <div dir="ltr" className="flex justify-between mt-1.5 text-[9px] font-mono text-slate-600"><span>0</span><span>{MAX_EDGE_MARGIN_MM / 2}</span><span>{MAX_EDGE_MARGIN_MM} {t('options.kerf.unit')}</span></div>
          </div>
        </Tooltip>
      )}
      <Tooltip text={t('options.priority.tooltip')}>
        <div className="flex items-center gap-3">
          <span className="shrink-0 w-7 h-7 rounded-lg bg-brand-400/10 border border-brand-500/20 flex items-center justify-center"><Gauge className="w-3.5 h-3.5 text-brand-400" /></span>
          <select disabled={disabled} value={options.optimizationPriority}
            aria-label={t('options.priority.aria')}
            onChange={(e) => updateField('optimizationPriority', e.target.value as OptimizationOptions['optimizationPriority'])}
            style={{ colorScheme: 'light dark' }}
            className="flex-1 px-3 py-2 rounded-xl bg-studio-field border border-studio-border text-slate-700 dark:text-slate-200 text-xs outline-none focus:border-brand-500/50 disabled:opacity-50 [&>option]:bg-white [&>option]:text-slate-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100">
            {/* The option values are the stable optimizer goals; only their labels are localized. */}
            {OPTIMIZATION_PRIORITY_VALUES.map((value) => (
              <option key={value} value={value}>{t(OPTIMIZATION_PRIORITY_LABEL_KEYS[value])}</option>
            ))}
          </select>
        </div>
      </Tooltip>
      <Switch checked={options.showLabels} onChange={(v) => updateField('showLabels', v)} disabled={disabled}
        label={t('options.labels.label')} description={t('options.labels.desc')}
        icon={ScanLine}
        tooltip={t('options.labels.tooltip')} />
      <Switch checked={options.singleSheetOnly} onChange={(v) => updateField('singleSheetOnly', v)} disabled={disabled}
        label={t('options.singleSheet.label')} description={t('options.singleSheet.desc')}
        icon={Layers3}
        tooltip={t('options.singleSheet.tooltip')} />
      <Switch checked={options.considerMaterial} onChange={(v) => updateField('considerMaterial', v)} disabled={disabled}
        label={t('options.multiMaterial.label')} description={t('options.multiMaterial.desc')}
        icon={Layers3}
        tooltip={t('options.multiMaterial.tooltip')} />
      <Switch checked={options.grainDirection} onChange={(v) => updateField('grainDirection', v)} disabled={disabled}
        label={t('options.grain.label')} description={t('options.grain.desc')}
        icon={Lock}
        tooltip={t('options.grain.tooltip')} />

      <Tooltip text={t('options.pricing.tooltip')}>
        <div className="p-4 rounded-xl bg-studio-panel/50 border border-studio-border/70 space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-brand-400/10 border border-brand-500/20 flex items-center justify-center">
              <Coins className="w-3.5 h-3.5 text-brand-400" />
            </span>
            <span className="block text-[11px] font-semibold text-slate-900 dark:text-white">{t('options.pricing.title')}</span>
          </div>

          <div className="space-y-1.5">
            <span className="block text-[10px] text-slate-500">{t('options.pricing.laborLabel')}</span>
            <div className="flex gap-1.5">
              {/* The pricing-mode values feed src/lib/costing.ts verbatim; only the labels change. */}
              <select disabled={disabled} value={laborPricing.mode}
                aria-label={t('options.pricing.laborModeAria')}
                onChange={(e) => updateLaborPricing({ mode: e.target.value as LaborPricing['mode'], value: laborPricing.value })}
                style={{ colorScheme: 'light dark' }}
                className="px-2 py-1.5 rounded-lg bg-studio-field border border-studio-border text-slate-700 dark:text-slate-200 text-[11px] outline-none disabled:opacity-50 [&>option]:bg-white [&>option]:text-slate-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100">
                <option value="fixed">{t(LABOR_PRICING_MODE_KEYS.fixed)}</option>
                <option value="per_meter">{t(LABOR_PRICING_MODE_KEYS.per_meter)}</option>
              </select>
              <input type="number" min={0} step="0.5" disabled={disabled} value={laborPricing.value}
                dir="ltr"
                aria-label={t('options.pricing.laborValueAria')}
                onChange={(e) => updateLaborPricing({ mode: laborPricing.mode, value: Math.max(0, parseFloat(e.target.value) || 0) })}
                className="w-20 px-2 py-1.5 rounded-lg bg-studio-field border border-studio-border text-slate-200 text-[11px] outline-none disabled:opacity-50" />
            </div>
          </div>

          {onEdgePriceChange && (
            <div data-testid="edge-price" className="space-y-1.5">
              <label htmlFor="edge-price-input" className="block text-[10px] text-slate-500">{t('options.pricing.edgeLabel')}</label>
              <input
                id="edge-price-input"
                key={edgePrice ?? 'catalog'}
                type="text"
                inputMode="decimal"
                dir="ltr"
                disabled={disabled}
                defaultValue={edgePrice === null ? '' : String(edgePrice)}
                placeholder={t('options.pricing.edgePlaceholder', { range: catalogEdgeRange })}
                onBlur={(e) => {
                  const price = parseEdgePrice(e.target.value);
                  if (price === undefined) {
                    e.target.value = edgePrice === null ? '' : String(edgePrice);
                    return;
                  }
                  if (price !== edgePrice) onEdgePriceChange(price);
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                className="w-full px-2 py-1.5 rounded-lg bg-studio-field border border-studio-border text-slate-800 dark:text-slate-200 text-[11px] font-mono outline-none focus:border-brand-500/50 disabled:opacity-50"
              />
              {edgePriceSaveFailed && (
                <p role="alert" className="text-[10px] font-semibold text-amber-600 dark:text-amber-300">{t('options.pricing.edgeSaveFailed')}</p>
              )}
            </div>
          )}
        </div>
      </Tooltip>
    </div>
  );
};