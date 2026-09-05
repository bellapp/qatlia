'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { X, FileText, RefreshCw, Upload, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useLocale } from '@/components/LocaleProvider';
import { quotationErrorKey } from '@/i18n/domain';
import type { TranslationKey } from '@/i18n';
import type { CostBreakdownInput, DiscountMode } from '@/lib/costing';
import {
  buildQuotationRequestPayload,
  suggestQuoteNumber,
  sanitizeQuoteNumberForFilename,
  QUOTATION_TEXT_LIMITS,
  type CompanyIdentity,
  type ClientIdentity,
  type QuotationLocale,
  type QuotationPanelLine,
  type QuotationPieceLine,
} from '@/lib/quotation';
import { readStoredCompanyIdentity, writeStoredCompanyIdentity } from '@/lib/quotation-local-store';

const MAX_LOGO_BYTES = 500 * 1024;
const ACCEPTED_LOGO_TYPES = ['image/png', 'image/jpeg'];

/** Time to keep a generated PDF's object URL alive before revoking it — some
 * browsers (notably older Safari/WebKit) haven't necessarily started
 * reading the blob URL the instant `<a>.click()` returns, so revoking
 * synchronously right after can occasionally drop the download. */
const REVOKE_OBJECT_URL_DELAY_MS = 1000;

interface QuotationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Opens the app's existing sign-in modal; this dialog never renders its own auth form. */
  onRequireAuth: () => void;
  /** The exact input the optimizer passed to computeCostBreakdown — forwarded verbatim, never recomputed here. */
  costingInput: CostBreakdownInput;
  /** Bounded detail lines derived from the optimizer's own result (see src/lib/quotation-items.ts) — forwarded verbatim, never edited here. */
  panels?: QuotationPanelLine[];
  pieces?: QuotationPieceLine[];
  /** Already-localized message when the plan's panels/pieces exceed the schema-bounded maximum (see src/lib/quotation-items.ts's `{ ok: false }` result) — non-null both shows a visible error and disables quote generation, since a `.slice()`d document would silently omit panels/pieces with no trace. */
  itemLimitError?: string | null;
  /** The current saved project, if any — merged server-side into its options_json when the quote generates successfully, and used to prefill this dialog from that project's own saved quotation metadata (see the projectId effect below). */
  projectId?: string | null;
}

type SuccessState = 'saved' | 'notSaved' | null;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// `CompanyIdentitySchema`/`ClientIdentitySchema`'s optional fields infer as
// required keys of type `T | undefined` (zod's `.optional().transform(...)`
// output shape), not optional TS properties — so every reset needs every key
// present, explicitly `undefined`, rather than just `{ name: '' }`.
const EMPTY_COMPANY: CompanyIdentity = { name: '', address: undefined, phone: undefined, email: undefined, ice: undefined, taxId: undefined };
const EMPTY_CLIENT: ClientIdentity = { name: '', address: undefined, phone: undefined, email: undefined };

