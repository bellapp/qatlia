import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { requireAdminPage } from '@/lib/admin/auth';
import { AdminNav } from './AdminNav';

/**
 * Shell of the account-protected back office. Every page under (secure)
 * also guards itself, so its data is never read for a non-admin even if the
 * layout and the page render in parallel.
 */
export const dynamic = 'force-dynamic';

export default async function SecureAdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminPage('/admin');

  return (
    <div className="min-h-screen bg-[#0B1220] text-slate-200 font-sans antialiased px-4 py-5 md:px-8 md:py-8">
      <div className="max-w-6xl mx-auto space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-300 transition-colors">
              <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" aria-hidden="true" />
              Site
            </Link>
            <span className="flex items-center gap-1.5 text-base font-black text-white">
              <ShieldCheck className="w-4 h-4 text-amber-400" aria-hidden="true" />
              QatliA — Back office
            </span>
          </div>
          <span className="text-[11px] text-slate-500 truncate max-w-full">{admin.email}</span>
        </header>
        <AdminNav />
        <main className="space-y-5">{children}</main>
      </div>
    </div>
  );
}
