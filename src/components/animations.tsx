'use client';

import { useEffect, useRef, type JSX } from 'react';

export function useAnimateOnMount(delay = 0) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const timer = setTimeout(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    }, delay);
    return () => clearTimeout(timer);
  }, [delay]);
  return ref;
}

export function FadeIn({
  children,
  delay = 0,
  className = '',
}: {
  children: JSX.Element | JSX.Element[];
  delay?: number;
  className?: string;
}) {
  return (
    <div
      ref={useAnimateOnMount(delay)}
      className={className}
      style={{ opacity: 0, transform: 'translateY(8px)', transition: 'opacity 0.35s ease-out, transform 0.35s ease-out' }}
    >
      {children}
    </div>
  );
}