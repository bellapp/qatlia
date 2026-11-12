'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/admin/clients', label: 'Clients', match: (path: string) => path.startsWith('/admin/clients') },
  // Lot 1: manual orders are still validated on the secret-code page at /admin.
  { href: '/admin', label: 'Commandes manuelles', match: (path: string) => path === '/admin' },
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
