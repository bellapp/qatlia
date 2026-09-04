'use client';

/**
 * Operator back office for manual payment orders (paiement manuel).
 *
 * The operator secret (ADMIN_PANEL_SECRET) is entered once per device and kept
 * in sessionStorage — it guards every call as a Bearer header and never leaves
 * the browser except to the app's own admin API. No Supabase login: this page
 * is the merchant's own tool, deliberately outside the customer auth model.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';

interface ManualOrder {
  order_number: string;
  user_id: string;
  pack_id: string;
  amount_mad: number;
  credits: number;
  status: string;
  method: string;
  payment_reference: string | null;
  created_at: string;
  decided_at: string | null;
}

const STATUS_FILTERS = ['pending', 'paid', 'granted', 'refused', 'all'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  paid: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  granted: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  refused: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  expired: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'En attente',
  paid: 'Payée (à créditer)',
  granted: 'Crédits ajoutés',
  refused: 'Refusée',
  expired: 'Expirée',
};

const PACK_LABELS: Record<string, string> = {
  starter: 'Découverte',
  standard: 'Artisan',
  pro: 'Atelier Pro',
  atelier_max: 'Atelier Max',
};

export default function AdminPage() {
  const [secret, setSecret] = useState<string | null>(null);
  const [secretInput, setSecretInput] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [orders, setOrders] = useState<ManualOrder[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyOrder, setBusyOrder] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // session persistence: the secret survives reloads on this device only.
  useEffect(() => {
    const stored = window.sessionStorage.getItem('qatlia_admin_secret');
    if (stored) setSecret(stored);
  }, []);

  const fetchOrders = useCallback(
    async (activeSecret: string, filter: StatusFilter) => {
      setLoading(true);
      setActionError(null);
      try {
        const qs = filter === 'all' ? '' : `?status=${filter}`;
        const res = await fetch(`/api/credits/manual/admin${qs}`, {
          headers: { Authorization: `Bearer ${activeSecret}` },
        });
        if (res.status === 401) {
          window.sessionStorage.removeItem('qatlia_admin_secret');
          setSecret(null);
          setLoginError('Code secret invalide ou expiré.');
          return;
        }
        const data = await res.json();
        if (res.ok && data.success) {
          setOrders(data.payments || []);
          setLastRefresh(new Date());
        } else {
          setActionError('Impossible de charger les commandes.');
        }
      } catch {
        setActionError('Erreur réseau — vérifiez votre connexion.');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Initial + filter-driven fetch.
  useEffect(() => {
    if (secret) fetchOrders(secret, statusFilter);
  }, [secret, statusFilter, fetchOrders]);

  // Auto-refresh while open: pending orders want a live view.
  useEffect(() => {
    if (!secret) return;
    const id = window.setInterval(() => fetchOrders(secret, statusFilter), 30_000);
    return () => window.clearInterval(id);
  }, [secret, statusFilter, fetchOrders]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = secretInput.trim();
    if (!trimmed) return;
    setLoggingIn(true);
    setLoginError(null);
    try {
      const res = await fetch('/api/credits/manual/admin?status=pending', {
        headers: { Authorization: `Bearer ${trimmed}` },
      });
      if (res.status === 401) {
        setLoginError('Code secret invalide.');
        return;
      }
      const data = await res.json();
      if (res.ok && data.success) {
        window.sessionStorage.setItem('qatlia_admin_secret', trimmed);
        setSecret(trimmed);
      } else {
        setLoginError('Accès refusé — config serveur manquante.');
      }
    } catch {
      setLoginError('Erreur réseau.');
    } finally {
      setLoggingIn(false);
    }
  };

  const decide = async (orderNumber: string, decision: 'grant' | 'refuse') => {
    if (!secret) return;
    setBusyOrder(orderNumber);
    setActionError(null);
    try {
      const res = await fetch('/api/credits/manual/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ order_number: orderNumber, decision }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setOrders((prev) =>
          prev.map((o) =>
            o.order_number === orderNumber
              ? { ...o, status: data.status || (decision === 'grant' ? 'granted' : 'refused') }
              : o,
          ),
        );
      } else if (res.status === 409) {
        setActionError(`${orderNumber} : déjà traitée — liste rafraîchie.`);
        fetchOrders(secret, statusFilter);
      } else {
        setActionError(data?.message || `Échec de la décision sur ${orderNumber}.`);
      }
    } catch {
      setActionError('Erreur réseau — la décision n’est pas passée.');
    } finally {
      setBusyOrder(null);
    }
  };

  const logout = () => {
    window.sessionStorage.removeItem('qatlia_admin_secret');
    setSecret(null);
    setOrders([]);
  };

  const fmtDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  const filtered = orders.filter((o) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      o.order_number.toLowerCase().includes(q) ||
      o.user_id.toLowerCase().includes(q) ||
      (o.payment_reference || '').toLowerCase().includes(q) ||
      o.pack_id.toLowerCase().includes(q)
    );
  });

  /* ── Login gate ─────────────────────────────────────────── */
  if (!secret) {
    return (
      <div className="min-h-screen bg-[#0B1220] text-slate-200 font-sans antialiased flex items-center justify-center p-6">
        <form onSubmit={handleLogin} className="w-full max-w-sm space-y-5">
          <div className="text-center space-y-2">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
              <Lock className="w-5 h-5 text-amber-400" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-black text-white">QatlIA — Back office</h1>
            <p className="text-xs text-slate-400">Validation des paiements manuels</p>
          </div>

          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Code secret admin</span>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-500 absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
              <input
                type={showSecret ? 'text' : 'password'}
                value={secretInput}
                onChange={(e) => setSecretInput(e.target.value)}
                autoComplete="off"
                autoFocus
                className="w-full ps-9 pe-9 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-100 text-sm font-mono outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20 transition-all"
                placeholder="ADMIN_PANEL_SECRET"
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                aria-label={showSecret ? 'Masquer le code' : 'Afficher le code'}
                className="absolute end-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
              >
                {showSecret ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
              </button>
            </div>
          </label>

          {loginError && (
            <p role="alert" className="text-xs font-semibold text-rose-400 text-center">{loginError}</p>
          )}

          <button
            type="submit"
            disabled={loggingIn || !secretInput.trim()}
            className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-black text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2"
          >
            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
            {loggingIn ? 'Vérification…' : 'Déverrouiller'}
          </button>

          <Link href="/" className="block text-center text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
            ← Retour au site
          </Link>
        </form>
      </div>
    );
  }

  /* ── Dashboard ──────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-[#0B1220] text-slate-200 font-sans antialiased p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-300 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" aria-hidden="true" />
              Site
            </Link>
            <h1 className="text-lg font-black text-white">Commandes de paiement</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchOrders(secret, statusFilter)}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-bold text-slate-300 hover:bg-white/10 transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Actualiser
            </button>
            <button
              onClick={logout}
              className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs font-bold text-slate-400 hover:text-rose-400 hover:border-rose-500/30 transition-colors"
            >
              Verrouiller
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              aria-pressed={statusFilter === s}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all ${
                statusFilter === s
                  ? 'bg-amber-500 text-black'
                  : 'bg-white/5 border border-white/10 text-slate-400 hover:text-slate-200'
              }`}
            >
              {s === 'all' ? 'Toutes' : STATUS_LABELS[s]}
            </button>
          ))}
          <div className="relative flex-1 min-w-[180px] ms-auto">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute start-2.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher (n° commande, user, référence…)"
              className="w-full ps-8 pe-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 outline-none focus:border-amber-500/40 transition-colors"
            />
          </div>
        </div>

        {lastRefresh && (
          <p className="text-[10px] text-slate-500" aria-live="polite">
            Actualisé à {lastRefresh.toLocaleTimeString('fr-FR')} — rafraîchissement auto toutes les 30 s
          </p>
        )}

        {actionError && (
          <p role="alert" className="text-xs font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
            {actionError}
          </p>
        )}

        {/* Orders list */}
        {filtered.length === 0 && !loading ? (
          <div className="text-center py-16 space-y-2">
            <p className="text-sm font-bold text-slate-400">Aucune commande {statusFilter !== 'all' ? STATUS_LABELS[statusFilter].toLowerCase() : ''}</p>
            <p className="text-xs text-slate-500">Les nouvelles commandes apparaissent ici automatiquement.</p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {filtered.map((o) => (
              <li
                key={o.order_number}
                className="rounded-2xl bg-white/[0.03] border border-white/10 p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span dir="ltr" className="font-mono font-black text-sm text-amber-400 tracking-wider">
                      {o.order_number}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${STATUS_STYLES[o.status] || STATUS_STYLES.expired}`}>
                      {STATUS_LABELS[o.status] || o.status}
                    </span>
                  </div>
                  <span dir="ltr" className="font-mono text-sm font-bold text-slate-200">
                    {o.amount_mad.toFixed(2)} MAD · <span className="text-slate-400">{o.credits} cr</span>
                  </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-[11px] text-slate-400">
                  <span>
                    Pack : <strong className="text-slate-200">{PACK_LABELS[o.pack_id] || o.pack_id}</strong>
                  </span>
                  <span>
                    Méthode : <strong className="text-slate-200">{o.method}</strong>
                  </span>
                  <span>
                    Créée : <strong className="text-slate-200">{fmtDate(o.created_at)}</strong>
                  </span>
                  {o.decided_at && (
                    <span>
                      Décision : <strong className="text-slate-200">{fmtDate(o.decided_at)}</strong>
                    </span>
                  )}
                  <span className="col-span-2 md:col-span-4 truncate">
                    User : <span className="font-mono text-slate-300">{o.user_id}</span>
                  </span>
                  {o.payment_reference && (
                    <span className="col-span-2 md:col-span-4 truncate">
                      Référence paiement : <strong className="text-slate-200">{o.payment_reference}</strong>
                    </span>
                  )}
                </div>

                {o.status === 'pending' && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={() => decide(o.order_number, 'grant')}
                      disabled={busyOrder === o.order_number}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-[11px] font-black uppercase tracking-wider transition-all"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                      {busyOrder === o.order_number ? '…' : 'Valider — créditer'}
                    </button>
                    <button
                      onClick={() => decide(o.order_number, 'refuse')}
                      disabled={busyOrder === o.order_number}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/5 border border-rose-500/30 hover:bg-rose-500/10 disabled:opacity-40 text-rose-400 text-[11px] font-black uppercase tracking-wider transition-all"
                    >
                      <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                      Refuser
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
