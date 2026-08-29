'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ChevronDown, KeyRound, LogOut, Receipt, User } from 'lucide-react';

interface AccountMenuProps {
  email: string;
}

export function AccountMenu({ email }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
    router.refresh();
  };

  const initial = (email.split('@')[0] || 'A').slice(0, 1).toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 pl-1.5 pr-2 py-1 rounded-xl bg-studio-panel/80 hover:bg-slate-800 border border-studio-border text-left"
        aria-expanded={open}
      >
        <span className="w-7 h-7 rounded-lg bg-brand-500/15 text-brand-400 text-xs font-black flex items-center justify-center">
          {initial}
        </span>
        <span className="hidden sm:block text-xs text-slate-300 font-medium truncate max-w-[140px]">{email}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-studio-panel border border-studio-border shadow-2xl py-1.5 z-50">
          <div className="px-3 py-2 border-b border-studio-border">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Compte</p>
            <p className="text-xs text-slate-200 truncate mt-0.5">{email}</p>
          </div>
          <Link
            href="/account"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800/80"
          >
            <User className="w-3.5 h-3.5 text-brand-400" />
            Mon compte
          </Link>
          <Link
            href="/account#credits"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800/80"
          >
            <Receipt className="w-3.5 h-3.5 text-brand-400" />
            Usage des crédits
          </Link>
          <Link
            href="/account#password"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800/80"
          >
            <KeyRound className="w-3.5 h-3.5 text-brand-400" />
            Changer le mot de passe
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10"
          >
            <LogOut className="w-3.5 h-3.5" />
            Déconnexion
          </button>
        </div>
      )}
    </div>
  );
}
