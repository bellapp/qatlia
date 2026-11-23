'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/components/LocaleProvider';
import type { TranslationKey } from '@/i18n';
import { resizeLogoFile } from '@/lib/logo-resize';
import { readStoredCompanyIdentity } from '@/lib/quotation-local-store';
import type { Atelier } from '@/lib/atelier';

interface FormValues {
  name: string;
  phone: string;
  address: string;
  email: string;
  ice: string;
  taxId: string;
}

const EMPTY_FORM: FormValues = { name: '', phone: '', address: '', email: '', ice: '', taxId: '' };

const FIELD_CLASS =
  'px-3 py-2.5 rounded-xl bg-studio-field border border-studio-border text-sm outline-none focus:border-brand-500/50';

// Every field of the form, in the order it is shown. Numbers and addresses
// stay left-to-right (ltr) even in an Arabic page.
const FIELDS: ReadonlyArray<{
  key: keyof FormValues;
  label: TranslationKey;
  type: 'text' | 'tel' | 'email';
  ltr: boolean;
  required?: boolean;
  wide?: boolean;
}> = [
  { key: 'name', label: 'accountPage.business.name', type: 'text', ltr: false, required: true, wide: true },
  { key: 'phone', label: 'accountPage.business.phone', type: 'tel', ltr: true },
  { key: 'address', label: 'accountPage.business.address', type: 'text', ltr: false },
  { key: 'email', label: 'accountPage.business.email', type: 'email', ltr: true },
  { key: 'ice', label: 'accountPage.business.ice', type: 'text', ltr: true },
  { key: 'taxId', label: 'accountPage.business.taxId', type: 'text', ltr: true },
];

function formFrom(atelier: Atelier): FormValues {
  return {
    name: atelier.name,
    phone: atelier.phone ?? '',
    address: atelier.address ?? '',
    email: atelier.email ?? '',
    ice: atelier.ice ?? '',
    taxId: atelier.taxId ?? '',
  };
}

/** Optional fields left blank are omitted: the server reads an absent one as cleared. */
function bodyFrom(form: FormValues): Partial<Atelier> & { name: string } {
  const body: Partial<Atelier> & { name: string } = { name: form.name.trim() };
  for (const key of ['phone', 'address', 'email', 'ice', 'taxId'] as const) {
    const value = form[key].trim();
    if (value) body[key] = value;
  }
  return body;
}

function errorKey(code: unknown): TranslationKey {
  if (code === 'INVALID_LOGO' || code === 'TOO_LARGE') return 'accountPage.business.errors.invalidLogo';
  if (code === 'INVALID_DATA') return 'accountPage.business.errors.invalidData';
  return 'accountPage.business.errors.saveFailed';
}

/** « Mon entreprise »: the identity printed on the artisan's cut plans and quotes. */
export function BusinessIdentityForm() {
  const { t } = useLocale();
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  // The logo as the server holds it, or as just chosen; null once removed.
  const [logo, setLogo] = useState<string | null>(null);
  // Sent as logoDataUrl only when the artisan touched the logo; otherwise the
  // saved one is kept untouched on the server.
  const [logoChanged, setLogoChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/atelier');
        if (!res.ok) return;
        const data: { atelier?: Atelier | null } = await res.json();
        if (cancelled) return;
        if (data.atelier) {
          setForm(formFrom(data.atelier));
          setLogo(data.atelier.logoDataUrl ?? null);
          return;
        }
        // No business saved yet: start from what the quotation dialog remembered.
        const remembered = readStoredCompanyIdentity(window.localStorage);
        if (remembered) setForm(formFrom(remembered));
      } catch {
        /* the form simply starts empty */
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // The confirmation goes away by itself after a few seconds.
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 4000);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const clearMessages = () => {
    setSaved(false);
    setErrorMessage(null);
  };

  const handleChange = (key: keyof FormValues, value: string) => {
    clearMessages();
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleLogoPicked = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    clearMessages();
    try {
      setLogo(await resizeLogoFile(file));
      setLogoChanged(true);
    } catch {
      // The current logo stays as it was.
      setErrorMessage(t('accountPage.business.errors.invalidLogo'));
    }
  };

  const handleRemoveLogo = () => {
    clearMessages();
    setLogo(null);
    setLogoChanged(true);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || !form.name.trim()) return;
    clearMessages();
    setSaving(true);
    try {
      const body = bodyFrom(form);
      if (logoChanged) body.logoDataUrl = logo;
      const res = await fetch('/api/atelier', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data: { atelier?: Atelier; error?: string } = await res.json().catch(() => ({}));
      if (!res.ok || !data.atelier) {
        setErrorMessage(t(errorKey(data.error)));
        return;
      }
      setForm(formFrom(data.atelier));
      setLogo(data.atelier.logoDataUrl ?? null);
      setLogoChanged(false);
      setSaved(true);
    } catch {
      setErrorMessage(t('accountPage.business.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        {FIELDS.map((field) => (
          <label key={field.key} className={`flex flex-col gap-1 ${field.wide ? 'sm:col-span-2' : ''}`}>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {t(field.label)}
            </span>
            <input
              type={field.type}
              value={form[field.key]}
              onChange={(e) => handleChange(field.key, e.target.value)}
              required={field.required}
              dir={field.ltr ? 'ltr' : undefined}
              className={`${FIELD_CLASS} ${field.ltr ? 'text-start' : ''}`}
            />
          </label>
        ))}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t('accountPage.business.logo')}</p>
        <div className="flex flex-wrap items-center gap-3">
          {logo && (
            // A data: URL the artisan just chose: nothing for next/image to optimise.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo}
              alt={t('accountPage.business.logo')}
              className="h-16 max-w-[10rem] object-contain rounded-lg bg-white border border-studio-border p-1"
            />
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg"
            onChange={handleLogoPicked}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="px-3 py-2 rounded-xl bg-studio-field border border-studio-border text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-studio-panel"
          >
            {t('accountPage.business.logoChoose')}
          </button>
          {logo && (
            <button
              type="button"
              onClick={handleRemoveLogo}
              className="px-3 py-2 rounded-xl border border-rose-500/30 text-rose-300 text-xs font-semibold hover:bg-rose-500/10"
            >
              {t('accountPage.business.removeLogo')}
            </button>
          )}
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400">{t('accountPage.business.logoHint')}</p>
      </div>

      <button
        type="submit"
        disabled={saving || !form.name.trim()}
        aria-busy={saving}
        className="w-full py-2.5 rounded-xl bg-brand-400 hover:bg-brand-500 text-slate-950 font-black text-xs disabled:opacity-50"
      >
        {saving ? t('accountPage.saving') : t('accountPage.business.save')}
      </button>
      {errorMessage && <p role="alert" className="text-xs text-rose-300">{errorMessage}</p>}
      {saved && <p role="status" className="text-xs text-emerald-400">{t('accountPage.business.saved')}</p>}
    </form>
  );
}
