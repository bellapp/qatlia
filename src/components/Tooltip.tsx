'use client';

import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  text: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

const GAP = 8; // between the anchor and the bubble
const EDGE = 8; // minimum distance to the viewport edge

/**
 * The bubble is portalled to <body> with fixed coordinates: rendered in place,
 * an `overflow-hidden` ancestor (the advanced-options panel) clipped it, and a
 * long sentence on one line ran off the left of the screen. It now wraps,
 * stays inside the viewport, and flips to the other side when there is no room.
 */
export function Tooltip({ text, children, position = 'top' }: TooltipProps) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!anchor || !bubble) return;
    const { width, height } = bubble.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let side = position;
    if (side === 'top' && anchor.top - GAP - height < EDGE) side = 'bottom';
    else if (side === 'bottom' && anchor.bottom + GAP + height > vh - EDGE) side = 'top';
    else if (side === 'left' && anchor.left - GAP - width < EDGE) side = 'right';
    else if (side === 'right' && anchor.right + GAP + width > vw - EDGE) side = 'left';
    let left: number, top: number;
    if (side === 'top' || side === 'bottom') {
      left = anchor.left + anchor.width / 2 - width / 2;
      top = side === 'top' ? anchor.top - GAP - height : anchor.bottom + GAP;
    } else {
      left = side === 'left' ? anchor.left - GAP - width : anchor.right + GAP;
      top = anchor.top + anchor.height / 2 - height / 2;
    }
    setCoords({
      left: Math.min(Math.max(EDGE, left), vw - EDGE - width),
      top: Math.min(Math.max(EDGE, top), vh - EDGE - height),
    });
  }, [anchor, position, text]);

  const hide = () => { setAnchor(null); setCoords(null); };

  return (
    <div
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={() => setAnchor(ref.current?.getBoundingClientRect() ?? null)}
      onMouseLeave={hide}
    >
      {children}
      {anchor && createPortal(
        <div
          ref={bubbleRef}
          role="tooltip"
          className="fixed z-[100] pointer-events-none animate-in fade-in zoom-in-95 duration-100"
          style={coords ? { left: coords.left, top: coords.top } : { left: 0, top: 0, visibility: 'hidden' }}
        >
          <div className="w-max max-w-[280px] px-2.5 py-1.5 rounded-lg bg-studio-field border border-studio-border text-[11px] leading-snug text-slate-600 dark:text-slate-300 font-medium whitespace-normal shadow-lg shadow-black/10">
            {text}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
