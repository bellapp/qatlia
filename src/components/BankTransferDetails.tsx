'use client';

import React, { useState } from 'react';
import { Check, Copy, Landmark } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';

/** Same shape as src/lib/billing/bank-transfer.ts, which is server-only (it reads env vars). */
export interface BankTransferDetailsData {
  holder: string;
  bankName: string | null;
  rib: string;
  iban: string;
  bic: string;
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value.replace(/\s+/g, ''));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the value stays selectable */
    }
  };
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">{label}</p>
        <p dir="ltr" translate="no" className="font-mono text-sm font-bold text-white break-all select-all text-start">
          {value}
        </p>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={t('creditsPage.manual.bank.copyAria', { label })}
        className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md border border-white/15 text-[11px] font-bold text-slate-200 hover:border-[#F5A623]/60 hover:text-[#F5A623] transition-colors"
      >
        {copied ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
        {copied ? t('creditsPage.manual.bank.copied') : t('creditsPage.manual.bank.copy')}
      </button>
    </div>
  );
}

/** The account to pay into by transfer, shown only to a signed-in customer with an order to pay. */
export function BankTransferDetails({ bank }: { bank: BankTransferDetailsData }) {
  const { t } = useLocale();
  return (
    <section
      data-testid="bank-transfer-details"
      aria-label={t('creditsPage.manual.bank.title')}
      className="rounded-xl bg-black/30 border border-white/10 px-4 py-2"
    >
      <h3 className="flex items-center gap-2 pt-2 pb-1 text-xs font-black text-white">
        <Landmark className="w-4 h-4 text-[#F5A623]" aria-hidden="true" />
        {t('creditsPage.manual.bank.title')}
      </h3>
      <div className="divide-y divide-white/10">
        <div className="py-2">
          <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">{t('creditsPage.manual.bank.holder')}</p>
          <p translate="no" className="text-sm font-bold text-white">{bank.holder}</p>
          {bank.bankName && (
            <p translate="no" className="text-[11px] text-slate-400">{bank.bankName}</p>
          )}
        </div>
        <CopyRow label={t('creditsPage.manual.bank.rib')} value={bank.rib} />
        <CopyRow label={t('creditsPage.manual.bank.iban')} value={bank.iban} />
        <CopyRow label={t('creditsPage.manual.bank.bic')} value={bank.bic} />
      </div>
    </section>
  );
}
