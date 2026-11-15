'use client';

import { LayoutGrid, Rows3, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';
import type { HistoryView } from '@/lib/projects/history-row';

const VIEWS: ReadonlyArray<{ view: HistoryView; icon: LucideIcon; label: 'historyPage.view.cards' | 'historyPage.view.table' }> = [
  { view: 'cards', icon: LayoutGrid, label: 'historyPage.view.cards' },
  { view: 'table', icon: Rows3, label: 'historyPage.view.table' },
];

/** Two icon buttons, cards or table; the one showing is pressed. */
export function HistoryViewToggle({ view, onChange }: { view: HistoryView; onChange: (view: HistoryView) => void }) {
  const { t } = useLocale();
  return (
    <div
      role="group"
      aria-label={t('historyPage.view.label')}
      className="shrink-0 inline-flex items-center gap-0.5 p-0.5 rounded-xl bg-studio-field/60 border border-studio-border/80"
    >
      {VIEWS.map(({ view: option, icon: Icon, label }) => {
        const pressed = option === view;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-label={t(label)}
            aria-pressed={pressed}
            title={t(label)}
            data-testid={`history-view-${option}`}
            className={`w-10 h-10 inline-flex items-center justify-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 transition-colors ${
              pressed
                ? 'bg-white dark:bg-studio-panel text-brand-600 dark:text-brand-400 shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <Icon className="w-4 h-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
