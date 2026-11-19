'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Zap } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { AccountMenu } from '@/components/AccountMenu';
import { QatlIALogo } from '@/components/QatlIALogo';
import { WorkspaceNav } from '@/components/WorkspaceNav';
import { LocaleSwitcher, useLocale } from '@/components/LocaleProvider';
import { PanelForm } from '@/components/panels/PanelForm';
import { PanelRow } from '@/components/panels/PanelRow';
import { EMPTY_PANEL_FORM, panelToForm } from '@/lib/panel-form';
import type { NewPanelPreset } from '@/lib/panel-presets';
import { catalogPresetsFor } from '@/lib/panel-catalog';
import { useCurrency } from '@/components/currency-store';
import { DEFAULT_CURRENCY } from '@/lib/currency';
import { usePanelPresets, type PresetWriteResult } from '@/lib/use-panel-presets';
import { DEFAULT_DISPLAY_UNIT, readStoredDisplayUnit, writeStoredDisplayUnit, type DisplayUnit } from '@/lib/units';

/** How long the second click on « Supprimer » stays possible. */
const CONFIRM_DELETE_MS = 4000;

/**
 * « Configuration des panneaux »: the list of panels the artisan works with,
 * offered in the atelier when choosing the panel of a cut list. Kept in the
 * account when signed in, on the device otherwise.
 */
