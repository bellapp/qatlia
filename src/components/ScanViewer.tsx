'use client';

import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { useLocale } from '@/components/LocaleProvider';
import { resolveScanView, scanViewNeedsFetch, type ScanViewInput } from '@/lib/projects/scan-upload';

export interface ScanViewerProps {
  src: string;
  /** Only the thumbnail could be shown: the viewer says so. */
  reduced: boolean;
  alt: string;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled])';

/**
 * The scan image of a project, full size, over the page. It scrolls and lets
 * a pinch zoom it on a phone, and is never cropped. It closes with Escape, its
 * button, or a tap outside the image, and gives the focus back to what opened
 * it. A full image reached by a link can also be opened in a new tab; an image
 * held in memory (a `data:` URL) cannot be opened as a page.
 */
export function ScanViewer({ src, reduced, alt, onClose }: ScanViewerProps) {
  const { t } = useLocale();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      // The focus stays in the viewer while it is open.
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  /** A tap on the backdrop (not on the image, not on a control) closes. */
  const closeOnBackdrop = (event: MouseEvent<HTMLElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  const openable = !reduced && !src.startsWith('data:');

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="scan-viewer"
      className="fixed inset-0 z-[60] flex flex-col bg-slate-950/95 text-white"
    >
      <div onClick={closeOnBackdrop} className="shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2 border-b border-white/10">
        <h2 id={titleId} className="flex-1 min-w-0 truncate text-sm font-bold">{t('scanViewer.title')}</h2>
        {openable && (
          <a
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="scan-viewer-open"
            className="shrink-0 inline-flex items-center gap-1.5 min-h-10 px-3 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 transition-colors"
          >
            <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
            {t('scanViewer.openImage')}
          </a>
        )}
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t('scanViewer.close')}
          data-testid="scan-viewer-close"
          className="w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 transition-colors"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>
      {reduced && (
        <p className="shrink-0 px-3 sm:px-4 py-2 text-xs text-amber-200 bg-amber-500/10 border-b border-amber-400/20">
          {t('scanViewer.reducedNote')}
        </p>
      )}
      {/* Scrolls both ways; one finger pans, two fingers zoom. */}
      <div
        onClick={closeOnBackdrop}
        data-testid="scan-viewer-area"
        className="flex-1 min-h-0 overflow-auto overscroll-contain touch-pan-x touch-pan-y touch-pinch-zoom"
      >
        <div onClick={closeOnBackdrop} className="min-h-full flex items-center justify-center p-3 sm:p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="block max-w-full h-auto rounded-lg shadow-2xl bg-white" />
        </div>
      </div>
    </div>
  );
}

/**
 * What a page needs to show a scan: the viewer's content, the key of the
 * button waiting for a signed link, and `show`, which ignores a second tap
 * while a link is on its way.
 */
export function useScanViewer() {
  const [view, setView] = useState<(Omit<ScanViewerProps, 'onClose'>) | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const busyRef = useRef(false);

  const show = async (key: string, input: ScanViewInput, alt: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const needsFetch = scanViewNeedsFetch(input);
    if (needsFetch) setPendingKey(key);
    try {
      const source = await resolveScanView(input, (url, init) => fetch(url, init));
      if (source) setView({ ...source, alt });
    } finally {
      busyRef.current = false;
      if (needsFetch) setPendingKey(null);
    }
  };

  return { view, pendingKey, show, close: () => setView(null) };
}
