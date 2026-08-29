'use client';

import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggle } = useTheme();

  return (
    <button
      type="button"
      onClick={toggle}
      className={`p-2 rounded-xl border transition-all active:scale-95 ${
        theme === 'dark'
          ? 'bg-studio-field border-studio-border text-brand-400 hover:bg-studio-border'
          : 'bg-studio-field border-studio-border text-brand-500 hover:bg-studio-border-hover'
      } ${className}`}
      aria-label={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
      title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
    >
      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}