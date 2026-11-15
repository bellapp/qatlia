'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';

/** Longest project name the history accepts (same limit as the server). */
const NAME_MAX_LENGTH = 120;

type HistoryNameProps = {
  name: string;
  /** Resolves true once the new name is saved, false when it was refused or
   *  could not be reached: the editor then stays open with the draft. */
  onRename: (name: string) => Promise<boolean>;
  size: 'card' | 'row';
};

export type RenameOutcome = 'noop' | 'saved' | 'failed';

/**
 * Decides what a rename attempt does: an empty or unchanged draft is nothing to
 * save (and never calls `onRename`); otherwise the trimmed name is sent, and a
 * refusal or an error both count as not saved.
 */
export async function resolveRename(
  draft: string,
  current: string,
  onRename: (name: string) => Promise<boolean>,
): Promise<RenameOutcome> {
  const next = draft.trim();
  if (!next || next === current) return 'noop';
  try {
    return (await onRename(next)) ? 'saved' : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * A project name with its rename control, shared by the cards and the table.
 *
 * The pencil is always visible except on devices that really hover, where it
 * appears on hover or keyboard focus: a phone has no hover to reveal it. While
 * editing, a tick and a cross sit beside the field so no keyboard is needed to
 * confirm or give up.
 */
export function HistoryName({ name, onRename, size }: HistoryNameProps) {
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const controlRef = useRef<HTMLDivElement>(null);
  // True only while the editor is open, so a blur caused by closing it (cancel,
  // or the field unmounting) can never save a draft that was abandoned.
  const activeRef = useRef(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const open = () => {
    activeRef.current = true;
    setDraft(name);
    setFailed(false);
    setEditing(true);
  };

  const close = () => {
    activeRef.current = false;
    setFailed(false);
    setEditing(false);
  };

  const cancel = () => {
    if (savingRef.current) return;
    close();
  };

  const commit = async () => {
    if (!activeRef.current || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setFailed(false);
    const outcome = await resolveRename(draft, name, onRename);
    savingRef.current = false;
    setSaving(false);
    if (outcome === 'failed') setFailed(true);
    else close();
  };

  const nameClass = size === 'card'
    ? 'text-base font-black text-slate-900 dark:text-white'
    : 'text-sm font-semibold text-slate-900 dark:text-white';

  if (!editing) {
    return (
      <div className="group flex items-center gap-1.5 min-w-0">
        <span className={`truncate ${nameClass}`} dir="auto">{name}</span>
        <button
          type="button"
          onClick={open}
          aria-label={t('historyPage.renameAria', { name })}
          data-testid="history-rename-btn"
          className="shrink-0 w-10 h-10 [@media(pointer:fine)]:w-8 [@media(pointer:fine)]:h-8 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-brand-500 dark:hover:text-brand-400 hover:bg-studio-field focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 transition-all [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
        >
          <Pencil className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div ref={controlRef} className="min-w-0 space-y-1">
      <div className="flex items-center gap-1 min-w-0">
        <input
          ref={inputRef}
          value={draft}
          maxLength={NAME_MAX_LENGTH}
          readOnly={saving}
          dir="auto"
          onChange={(e) => { setDraft(e.target.value); setFailed(false); }}
          onBlur={(e) => {
            // Focus moving to the tick or the cross is not "leaving the field":
            // that button's own click decides, so Cancel can never save.
            const to = e.relatedTarget;
            if (to instanceof Node && controlRef.current?.contains(to)) return;
            void commit();
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') { e.preventDefault(); void commit(); }
            if (e.key === 'Escape') cancel();
          }}
          aria-label={t('historyPage.renameAria', { name })}
          aria-invalid={failed || undefined}
          data-testid="history-rename-input"
          className={`flex-1 min-w-0 bg-transparent text-start outline-none border-b border-brand-500/50 pb-0.5 ${nameClass}`}
        />
        <button
          type="button"
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void commit()}
          disabled={saving}
          aria-label={t('historyPage.renameSave')}
          data-testid="history-rename-save"
          className="shrink-0 w-10 h-10 [@media(pointer:fine)]:w-8 [@media(pointer:fine)]:h-8 rounded-lg flex items-center justify-center text-brand-600 dark:text-brand-400 hover:bg-studio-field disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 transition-all"
        >
          <Check className="w-4 h-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={cancel}
          disabled={saving}
          aria-label={t('historyPage.renameCancel')}
          data-testid="history-rename-cancel"
          className="shrink-0 w-10 h-10 [@media(pointer:fine)]:w-8 [@media(pointer:fine)]:h-8 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-studio-field disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 transition-all"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      {failed && (
        <p role="alert" data-testid="history-rename-error" className="text-xs font-semibold text-red-600 dark:text-red-400">
          {t('historyPage.renameFailed')}
        </p>
      )}
    </div>
  );
}
