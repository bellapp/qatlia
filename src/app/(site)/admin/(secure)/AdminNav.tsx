'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/admin', label: 'Vue d’ensemble', match: (path: string) => path === '/admin' },
  { href: '/admin/clients', label: 'Clients', match: (path: string) => path.startsWith('/admin/clients') },
  { href: '/admin/paiements', label: 'Paiements', match: (path: string) => path.startsWith('/admin/paiements') },
];

export function AdminNav() {
  const pathname = usePathname() || '';
  return (
    <nav aria-label="Back office" className="flex flex-wrap gap-1.5">
      {ITEMS.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider transition-colors ${
              active ? 'bg-amber-500 text-black' : 'bg-white/5 border border-white/10 text-slate-400 hover:text-slate-200'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