/** Bounded, defensive parse of a free-typed numeric draft: never NaN/negative/non-finite. */
function parseNonNegative(raw: string): number {
  const value = parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Server-owned quotation metadata for a project — see GET /api/projects/[id]. Every field is optional: a project may have none yet, or a partially-corrupt record that route already degrades to `null`. */
interface StoredQuotationMetadata {
  company?: CompanyIdentity;
  client?: ClientIdentity;
  projectReference?: string;
  notes?: string;
  locale?: QuotationLocale;
  deliveryCost?: number;
  tax?: { mode: 'none' | 'percentage'; ratePercent?: number };
  discount?: { mode: DiscountMode; value?: number };
  includeAmountInWords?: boolean;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const QuotationDialog: React.FC<QuotationDialogProps> = ({
  isOpen,
  onClose,
  onRequireAuth,
  costingInput,
  panels = [],
  pieces = [],
  itemLimitError = null,
  projectId,
}) => {
  const { t, locale } = useLocale();
  const headingId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const [company, setCompany] = useState<CompanyIdentity>(EMPTY_COMPANY);
  const [client, setClient] = useState<ClientIdentity>(EMPTY_CLIENT);
  const [quoteNumber, setQuoteNumber] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [projectReference, setProjectReference] = useState('');
  const [deliveryDraft, setDeliveryDraft] = useState('0');
  const [discountMode, setDiscountMode] = useState<DiscountMode>('none');
  const [discountDraft, setDiscountDraft] = useState('0');
  const [vatEnabled, setVatEnabled] = useState(false);
  const [vatRateDraft, setVatRateDraft] = useState('');
  const [notes, setNotes] = useState('');
  const [outputLocale, setOutputLocale] = useState<QuotationLocale>('fr');
  const [includeAmountInWords, setIncludeAmountInWords] = useState(false);
  const [logoDataUrl, setLogoDataUrl] = useState<string | undefined>(undefined);
  const [logoFileName, setLogoFileName] = useState<string | undefined>(undefined);
  const [logoError, setLogoError] = useState<TranslationKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const [successState, setSuccessState] = useState<SuccessState>(null);

  // Prefill on every open: the artisan's own company identity comes back
  // from local storage (see quotation-local-store.ts) as a fallback only —
  // never the client's. The client always starts empty here; a project-
  // scoped prefill (if any) is applied by the separate effect below, once
  // it resolves. Everything else resets to a fresh default so a previous
  // quotation's discount/notes never silently leak into the next one.
  useEffect(() => {
    if (!isOpen) return;
    const storage = typeof window !== 'undefined' ? window.localStorage : null;
    setCompany(readStoredCompanyIdentity(storage) ?? EMPTY_COMPANY);
    setClient(EMPTY_CLIENT);
    setQuoteNumber(suggestQuoteNumber(new Date()));
    setIssueDate(todayIsoDate());
    setExpiryDate('');
    setProjectReference('');
    setDeliveryDraft('0');
    setDiscountMode('none');
    setDiscountDraft('0');
    // VAT defaults off with an empty rate — never a silently assumed 20%.
    setVatEnabled(false);
    setVatRateDraft('');
    setNotes('');
    setOutputLocale(locale === 'ar' ? 'ar' : 'fr');
    setIncludeAmountInWords(false);
    setLogoDataUrl(undefined);
    setLogoFileName(undefined);
    setLogoError(null);
    setErrorKey(null);
    setSuccessState(null);
    if (logoInputRef.current) logoInputRef.current.value = '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Server-owned prefill: when reopening a dialog for a project that
  // already carries saved quotation metadata (see /api/export-quotation's
  // own options_json merge), fetch and overlay it — company/client here
  // take priority over the reset effect's local-storage/empty defaults
  // above. `cancelled` guards against a slow response landing after the
  // dialog closed or `projectId` changed to a different project.
  useEffect(() => {
    if (!isOpen || !projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        if (!res.ok || cancelled) return;
        const body = await res.json().catch(() => null);
        const quotation = body?.quotation as StoredQuotationMetadata | null | undefined;
        if (!quotation || cancelled) return;
        if (quotation.company) setCompany(quotation.company);
        if (quotation.client) setClient(quotation.client);
        if (quotation.projectReference !== undefined) setProjectReference(quotation.projectReference);
        if (quotation.notes !== undefined) setNotes(quotation.notes);
        if (quotation.locale) setOutputLocale(quotation.locale);
        if (quotation.deliveryCost !== undefined) setDeliveryDraft(String(quotation.deliveryCost));
        if (quotation.discount) {
          setDiscountMode(quotation.discount.mode);
          if (quotation.discount.value !== undefined) setDiscountDraft(String(quotation.discount.value));
        }
        if (quotation.tax) {
          setVatEnabled(quotation.tax.mode === 'percentage');
          if (quotation.tax.ratePercent !== undefined) setVatRateDraft(String(quotation.tax.ratePercent));
        }
        if (quotation.includeAmountInWords !== undefined) setIncludeAmountInWords(quotation.includeAmountInWords);
      } catch {
        /* best-effort prefill only — the dialog stays usable with its local/empty defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, projectId]);

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      // Focus trap: Tab/Shift+Tab cycles within the dialog instead of
      // escaping to whatever sits behind the modal overlay.
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleLogoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setLogoError(null);
    if (!file) return;
    if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
      setLogoError('quotation.logo.badType');
      event.target.value = '';
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setLogoError('quotation.logo.tooLarge');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoDataUrl(reader.result as string);
    reader.onerror = () => setLogoError('quotation.logo.badType');
    reader.readAsDataURL(file);
    setLogoFileName(file.name);
  };

  const handleRemoveLogo = () => {
    setLogoDataUrl(undefined);
    setLogoFileName(undefined);
    setLogoError(null);
    if (logoInputRef.current) logoInputRef.current.value = '';
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrorKey(null);
    setSuccessState(null);

    // Defense in depth alongside the disabled submit button below — a plan
    // whose panels/pieces exceed the schema-bounded maximum must never reach
    // the server, which would only draw an incomplete document.
    if (itemLimitError) return;

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      onRequireAuth();
      setErrorKey('quotation.errors.authRequired');
      return;
    }

    setSubmitting(true);
    try {
      const deliveryCost = parseNonNegative(deliveryDraft);
      const discount =
        discountMode === 'none'
          ? ({ mode: 'none' as const })
          : ({ mode: discountMode, value: parseNonNegative(discountDraft) });
      const vatRate = vatEnabled ? Math.min(100, parseNonNegative(vatRateDraft)) : 0;
      const tax = vatEnabled ? ({ mode: 'percentage' as const, ratePercent: vatRate }) : ({ mode: 'none' as const });

      const payload = buildQuotationRequestPayload({
        costingInput,
        tax,
        discount,
        deliveryCost,
        company,
        client,
        quoteNumber,
        issueDate,
        expiryDate: expiryDate || undefined,
        projectReference: projectReference.trim() ? projectReference.trim() : undefined,
        notes: notes.trim() ? notes.trim() : undefined,
        locale: outputLocale,
        includeAmountInWords,
        logoDataUrl,
        panels,
        pieces,
        projectId: projectId ?? undefined,
      });

      const res = await fetch('/api/export-quotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        if (res.status === 401) onRequireAuth();
        const body = await res.json().catch(() => ({}));
        setErrorKey(quotationErrorKey(body?.error));
        return;
      }

      // Only the artisan's own company identity is ever remembered locally
      // — never the client's (see quotation-local-store.ts's own doc
      // comment on why client identity has no business in browser storage).
      if (typeof window !== 'undefined') {
        writeStoredCompanyIdentity(window.localStorage, company);
      }

      // Never claim "saved" unless the API itself confirms it via this header.
      const saved = res.headers.get('X-Quotation-Project-Saved') === 'true';
      setSuccessState(projectId && saved ? 'saved' : 'notSaved');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `qatlia_devis_${sanitizeQuoteNumberForFilename(quoteNumber)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoking immediately after click() can race the browser's own read
      // of the blob URL in some engines — see REVOKE_OBJECT_URL_DELAY_MS.
      window.setTimeout(() => window.URL.revokeObjectURL(url), REVOKE_OBJECT_URL_DELAY_MS);
    } catch (err) {
      console.error('Erreur génération devis:', err);
      setErrorKey('quotation.errors.generic');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full bg-studio-field border border-studio-border rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-500 outline-none focus:border-brand-500/50 disabled:opacity-50';
  const labelClass = 'block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        data-testid="quotation-dialog"
        tabIndex={-1}
        className="relative w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl bg-studio-panel border border-studio-border shadow-2xl outline-none"
      >
        <div className="sticky top-0 z-10 bg-studio-panel border-b border-studio-border px-6 py-4 flex items-start justify-between gap-4">
          <div>
            <h2 id={headingId} className="text-lg font-black text-slate-900 dark:text-white">{t('quotation.title')}</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{t('quotation.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('quotation.closeAria')}
            className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-full hover:bg-studio-field transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {itemLimitError && (
            <div role="alert" className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
              {itemLimitError}
            </div>
          )}
          {errorKey && (
            <div role="alert" className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
              {t(errorKey)}
            </div>
          )}
          {successState && (
            <div role="status" className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs">
              {t(successState === 'saved' ? 'quotation.savedToProject' : 'quotation.notSaved')}
            </div>
          )}

          <fieldset className="space-y-3">
            <legend className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t('quotation.companySection')}</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor={`${headingId}-company-name`}>{t('quotation.fields.companyName')}</label>
                <input
                  id={`${headingId}-company-name`}
                  required
                  maxLength={QUOTATION_TEXT_LIMITS.shortText}
                  value={company.name}
                  onChange={(e) => setCompany({ ...company, name: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor={`${headingId}-company-address`}>{t('quotation.fields.companyAddress')}</label>
                <input
                  id={`${headingId}-company-address`}
                  maxLength={QUOTATION_TEXT_LIMITS.addressText}
                  value={company.address ?? ''}
                  onChange={(e) => setCompany({ ...company, address: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor={`${headingId}-company-phone`}>{t('quotation.fields.companyPhone')}</label>
                <input
                  id={`${headingId}-company-phone`}
                  dir="ltr"
                  maxLength={QUOTATION_TEXT_LIMITS.phoneText}
                  value={company.phone ?? ''}
                  onChange={(e) => setCompany({ ...company, phone: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor={`${headingId}-company-email`}>{t('quotation.fields.companyEmail')}</label>
                <input
                  id={`${headingId}-company-email`}
                  type="email"
                  dir="ltr"
                  maxLength={QUOTATION_TEXT_LIMITS.shortText}
                  value={company.email ?? ''}
                  onChange={(e) => setCompany({ ...company, email: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor={`${headingId}-company-ice`}>{t('quotation.fields.companyIce')}</label>
                <input
                  id={`${headingId}-company-ice`}
                  dir="ltr"
                  maxLength={QUOTATION_TEXT_LIMITS.phoneText}
                  value={company.ice ?? ''}
                  onChange={(e) => setCompany({ ...company, ice: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor={`${headingId}-company-taxid`}>{t('quotation.fields.companyTaxId')}</label>
                <input
                  id={`${headingId}-company-taxid`}
                  dir="ltr"
                  maxLength={QUOTATION_TEXT_LIMITS.phoneText}
                  value={company.taxId ?? ''}
                  onChange={(e) => setCompany({ ...company, taxId: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{t('quotation.clientSection')}</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor={`${headingId}-client-name`}>{t('quotation.fields.clientName')}</label>
                <input
                  id={`${headingId}-client-name`}
                  required
                  maxLength={QUOTATION_TEXT_LIMITS.shortText}
                  value={client.name}
                  onChange={(e) => setClient({ ...client, name: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor={`${headingId}-client-address`}>{t('quotation.fields.clientAddress')}</label>
                <input
                  id={`${headingId}-client-address`}
                  maxLength={QUOTATION_TEXT_LIMITS.addressText}
                  value={client.address ?? ''}
                  onChange={(e) => setClient({ ...client, address: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor={`${headingId}-client-phone`}>{t('quotation.fields.clientPhone')}</label>
                <input
                  id={`${headingId}-client-phone`}
                  dir="ltr"
                  maxLength={QUOTATION_TEXT_LIMITS.phoneText}
                  value={client.phone ?? ''}
                  onChange={(e) => setClient({ ...client, phone: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor={`${headingId}-client-email`}>{t('quotation.fields.clientEmail')}</label>
                <input
                  id={`${headingId}-client-email`}
                  type="email"
                  dir="ltr"
                  maxLength={QUOTATION_TEXT_LIMITS.shortText}
                  value={client.email ?? ''}
                  onChange={(e) => setClient({ ...client, email: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <legend className="sr-only">{t('quotation.fields.quoteNumber')}</legend>
            <div>
              <label className={labelClass} htmlFor={`${headingId}-quote-number`}>{t('quotation.fields.quoteNumber')}</label>
              <input
                id={`${headingId}-quote-number`}
                dir="ltr"
                required
                maxLength={QUOTATION_TEXT_LIMITS.shortText}
                value={quoteNumber}
                onChange={(e) => setQuoteNumber(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor={`${headingId}-issue-date`}>{t('quotation.fields.issueDate')}</label>
              <input
                id={`${headingId}-issue-date`}
                type="date"
                dir="ltr"
                required
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor={`${headingId}-expiry-date`}>{t('quotation.fields.expiryDate')}</label>
              <input
                id={`${headingId}-expiry-date`}
                type="date"
                dir="ltr"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor={`${headingId}-project-reference`}>{t('quotation.fields.projectReference')}</label>
              <input
                id={`${headingId}-project-reference`}
                maxLength={QUOTATION_TEXT_LIMITS.shortText}
                value={projectReference}
                onChange={(e) => setProjectReference(e.target.value)}
                className={inputClass}
              />
            </div>
          </fieldset>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor={`${headingId}-delivery`}>{t('quotation.delivery.label')} — {t('quotation.delivery.amount')}</label>
              <input
                id={`${headingId}-delivery`}
                type="number"
                min={0}
                step="0.01"
                dir="ltr"
                value={deliveryDraft}
                onChange={(e) => setDeliveryDraft(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className={labelClass} htmlFor={`${headingId}-discount-mode`}>{t('quotation.discount.label')}</label>
                <select
                  id={`${headingId}-discount-mode`}
                  value={discountMode}
                  onChange={(e) => setDiscountMode(e.target.value as DiscountMode)}
                  className={inputClass}
                >
                  <option value="none">{t('quotation.discount.modeNone')}</option>
                  <option value="percentage">{t('quotation.discount.modePercentage')}</option>
                  <option value="fixed">{t('quotation.discount.modeFixed')}</option>
                </select>
              </div>
              {discountMode !== 'none' && (
                <div className="w-28">
                  <label className={labelClass} htmlFor={`${headingId}-discount-value`}>{t('quotation.discount.value')}</label>
                  <input
                    id={`${headingId}-discount-value`}
                    type="number"
                    min={0}
                    step="0.01"
                    dir="ltr"
                    value={discountDraft}
                    onChange={(e) => setDiscountDraft(e.target.value)}
                    className={inputClass}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-studio-field/60 border border-studio-border space-y-2">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={vatEnabled}
                onChange={(e) => setVatEnabled(e.target.checked)}
                className="rounded border-studio-border"
              />
              {t('quotation.vat.enable')}
            </label>
            {vatEnabled ? (
              <div className="w-28">
                <label className={labelClass} htmlFor={`${headingId}-vat-rate`}>{t('quotation.vat.rate')}</label>
                <input
                  id={`${headingId}-vat-rate`}
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  dir="ltr"
                  required
                  value={vatRateDraft}
                  onChange={(e) => setVatRateDraft(e.target.value)}
                  className={inputClass}
                />
              </div>
            ) : (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{t('quotation.vat.disabledNote')}</p>
            )}
          </div>

          <fieldset role="group" aria-label={t('quotation.outputLocale.label')} className="space-y-1.5">
            <legend className={labelClass}>{t('quotation.outputLocale.label')}</legend>
            <div className="flex gap-2">
              {(['fr', 'ar'] as const).map((loc) => (
                <button
                  key={loc}
                  type="button"
                  aria-pressed={outputLocale === loc}
                  onClick={() => setOutputLocale(loc)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    outputLocale === loc
                      ? 'bg-brand-400 border-brand-500 text-slate-950'
                      : 'bg-studio-field border-studio-border text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {t(loc === 'fr' ? 'quotation.outputLocale.fr' : 'quotation.outputLocale.ar')}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={includeAmountInWords}
              onChange={(e) => setIncludeAmountInWords(e.target.checked)}
              className="rounded border-studio-border"
            />
            {t('quotation.amountInWords')}
          </label>

          <div>
            <label className={labelClass} htmlFor={`${headingId}-logo`}>{t('quotation.logo.label')}</label>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-1.5">{t('quotation.logo.hint')}</p>
            <div className="flex items-center gap-2">
              <input
                ref={logoInputRef}
                id={`${headingId}-logo`}
                type="file"
                accept="image/png,image/jpeg"
                onChange={handleLogoChange}
                className="text-xs text-slate-600 dark:text-slate-300 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-studio-field file:text-slate-700 dark:file:text-slate-200 file:text-xs file:font-semibold"
              />
              {logoDataUrl && (
                <button
                  type="button"
                  onClick={handleRemoveLogo}
                  className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/10"
                  aria-label={t('quotation.logo.remove')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
            {logoFileName && !logoError && (
              <p className="text-[11px] text-emerald-500 mt-1 flex items-center gap-1"><Upload className="w-3 h-3" />{logoFileName}</p>
            )}
            {logoError && (
              <p role="alert" className="text-[11px] text-rose-400 mt-1">{t(logoError)}</p>
            )}
          </div>

          <div>
            <label className={labelClass} htmlFor={`${headingId}-notes`}>{t('quotation.fields.notes')}</label>
            <textarea
              id={`${headingId}-notes`}
              rows={3}
              maxLength={QUOTATION_TEXT_LIMITS.notesText}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputClass}
            />
          </div>

          <button
            type="submit"
            disabled={submitting || !!itemLimitError}
            className="w-full py-3 rounded-xl bg-brand-400 hover:bg-brand-500 text-slate-950 font-black text-sm flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {submitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            {submitting ? t('quotation.generating') : t('quotation.submit')}
          </button>
        </form>
      </div>
    </div>
  );
};
