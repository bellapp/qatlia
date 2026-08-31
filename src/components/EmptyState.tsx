'use client';

import React from 'react';
import { Camera, Scissors, FileText } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';

interface EmptyStateProps {
  type: 'ready' | 'loading' | 'no-results';
}

export function EmptyState({ type }: EmptyStateProps) {
  const { t } = useLocale();

  if (type === 'loading') {
    return (
      <div
        role="status"
        aria-label={t('emptyState.loadingAria')}
        className="p-16 rounded-3xl bg-studio-panel/30 border border-dashed border-studio-border/80 text-center flex flex-col items-center gap-6 min-h-[460px] justify-center"
      >
        <div className="relative w-16 h-16 rounded-2xl bg-studio-field border border-studio-border flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
        </div>
        <div className="space-y-2">
          <div className="h-4 w-48 bg-studio-field rounded animate-pulse mx-auto" />
          <div className="h-3 w-32 bg-studio-field rounded animate-pulse mx-auto" />
        </div>
      </div>
    );
  }

  if (type === 'no-results') {
    return (
      <div className="p-16 rounded-3xl bg-studio-panel/30 border border-dashed border-studio-border/80 text-center flex flex-col items-center gap-4 min-h-[460px] justify-center">
        <div className="w-16 h-16 rounded-2xl bg-studio-field border border-studio-border flex items-center justify-center">
          <Scissors className="w-7 h-7 text-slate-600" />
        </div>
        <div>
          <h3 className="text-base font-black text-slate-700 dark:text-slate-300 mb-1">{t('emptyState.noResultsTitle')}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs leading-relaxed">
            {t('emptyState.noResultsBody')}
          </p>
        </div>
      </div>
    );
  }

  const steps = [
    { icon: Camera, tone: 'bg-sky-500/10 border-sky-500/20', iconTone: 'text-sky-400', title: t('emptyState.step1'), desc: t('emptyState.step1Desc') },
    { icon: Scissors, tone: 'bg-brand-500/10 border-brand-500/20', iconTone: 'text-brand-400', title: t('emptyState.step2'), desc: t('emptyState.step2Desc') },
    { icon: FileText, tone: 'bg-emerald-500/10 border-emerald-500/20', iconTone: 'text-emerald-400', title: t('emptyState.step3'), desc: t('emptyState.step3Desc') },
  ];

  return (
    <div className="p-12 sm:p-16 rounded-3xl bg-studio-panel/30 border border-dashed border-studio-border/80 text-center flex flex-col items-center gap-5 min-h-[460px] justify-center">
      <div className="w-16 h-16 rounded-2xl bg-studio-field border border-studio-border flex items-center justify-center">
        <Scissors className="w-7 h-7 text-slate-600" />
      </div>
      <div className="space-y-2">
        <h3 className="text-base font-black text-slate-700 dark:text-slate-300">{t('emptyState.readyTitle')}</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm leading-relaxed">
          {t('emptyState.readyBody')}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        {steps.map(({ icon: Icon, tone, iconTone, title, desc }) => (
          <div
            key={title}
            className="flex items-center gap-2.5 p-3 rounded-xl bg-studio-panel/60 border border-studio-border text-start min-w-[200px]"
          >
            <span className={`shrink-0 w-8 h-8 rounded-lg border flex items-center justify-center ${tone}`}>
              <Icon className={`w-4 h-4 ${iconTone}`} />
            </span>
            <div>
              <p className="text-[10px] font-bold text-slate-900 dark:text-white">{title}</p>
              <p className="text-[9px] text-slate-500 dark:text-slate-400">{desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
