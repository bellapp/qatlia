'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { ArrowRight, Lock, Mail, User, Eye, EyeOff, Gift, ShieldCheck, Scissors } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { QatlIALogo } from '@/components/QatlIALogo';

function GoogleMark() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden>
      <path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.4 1 3.5 3.6 1.6 7.4l3.7 2.9C6.2 7.4 8.9 5 12 5z" />
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z" />
      <path fill="#FBBC05" d="M5.3 14.7c-.2-.7-.4-1.4-.4-2.2s.2-1.5.4-2.2L1.6 7.4C.6 9.4 0 11.6 0 14.5s.6 5.1 1.6 7.1l3.7-2.9z" />
      <path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3.1 0-5.8-2.4-6.7-5.3L1.6 16c1.9 3.8 5.8 7 10.4 7z" />
    </svg>
  );
}

function AuthForm() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams?.get('redirect') || '/atelier';

  useEffect(() => {
    async function checkUser() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) router.push(redirectTo);
    }
    checkUser();
  }, [redirectTo, router]);

  const handleOAuthGoogle = async () => {
    setOauthLoading(true);
    setErrorMsg(null);
    const supabase = createClient();
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://qatlia.vercel.app';
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${origin}/auth/callback?redirect=${encodeURIComponent(redirectTo)}` },
      });
      if (error) throw error;
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur lors de la connexion avec Google');
      setOauthLoading(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    const supabase = createClient();

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push(redirectTo);
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) throw error;
        if (data.session) {
          router.push(redirectTo);
          router.refresh();
        } else {
          setSuccessMsg('Compte créé. Vérifiez votre email, puis reconnectez-vous.');
          setIsLogin(true);
        }
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-studio-canvas text-slate-900 dark:text-slate-100 font-sans antialiased grid lg:grid-cols-2">
      <aside className="hidden lg:flex flex-col justify-between p-12 border-r border-studio-border/80 bg-[radial-gradient(1200px_circle_at_0%_0%,rgba(245,166,35,0.12),transparent_45%)]">
        <div className="flex items-center gap-3">
          <div className="text-brand-400"><QatlIALogo size="lg" /></div>
          <div>
            <p className="font-display font-extrabold text-lg tracking-tight">QatlIA</p>
            <p className="text-[11px] text-slate-600 dark:text-slate-400">Atelier de calepinage</p>
          </div>
        </div>

        <div className="space-y-8 max-w-md">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-400/80">Compte artisan</p>
            <h2 className="text-4xl font-black leading-tight mt-2">Vos plans de coupe, synchronisés.</h2>
            <p className="text-slate-600 dark:text-slate-400 mt-3 text-sm leading-relaxed">
              Historique des débits, crédits Vision IA, export PDF industriel. Un compte, tous vos ateliers.
            </p>
          </div>
          <ul className="space-y-3 text-sm">
            {[
              { icon: Gift, label: '5 crédits offerts à l’inscription' },
              { icon: Scissors, label: 'Historique de chaque plan généré' },
              { icon: ShieldCheck, label: 'Connexion Google ou email sécurisée' },
            ].map((item) => (
              <li key={item.label} className="flex items-center gap-3 text-slate-700 dark:text-slate-300">
                <span className="w-8 h-8 rounded-lg bg-studio-panel border border-studio-border flex items-center justify-center text-brand-400">
                  <item.icon className="w-4 h-4" />
                </span>
                {item.label}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[11px] text-slate-600">QatlIA Pro · Maroc · MAD</p>
      </aside>

      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-[420px] space-y-6">
          <div className="lg:hidden flex items-center gap-3">
            <div className="text-brand-400"><QatlIALogo size="sm" /></div>
            <span className="font-display font-extrabold">QatlIA</span>
          </div>

          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white">{isLogin ? 'Connexion' : 'Créer un compte'}</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              {isLogin ? 'Retrouvez vos débits et crédits.' : '5 crédits offerts pour lancer vos premiers scans.'}
            </p>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium">{errorMsg}</div>
          )}
          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-medium">{successMsg}</div>
          )}

          <button
            type="button"
            onClick={handleOAuthGoogle}
            disabled={oauthLoading || loading}
            className="w-full py-3 px-4 rounded-xl bg-white dark:bg-studio-field hover:bg-slate-100 text-slate-900 font-semibold text-sm flex items-center justify-center gap-3 disabled:opacity-50"
          >
            <GoogleMark />
            {oauthLoading ? 'Redirection Google…' : 'Continuer avec Google'}
          </button>

          <div className="relative flex items-center">
            <div className="border-t border-studio-border w-full" />
            <span className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-studio-canvas">ou email</span>
          </div>

          <form onSubmit={handleAuth} className="space-y-3.5">
            {!isLogin && (
              <label className="block">
                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Nom d’atelier</span>
                <div className="relative mt-1">
                  <User className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute left-3 top-3" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Menuiserie Atlas"
                    className="w-full bg-studio-field border border-studio-border rounded-xl pl-9 pr-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-600 focus:border-brand-500/50 outline-none"
                  />
                </div>
              </label>
            )}
            <label className="block">
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Email</span>
              <div className="relative mt-1">
                <Mail className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute left-3 top-3" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="artisan@atelier.ma"
                  className="w-full bg-studio-field border border-studio-border rounded-xl pl-9 pr-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-600 focus:border-brand-500/50 outline-none"
                />
              </div>
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">Mot de passe</span>
              <div className="relative mt-1">
                <Lock className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute left-3 top-3" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-studio-field border border-studio-border rounded-xl pl-9 pr-10 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-600 focus:border-brand-500/50 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-300"
                  aria-label={showPassword ? 'Masquer' : 'Afficher'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </label>

            <button
              type="submit"
              disabled={loading || oauthLoading}
              className="w-full py-3.5 rounded-xl bg-brand-500 hover:bg-brand-400 text-slate-950 font-black text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isLogin ? 'Se connecter' : 'Créer le compte'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <button
            type="button"
            onClick={() => {
              setIsLogin(!isLogin);
              setErrorMsg(null);
              setSuccessMsg(null);
            }}
            className="w-full text-center text-sm text-brand-400 hover:text-brand-400 font-semibold"
          >
            {isLogin ? 'Pas de compte ? Créer un compte (+ 5 crédits)' : 'Déjà un compte ? Se connecter'}
          </button>

          <p className="text-center text-[11px] text-slate-600">
            <Link href="/atelier" className="hover:text-slate-600 dark:text-slate-400">
              Retour à l’atelier
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-studio-canvas flex items-center justify-center text-slate-600 dark:text-slate-400 text-sm">Chargement…</div>}>
      <AuthForm />
    </Suspense>
  );
}