export default function PanelsPage() {
  const { t, n } = useLocale();
  const currency = useCurrency().currency ?? DEFAULT_CURRENCY;
  const { presets, source, signedIn, ready, add, update, remove } = usePanelPresets();

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userCredits, setUserCredits] = useState<number | null>(null);
  const [unit, setUnit] = useState<DisplayUnit>(DEFAULT_DISPLAY_UNIT);

  // A new form after each panel added: the fields start empty again. A change
  // of unit gives a new form too, so a size is never read in the wrong unit.
  const [addKey, setAddKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const confirmTimer = useRef<number | null>(null);
  // Said on screen where the artisan is looking: under the add form, or above
  // the list for an edit or a removal.
  const [notice, setNotice] = useState<{ where: 'add' | 'list'; text: string; tone: 'success' | 'warning' }>({ where: 'list', text: '', tone: 'success' });

  // Signed in, but the account list could not be read: what the page shows is
  // the device list, and a panel written to it would not reach the account.
  const accountOutOfReach = ready && signedIn && source === 'device';
  const locked = !ready || accountOutOfReach;

  useEffect(() => {
    setUnit(readStoredDisplayUnit(window.localStorage));
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (cancelled || !user) return;
        setUserEmail(user.email || null);
        const { data: profile } = await supabase.from('profiles').select('credits').eq('id', user.id).single();
        if (!cancelled) setUserCredits(typeof profile?.credits === 'number' ? profile.credits : null);
      } catch {
        /* the header shows no figure */
      }
    })();
    return () => {
      cancelled = true;
      if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    };
  }, []);

  const changeUnit = (next: DisplayUnit) => {
    setUnit(next);
    writeStoredDisplayUnit(window.localStorage, next);
  };

  /** What a refused write says, in the words the atelier already uses. */
  const refusal = (result: Exclude<PresetWriteResult, { ok: true }>) =>
    result.error === 'DUPLICATE'
      ? t('atelier.stock.presetDuplicate', { name: result.existingName ?? '' })
      : t(result.error === 'LIMIT' ? 'atelier.stock.presetLimit' : 'atelier.stock.presetSaveFailed');

  const handleAdd = async (preset: NewPanelPreset) => {
    setAdding(true);
    setAddError(null);
    const result = await add(preset);
    setAdding(false);
    if (!result.ok) {
      setAddError(refusal(result));
      return;
    }
    setAddKey((key) => key + 1);
    setNotice({ where: 'add', text: t('panelsPage.savedOk', { name: preset.name }), tone: 'success' });
  };

  const handleUpdate = async (id: string, preset: NewPanelPreset) => {
    setSaving(true);
    setEditError(null);
    const result = await update(id, preset);
    setSaving(false);
    if (!result.ok) {
      setEditError(refusal(result));
      return;
    }
    setEditingId(null);
    setNotice({ where: 'list', text: t('panelsPage.savedOk', { name: preset.name }), tone: 'success' });
  };

  /** The first click asks, the second removes; the question goes away on its own. */
  const handleDelete = async (id: string) => {
    if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    if (confirmingDeleteId !== id) {
      setConfirmingDeleteId(id);
      confirmTimer.current = window.setTimeout(() => setConfirmingDeleteId(null), CONFIRM_DELETE_MS);
      return;
    }
    setConfirmingDeleteId(null);
    const removed = await remove(id);
    setNotice({ where: 'list', text: t(removed ? 'atelier.stock.presetDeleted' : 'panelsPage.deleteFailed'), tone: removed ? 'success' : 'warning' });
  };

  return (
    <div className="min-h-screen bg-studio-canvas text-slate-900 dark:text-slate-100 font-sans antialiased selection:bg-brand-400 selection:text-black pb-16">
      <header className="sticky top-0 z-40 border-b border-studio-border/70 bg-studio-canvas/70 backdrop-blur-2xl backdrop-saturate-150">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2 px-4 sm:px-8 h-16">
          <div className="flex items-center gap-2 min-w-0">
            <div className="text-brand-400"><QatlIALogo size="sm" /></div>
            {/* On a phone the language, credits and account controls fill the
                bar; the title stays for screen readers (the page heading below
                names the page too). */}
            <h1 className="sr-only sm:not-sr-only font-display font-extrabold text-base text-slate-900 dark:text-white tracking-tight truncate">{t('panelsPage.heading')}</h1>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <LocaleSwitcher />
            <Link
              href="/credits"
              aria-label={`${t('atelier.header.creditsAria')}: ${userCredits === null ? '—' : n(userCredits)}`}
              className="flex items-center gap-1.5 px-2.5 sm:px-3.5 py-2 rounded-xl bg-brand-400/10 border border-brand-500/25 text-brand-400 hover:bg-brand-500/15 text-xs font-semibold transition-all"
            >
              <Zap className="w-3.5 h-3.5 fill-brand-400 text-brand-400" aria-hidden="true" />
              <span dir="ltr" className="font-mono font-bold">{userCredits === null ? '—' : n(userCredits)}</span>
            </Link>
            {userEmail ? (<AccountMenu email={userEmail} />) : (
              <Link href="/auth/login?redirect=/panels" className="px-3 sm:px-4 py-2 rounded-xl bg-white dark:bg-studio-field text-slate-950 font-bold text-xs hover:bg-slate-100 transition-all">{t('nav.login')}</Link>
            )}
          </div>
        </div>
      </header>

      <WorkspaceNav current="panels" className="max-w-6xl mx-auto px-4 sm:px-8" />

      <main className="max-w-6xl mx-auto px-4 sm:px-8 mt-8 space-y-6">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-600 dark:text-brand-400">{t('panelsPage.eyebrow')}</p>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white">{t('panelsPage.heading')}</h2>
          <p className="max-w-2xl text-sm text-slate-600 dark:text-slate-400">{t('panelsPage.subtitle')}</p>
        </div>

        {ready && !signedIn ? (
          <p className="px-3.5 py-2.5 rounded-xl bg-brand-400/10 border border-brand-500/20 text-xs text-slate-700 dark:text-slate-300">
            {t('panelsPage.deviceNote')}
          </p>
        ) : null}

        {accountOutOfReach ? (
          <p className="px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs font-semibold text-amber-800 dark:text-amber-200">
            {t('panelsPage.accountUnreachable')}
          </p>
        ) : null}

        <div className="flex flex-col lg:flex-row lg:items-start gap-6">
          <section aria-labelledby="add-panel-title" className="lg:w-[380px] lg:shrink-0 rounded-xl bg-studio-panel border border-studio-border shadow-sm">
            <h3 id="add-panel-title" className="px-4 py-3.5 border-b border-studio-border text-sm font-bold">{t('panelsPage.addTitle')}</h3>
            <div className="p-4">
              <PanelForm
                key={`${addKey}-${unit}`}
                idPrefix="add"
                initial={EMPTY_PANEL_FORM}
                unit={unit}
                submitLabel={t('panelsPage.addSubmit')}
                busy={adding || locked}
                error={addError}
                onSubmit={(preset) => void handleAdd(preset)}
                shortcuts={catalogPresetsFor(currency)}
              />
              {/* Always in the page, so a screen reader hears each change as it happens. */}
              <p role="status" aria-live="polite" className={`mt-3 text-xs font-semibold empty:hidden ${notice.tone === 'success' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'}`}>{notice.where === 'add' ? notice.text : ''}</p>
            </div>
          </section>

          <section aria-labelledby="panel-list-title" className="flex-1 min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 id="panel-list-title" className="text-sm font-bold">{t('panelsPage.listTitle')}</h3>
              <div role="group" aria-label={t('atelier.stock.unitGroupAria')} className="flex items-center p-0.5 rounded-lg bg-studio-field border border-studio-border">
                {(['cm', 'mm'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => changeUnit(option)}
                    aria-pressed={unit === option}
                    className={`min-w-10 min-h-9 px-2.5 rounded-md text-[11px] font-bold transition-all ${unit === option ? 'bg-brand-400 text-slate-950' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <p role="status" aria-live="polite" className={`text-xs font-semibold empty:hidden ${notice.tone === 'success' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'}`}>{notice.where === 'list' ? notice.text : ''}</p>

            {!ready && presets.length === 0 ? (
              <div role="status" aria-label={t('panelsPage.loadingAria')} className="space-y-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl bg-studio-panel border border-studio-border animate-pulse" />)}
              </div>
            ) : presets.length === 0 ? (
              <p className="px-4 py-8 rounded-xl border border-dashed border-studio-border text-center text-sm text-slate-600 dark:text-slate-400">
                {t('panelsPage.empty')}
              </p>
            ) : (
              <ul className="space-y-3" data-source={source}>
                {presets.map((preset) => (
                  <li key={preset.id}>
                    {editingId === preset.id ? (
                      <div className="rounded-xl bg-studio-panel border border-brand-500/40 shadow-sm">
                        <h4 dir="auto" className="px-4 py-3.5 border-b border-studio-border text-sm font-bold truncate">
                          {t('panelsPage.editTitle', { name: preset.name })}
                        </h4>
                        <div className="p-4">
                          {/* Filled again in the new unit when the unit changes. */}
                          <PanelForm
                            key={unit}
                            idPrefix={`edit-${preset.id}`}
                            initial={panelToForm(preset, unit)}
                            unit={unit}
                            submitLabel={t('panelsPage.save')}
                            busy={saving}
                            error={editError}
                            onSubmit={(next) => void handleUpdate(preset.id, next)}
                            onCancel={() => {
                              setEditingId(null);
                              setEditError(null);
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <PanelRow
                        preset={preset}
                        unit={unit}
                        confirmingDelete={confirmingDeleteId === preset.id}
                        disabled={locked}
                        onEdit={() => {
                          setEditingId(preset.id);
                          setEditError(null);
                        }}
                        onDelete={() => void handleDelete(preset.id)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
