'use client';

import React, { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ArrowRight, Lock, Mail, User, X, Gift, Eye, EyeOff } from 'lucide-react';
import { QatlIALogo } from '@/components/QatlIALogo';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialMode?: 'login' | 'signup';
  title?: string;
  subtitle?: string;
}

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

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialMode = 'signup',
  title = 'Télécharger le rapport PDF',
  subtitle = '5 crédits offerts à la création du compte.',
}) => {
  const [isLogin, setIsLogin] = useState(initialMode === 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleOAuthGoogle = async () => {
    setOauthLoading(true);
    setErrorMsg(null);
    const supabase = createClient();
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : 'https://qatlia.vercel.app';
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${origin}/auth/callback` },
      });
      if (error) throw error;
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur lors de la connexion Google');
      setOauthLoading(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    const supabase = createClient();
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) throw error;
      }
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-[420px] p-6 sm:p-7 rounded-3xl bg-studio-panel border border-studio-border shadow-2xl space-y-5 animate-in zoom-in-95 slide-in-from-bottom-4 duration-200">
        <button onClick={onClose} className="absolute right-4 top-4 p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white rounded-full hover:bg-studio-field transition-colors" aria-label="Fermer"><X className="w-5 h-5" /></button>

        <div className="space-y-2 pr-8">
          <div className="text-brand-400"><QatlIALogo size="md" /></div>
          <h2 className="text-xl font-black text-slate-900 dark:text-white">{title}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">{isLogin ? 'Connectez-vous pour enregistrer ce débit et exporter.' : subtitle}</p>
        </div>

        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-brand-500/10 border border-brand-500/20 text-brand-300 text-xs font-medium">
          <Gift className="w-4 h-4 text-brand-400 shrink-0" />
          Historique cloud + 5 crédits Vision à l&apos;inscription
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">{errorMsg}</div>
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
          <span className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-studio-panel">ou email</span>
        </div>

        <form onSubmit={handleAuth} className="space-y-3">
          {!isLogin && (
            <div className="relative">
              <User className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Nom d’atelier"
                className="w-full bg-studio-field border border-studio-border rounded-xl pl-9 pr-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-600 outline-none focus:border-brand-500/50"
              />
            </div>
          )}
          <div className="relative">
            <Mail className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute left-3 top-3" />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="artisan@atelier.ma"
              className="w-full bg-studio-field border border-studio-border rounded-xl pl-9 pr-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-600 outline-none focus:border-brand-500/50"
            />
          </div>
          <div className="relative">
            <Lock className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute left-3 top-3" />
            <input
              type={showPassword ? 'text' : 'password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mot de passe"
              className="w-full bg-studio-field border border-studio-border rounded-xl pl-9 pr-10 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-600 outline-none focus:border-brand-500/50"
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-2.5 text-slate-500 dark:text-slate-400">
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <button
            type="submit"
            disabled={loading || oauthLoading}
            className="w-full py-3 rounded-xl bg-brand-500 hover:bg-brand-400 text-slate-950 font-black text-sm flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLogin ? 'Se connecter & exporter' : 'Créer le compte'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setIsLogin(!isLogin);
            setErrorMsg(null);
          }}
          className="w-full text-center text-sm text-brand-400 font-semibold"
        >
          {isLogin ? 'Créer un compte (+ 5 crédits)' : 'Déjà un compte ? Se connecter'}
        </button>
      </div>
    </div>
  );
};
