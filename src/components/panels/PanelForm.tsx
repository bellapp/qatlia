'use client';

import { useState, type FormEvent } from 'react';
import { useLocale } from '@/components/LocaleProvider';
import { materialLabelKey } from '@/i18n/domain';
import type { TranslationKey } from '@/i18n';
import { PANEL_NAME_MAX_CHARS, STOCK_MATERIAL_VALUES, panelToForm, parsePanelForm, type PanelFormError, type PanelFormValues } from '@/lib/panel-form';
import { PRESET_COLOR_MAX_CHARS } from '@/lib/panel-preset-rules';
import type { NewPanelPreset, PanelPreset } from '@/lib/panel-presets';
import type { DisplayUnit } from '@/lib/units';

interface PanelFormProps {
  /** Prefix of the field ids, unique on the page (two forms can be open). */
  idPrefix: string;
  initial: PanelFormValues;
  unit: DisplayUnit;
  submitLabel: string;
  busy: boolean;
  /** A refusal from the list (duplicate, limit, failure), said under the form. */
  error: string | null;
  onSubmit(preset: NewPanelPreset): void;
  onCancel?: () => void;
  /** Standard sizes offered as shortcuts: a click fills the size and the material. */
  shortcuts?: readonly PanelPreset[];
}

const ERROR_KEYS: Record<PanelFormError, TranslationKey> = {
  name: 'panelsPage.errorName',
  height: 'panelsPage.errorHeight',
  width: 'panelsPage.errorWidth',
  price: 'panelsPage.errorPrice',
};

const FIELD = 'w-full min-h-10 px-3 rounded-lg bg-studio-field border text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/30';
const LABEL = 'block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1.5';

