'use client';

import { useEffect, useState } from 'react';

export function TopProgressBar() {
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let animFrame: number;
    let progress = 0;
    let running = false;

    const start = () => {
      if (running) return;
      running = true;
      progress = 0;
      setWidth(0);
      setVisible(true);
      const tick = () => {
        progress += (95 - progress) * 0.08;
        setWidth(progress);
        if (progress < 94) animFrame = requestAnimationFrame(tick);
      };
      animFrame = requestAnimationFrame(tick);
    };

    const done = () => {
      running = false;
      cancelAnimationFrame(animFrame);
      setWidth(100);
      timer = setTimeout(() => {
        setVisible(false);
        setWidth(0);
      }, 300);
    };

    const origFetch = window.fetch.bind(window);
    window.fetch = function (...args: Parameters<typeof fetch>) {
      start();
      const p = origFetch.apply(window, args);
      p.then(done).catch(done);
      return p;
    };

    return () => {
      window.fetch = origFetch;
      clearTimeout(timer);
      cancelAnimationFrame(animFrame);
    };
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-[2px] pointer-events-none">
      <div
        className="h-full bg-brand-400 transition-all duration-150 ease-out"
        style={{ width: `${width}%`, boxShadow: '0 0 6px 1px rgba(245,166,35,0.5)' }}
      />
    </div>
  );
}