/**
 * Small presentational pieces shared by the back office pages.
 * French only: the back office is the merchant's own tool (plan 2026-11-12).
 */

import type { ReactNode } from 'react';

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-white/[0.03] border border-white/10 p-4 md:p-5 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-black uppercase tracking-wider text-slate-300">{title}</h2>
        {aside ? <div className="text-[11px] text-slate-500">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'warn' | 'good' }) {
  const color = tone === 'warn' ? 'text-amber-400' : tone === 'good' ? 'text-emerald-400' : 'text-white';
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2.5 min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`text-lg font-black tabular-nums ${color} truncate`}>{value}</div>
      {hint ? <div className="text-[11px] text-slate-500 break-words">{hint}</div> : null}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-200 break-words">{children}</dd>
    </div>
  );
}

export function Badge({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${className}`}>{children}</span>;
}

export function Notice({ tone, children }: { tone: 'error' | 'warn' | 'info'; children: ReactNode }) {
  const styles = {
    error: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
    warn: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
    info: 'text-slate-300 bg-white/5 border-white/10',
  }[tone];
  return (
    <p role={tone === 'error' ? 'alert' : undefined} className={`text-xs font-semibold border rounded-lg px-3 py-2 ${styles}`}>
      {children}
    </p>
  );
}

/** Shown when a page reads an object a migration creates and that migration is not applied yet. */
export function MigrationBanner({ migration }: { migration: string }) {
  return (
    <Notice tone="warn">
      Migration {migration} non appliquée. Exécutez supabase/migrations/{migration}_*.sql dans l’éditeur SQL de Supabase, puis rechargez la page.
    </Notice>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-6 text-center text-xs text-slate-500">
        {children}
      </td>
    </tr>
  );
}

export const th = 'px-2 py-2 text-start text-[10px] font-bold uppercase tracking-widest text-slate-500 whitespace-nowrap';
export const td = 'px-2 py-2 align-top text-xs text-slate-300';
