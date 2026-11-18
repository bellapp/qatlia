'use client';

import { Pencil, Trash2 } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';
import { materialLabelKey } from '@/i18n/domain';
import { isPanelPrice, type PanelPreset } from '@/lib/panel-presets';
import { formatDimensions, type DisplayUnit } from '@/lib/units';

interface PanelRowProps {
  preset: PanelPreset;
  unit: DisplayUnit;
  /** The first click on « Supprimer » was made: the button now asks to confirm. */
  confirmingDelete: boolean;
  /** The list cannot be written now (still loading, or the account out of reach). */
  disabled?: boolean;
  onEdit(): void;
  onDelete(): void;
}

const TAG = 'px-2 py-0.5 rounded-md bg-studio-field border border-studio-border text-[11px] font-semibold text-slate-600 dark:text-slate-300';

/** One panel of the artisan's list: what tells it apart, then edit and delete. */
export function PanelRow({ preset, unit, confirmingDelete, disabled = false, onEdit, onDelete }: PanelRowProps) {
  const { t, n } = useLocale();

  return (
    <article className="flex flex-wrap items-center gap-3 px-4 py-3.5 rounded-xl bg-studio-panel border border-studio-border shadow-sm">
      <div className="flex-1 min-w-0 basis-60 space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
          <h4 dir="auto" className="min-w-0 max-w-full truncate text-sm font-bold text-slate-900 dark:text-white">{preset.name}</h4>
          <span dir="ltr" className="font-mono text-xs font-bold text-slate-600 dark:text-slate-400">
            {formatDimensions(preset.height, preset.width, unit)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={TAG}>{t(materialLabelKey(preset.material))}</span>
          {preset.color ? <span dir="auto" className={TAG}>{preset.color}</span> : null}
          {preset.hasGrain ? (
            <span className={TAG}>{t(preset.grainOrientation === 'horizontal' ? 'atelier.stock.grainHorizontal' : 'atelier.stock.grainVertical')}</span>
          ) : null}
          {isPanelPrice(preset.pricePerSheet) ? (
            <span className="px-2 py-0.5 rounded-md bg-brand-400/10 border border-brand-500/25 text-[11px] font-mono font-bold text-brand-600 dark:text-brand-400">
              {t('atelier.stock.presetPriceTag', { price: n(preset.pricePerSheet) })}
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          aria-label={t('panelsPage.editAria', { name: preset.name })}
          onClick={onEdit}
          disabled={disabled}
          className="inline-flex min-h-10 items-center gap-1.5 px-3 rounded-lg border border-studio-border bg-studio-panel hover:bg-studio-field text-xs font-bold text-slate-800 dark:text-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{t('panelsPage.edit')}</span>
        </button>
        {confirmingDelete ? (
          <button
            type="button"
            aria-label={t('panelsPage.confirmDeleteAria', { name: preset.name })}
            onClick={onDelete}
            disabled={disabled}
            className="inline-flex min-h-10 items-center gap-1.5 px-3 rounded-lg border border-red-600 bg-red-600 hover:bg-red-700 text-xs font-bold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t('panelsPage.confirmDelete')}</span>
          </button>
        ) : (
          <button
            type="button"
            aria-label={t('panelsPage.deleteAria', { name: preset.name })}
            onClick={onDelete}
            disabled={disabled}
            className="inline-flex min-h-10 items-center gap-1.5 px-3 rounded-lg border border-studio-border bg-studio-panel hover:bg-studio-field text-xs font-bold text-red-700 dark:text-red-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t('panelsPage.delete')}</span>
          </button>
        )}
      </div>
    </article>
  );
}