/** Adding or editing a panel of the artisan's list. */
export function PanelForm({ idPrefix, initial, unit, submitLabel, busy, error, onSubmit, onCancel, shortcuts }: PanelFormProps) {
  const { t } = useLocale();
  const [values, setValues] = useState<PanelFormValues>(initial);
  const [errors, setErrors] = useState<PanelFormError[]>([]);
  const set = <K extends keyof PanelFormValues>(key: K, value: PanelFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => current.filter((field) => field !== key));
  };
  const id = (field: string) => `${idPrefix}-${field}`;
  const invalid = (field: PanelFormError) => errors.includes(field);
  const border = (field: PanelFormError) => (invalid(field) ? 'border-red-500' : 'border-studio-border');
  // A panel saved with a material the stock list no longer offers keeps it.
  const materials: readonly string[] = STOCK_MATERIAL_VALUES.includes(values.material as (typeof STOCK_MATERIAL_VALUES)[number])
    ? STOCK_MATERIAL_VALUES
    : [...STOCK_MATERIAL_VALUES, values.material];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parsePanelForm(values, unit);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    onSubmit(parsed.preset);
  };

  const fieldError = (field: PanelFormError) =>
    invalid(field) ? <p id={id(`${field}-error`)} className="mt-1 text-[11px] font-semibold text-red-600 dark:text-red-400">{t(ERROR_KEYS[field])}</p> : null;

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {shortcuts && shortcuts.length > 0 ? (
        <div className="space-y-2">
          <p className={LABEL}>{t('panelsPage.standardSizes')}</p>
          <div className="flex flex-wrap gap-1.5">
            {shortcuts.map((preset) => (
              <button
                key={preset.id}
                type="button"
                aria-label={t('panelsPage.standardSizeAria', { name: preset.name })}
                onClick={() => {
                  const filled = panelToForm(preset, unit);
                  setValues((current) => ({ ...current, height: filled.height, width: filled.width, material: filled.material, name: current.name || preset.name }));
                  setErrors((current) => current.filter((field) => field !== 'height' && field !== 'width' && field !== 'name'));
                }}
                className="min-h-10 px-3 rounded-full border border-studio-border bg-studio-panel hover:border-brand-500/50 hover:bg-brand-400/10 font-mono text-[11px] font-bold text-slate-700 dark:text-slate-300 transition-colors"
              >
                <span dir="ltr">{panelToForm(preset, unit).height} × {panelToForm(preset, unit).width}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <label htmlFor={id('name')} className={LABEL}>{t('atelier.stock.panelNameLabel')}</label>
        <input
          id={id('name')}
          type="text"
          dir="auto"
          value={values.name}
          maxLength={PANEL_NAME_MAX_CHARS}
          placeholder={t('atelier.stock.panelNamePlaceholder')}
          aria-invalid={invalid('name') || undefined}
          aria-describedby={invalid('name') ? id('name-error') : undefined}
          onChange={(e) => set('name', e.target.value)}
          className={`${FIELD} ${border('name')}`}
        />
        {fieldError('name')}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {(['height', 'width'] as const).map((field) => (
          <div key={field} className="min-w-0">
            <label htmlFor={id(field)} className={LABEL}>
              {t(field === 'height' ? 'atelier.stock.heightLabel' : 'atelier.stock.widthLabel', { unit })}
            </label>
            <input
              id={id(field)}
              type="text"
              inputMode="decimal"
              dir="ltr"
              value={values[field]}
              aria-invalid={invalid(field) || undefined}
              aria-describedby={invalid(field) ? id(`${field}-error`) : undefined}
              onChange={(e) => set(field, e.target.value)}
              className={`${FIELD} ${border(field)} font-mono font-bold`}
            />
            {fieldError(field)}
          </div>
        ))}
      </div>

      <div>
        <label htmlFor={id('material')} className={LABEL}>{t('atelier.stock.materialLabel')}</label>
        <select
          id={id('material')}
          value={values.material}
          onChange={(e) => set('material', e.target.value)}
          className={`${FIELD} border-studio-border [&>option]:bg-white [&>option]:text-slate-900 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-100`}
        >
          {materials.map((material) => (
            <option key={material} value={material}>{t(materialLabelKey(material))}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={id('color')} className={LABEL}>{t('atelier.stock.presetColorLabel')}</label>
        <input
          id={id('color')}
          type="text"
          dir="auto"
          value={values.color}
          maxLength={PRESET_COLOR_MAX_CHARS}
          placeholder={t('atelier.stock.presetColorPlaceholder')}
          onChange={(e) => set('color', e.target.value)}
          className={`${FIELD} border-studio-border`}
        />
      </div>

      <div className="space-y-2">
        <div className="flex min-h-10 items-center gap-2.5">
          <input
            id={id('grain')}
            type="checkbox"
            checked={values.hasGrain}
            onChange={(e) => set('hasGrain', e.target.checked)}
            className="w-4 h-4 accent-brand-500"
          />
          <label htmlFor={id('grain')} className="text-sm text-slate-800 dark:text-slate-200">{t('atelier.stock.grainToggle')}</label>
        </div>
        {values.hasGrain ? (
          <fieldset className="space-y-1.5">
            <legend className={LABEL}>{t('panelsPage.grainDirectionLabel')}</legend>
            <div className="flex flex-wrap gap-4">
              {(['vertical', 'horizontal'] as const).map((orientation) => (
                <div key={orientation} className="flex min-h-10 items-center gap-2">
                  <input
                    id={id(`grain-${orientation}`)}
                    type="radio"
                    name={id('grain-orientation')}
                    checked={values.grainOrientation === orientation}
                    onChange={() => set('grainOrientation', orientation)}
                    className="w-4 h-4 accent-brand-500"
                  />
                  <label htmlFor={id(`grain-${orientation}`)} className="text-sm text-slate-800 dark:text-slate-200">
                    {t(orientation === 'horizontal' ? 'atelier.stock.grainHorizontal' : 'atelier.stock.grainVertical')}
                  </label>
                </div>
              ))}
            </div>
          </fieldset>
        ) : null}
      </div>

      <div>
        <label htmlFor={id('price')} className={LABEL}>{t('atelier.stock.panelPriceLabel')}</label>
        <input
          id={id('price')}
          type="text"
          inputMode="decimal"
          dir="ltr"
          value={values.price}
          placeholder={t('panelsPage.pricePlaceholder')}
          aria-invalid={invalid('price') || undefined}
          aria-describedby={invalid('price') ? id('price-error') : undefined}
          onChange={(e) => set('price', e.target.value)}
          className={`${FIELD} ${border('price')} font-mono font-bold placeholder:font-sans placeholder:font-normal`}
        />
        {fieldError('price')}
      </div>

      {error ? (
        <p role="alert" className="text-xs font-semibold text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-11 items-center justify-center px-4 rounded-xl bg-brand-400 hover:bg-brand-500 text-slate-950 text-sm font-extrabold transition-colors disabled:opacity-60 disabled:cursor-wait"
        >
          {submitLabel}
        </button>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-11 items-center px-4 rounded-xl border border-studio-border bg-studio-panel hover:bg-studio-field text-sm font-bold text-slate-700 dark:text-slate-300 transition-colors"
          >
            {t('panelsPage.cancel')}
          </button>
        ) : null}
      </div>
    </form>
  );
}
