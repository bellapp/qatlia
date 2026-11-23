'use client';

import React from 'react';
import { ExternalLink } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';
import type { CompanyIdentity } from '@/lib/quotation';

/**
 * The artisan's own business as the quote will print it, read-only. Shown in
 * the quote dialog when the account already has its business, so its fields
 * are never mistaken for the client's. Changes happen on the account page.
 */
export function QuotationCompanyCard({ company, logoDataUrl }: { company: CompanyIdentity; logoDataUrl?: string }) {
  const { t } = useLocale();
  const ids = [company.ice && `ICE ${company.ice}`, company.taxId && `IF ${company.taxId}`].filter(Boolean).join(' · ');
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-studio-field border border-studio-border">
      {logoDataUrl && (
        // A data: URL, nothing for next/image to optimise.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoDataUrl}
          alt=""
          className="h-12 w-12 shrink-0 object-contain rounded-md bg-white border border-studio-border p-0.5"
        />
      )}
      <div className="min-w-0 flex-1 space-y-0.5 text-xs text-slate-600 dark:text-slate-400">
        <p className="text-sm font-bold text-slate-900 dark:text-white break-words">{company.name}</p>
        {company.phone && <p dir="ltr" className="text-start">{company.phone}</p>}
        {company.address && <p className="break-words">{company.address}</p>}
        {company.email && <p dir="ltr" className="text-start break-all">{company.email}</p>}
        {ids && <p dir="ltr" className="text-start">{ids}</p>}
        <p className="pt-1 text-[11px] text-slate-500 dark:text-slate-400">{t('quotation.companyCardHint')}</p>
        <a
          href="/account#entreprise"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 pt-1 font-semibold text-brand-600 dark:text-brand-400 underline-offset-2 hover:underline"
        >
          {t('quotation.editBusiness')}
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
