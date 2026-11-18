'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { History, Layers, Scissors, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';
import type { TranslationKey } from '@/i18n';

export type WorkspaceScreen = 'atelier' | 'history' | 'panels';

interface WorkspaceEntry {
  screen: WorkspaceScreen;
  href: string;
  label: TranslationKey;
  /** Shown instead of `label` under 640 px, so the bar holds on one line. */
  shortLabel: TranslationKey;
}

/** The screens of the app, in the order the bar shows them. */
export const WORKSPACE_ENTRIES: ReadonlyArray<WorkspaceEntry> = [
  { screen: 'atelier', href: '/atelier', label: 'workspaceNav.atelier', shortLabel: 'workspaceNav.atelierShort' },
  { screen: 'history', href: '/history', label: 'workspaceNav.history', shortLabel: 'workspaceNav.historyShort' },
];

const ICONS: Record<WorkspaceScreen, LucideIcon> = {
  atelier: Scissors,
  history: History,
  panels: Layers,
};

interface WorkspaceNavProps {
  current: WorkspaceScreen;
  /** Classes of the row's container: the page's own max width and side padding. */
  className?: string;
  /** Trailing slot, pushed to the end of the row (the atelier's machine figures). */
  children?: ReactNode;
  /**
   * A cut list is being read or a plan computed: leaving now would lose what
   * was paid for, so the other screens show without leading anywhere.
   */
  busy?: boolean;
}

/**
 * The bar under the header, the same on every screen of the app. It only leads
 * from one screen to another: what acts on the job on display stays in the page.
 * It sticks under the header (h-16 = top-16) and is the only element allowed
 * to scroll sideways on a narrow screen.
 */
export function WorkspaceNav({ current, className, children, busy = false }: WorkspaceNavProps) {
  const { t } = useLocale();

  return (
    <nav
      aria-label={t('workspaceNav.aria')}
      className="sticky top-16 z-30 border-b border-studio-border bg-studio-canvas/85 backdrop-blur-xl"
    >
      <div className={className}>
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain py-1.5">
          {WORKSPACE_ENTRIES.map((entry) => {
            const Icon = ICONS[entry.screen];
            const isCurrent = entry.screen === current;
            const labels = (
              <>
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">{t(entry.label)}</span>
                <span className="sm:hidden">{t(entry.shortLabel)}</span>
              </>
            );
            if (busy && !isCurrent) {
              return (
                <span
                  key={entry.screen}
                  aria-disabled="true"
                  title={t('workspaceNav.busy')}
                  className="inline-flex min-h-10 shrink-0 items-center gap-2 px-3 rounded-lg text-xs font-bold text-slate-400 dark:text-slate-500 cursor-wait"
                >
                  {labels}
                </span>
              );
            }
            return (
              <Link
                key={entry.screen}
                href={entry.href}
                aria-current={isCurrent ? 'page' : undefined}
                className={`inline-flex min-h-10 shrink-0 items-center gap-2 px-3 rounded-lg text-xs font-bold transition-colors ${
                  isCurrent
                    ? 'bg-brand-400/10 text-brand-500 dark:text-brand-400'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-studio-panel hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {labels}
              </Link>
            );
          })}
          {children ? <div className="ms-auto flex shrink-0 items-center gap-2 ps-3">{children}</div> : null}
        </div>
      </div>
    </nav>
  );
}
