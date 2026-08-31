'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ArrowRight, Lock, Mail, User, X, Gift, Eye, EyeOff } from 'lucide-react';
import { QatlIALogo } from '@/components/QatlIALogo';
import { useLocale } from '@/components/LocaleProvider';
import type { TranslationKey } from '@/i18n';

/**
 * Vision analyses granted on sign-up (same figure as the landing page's
 * `FREE_VISION_CREDITS`). It is interpolated into the copy rather than written
 * into it, so no locale can quietly promise a different number.
 */
const FREE_VISION_CREDITS = 5;

/** Kept in one place: the input constraint and the copy shown when it is not met. */
const MIN_PASSWORD_LENGTH = 6;

/**
 * Supabase returns `code` (or `error_code`) for most auth failures. Matching on
 * the code first is what keeps the mapping stable: the English message text
 * behind a given code has changed more than once across GoTrue releases.
 */
const AUTH_ERROR_CODE_KEYS: Record<string, TranslationKey> = {
  invalid_credentials: 'auth.errors.invalidCredentials',
  user_already_exists: 'auth.errors.alreadyRegistered',
  user_already_registered: 'auth.errors.alreadyRegistered',
  email_exists: 'auth.errors.alreadyRegistered',
  email_not_confirmed: 'auth.errors.emailNotConfirmed',
  weak_password: 'auth.errors.weakPassword',
  over_request_rate_limit: 'auth.errors.rateLimited',
  over_email_send_rate_limit: 'auth.errors.rateLimited',
  over_sms_send_rate_limit: 'auth.errors.rateLimited',
};

/**
 * Fallback for the (still common) responses that carry only a message. The
 * patterns cover the wordings GoTrue has shipped for each of these failures;
 * order matters only in that the first match wins.
 */
const AUTH_ERROR_MESSAGE_KEYS: ReadonlyArray<readonly [RegExp, TranslationKey]> = [
  [/invalid login credentials|invalid email or password|invalid credentials/, 'auth.errors.invalidCredentials'],
  [/already registered|already been registered|already exists/, 'auth.errors.alreadyRegistered'],
  [/(email|address) not confirmed|confirm your email|email confirmation/, 'auth.errors.emailNotConfirmed'],
  [/password should be at least|password should contain|password is too short|password.{0,20}too short|weak password/, 'auth.errors.weakPassword'],
  [/rate limit|too many requests|for security purposes|only request this after/, 'auth.errors.rateLimited'],
];

/** HTTP status Supabase uses for throttling, whatever wording accompanies it. */
const RATE_LIMIT_STATUS = 429;

function readAuthErrorFields(error: unknown): { message: string; code: string; status: number | null } {
  if (typeof error === 'string') return { message: error.toLowerCase(), code: '', status: null };
  if (typeof error !== 'object' || error === null) return { message: '', code: '', status: null };
  const fields = error as Record<string, unknown>;
  const rawCode = typeof fields.code === 'string' ? fields.code : fields.error_code;
  return {
    message: typeof fields.message === 'string' ? fields.message.toLowerCase() : '',
    code: typeof rawCode === 'string' ? rawCode.toLowerCase() : '',
    status: typeof fields.status === 'number' ? fields.status : null,
  };
}

/**
 * Localized copy for an auth failure. The upstream message is an English server
 * string, so it is only ever read — never rendered: an error this build does not
 * recognise degrades to `fallback` (the caller's own generic message).
 */
export function authErrorKey(error: unknown, fallback: TranslationKey = 'auth.genericError'): TranslationKey {
  const { message, code, status } = readAuthErrorFields(error);
  const byCode = code ? AUTH_ERROR_CODE_KEYS[code] : undefined;
  if (byCode) return byCode;
  if (status === RATE_LIMIT_STATUS) return 'auth.errors.rateLimited';
  for (const [pattern, key] of AUTH_ERROR_MESSAGE_KEYS) {
    if (pattern.test(message)) return key;
  }
  return fallback;
}

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialMode?: 'login' | 'signup';
  /** Overrides the localized default heading (used by callers with their own context). */
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
  title,
  subtitle,
}) => {
  const { t } = useLocale();
  const [isLogin, setIsLogin] = useState(initialMode === 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  /** Ties `aria-labelledby` to the heading, and stays the same for the life of the modal. */
  const headingId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  // Read through a ref so the focus/Escape effect depends on `isOpen` alone: a
  // caller passing an inline `onClose` would otherwise re-run it — and steal the
  // focus back — on every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Whatever opened the modal gets the caret back, even if the modal closed
      // because the sign-in succeeded rather than because it was dismissed.
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const showAuthError = (error: unknown, fallback: TranslationKey) => {
    setErrorMsg(t(authErrorKey(error, fallback), { min: MIN_PASSWORD_LENGTH }));
  };

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
      showAuthError(err, 'auth.googleError');
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
      showAuthError(err, 'auth.genericError');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className="relative w-full max-w-[420px] p-6 sm:p-7 rounded-3xl bg-studio-panel border border-studio-border shadow-2xl space-y-5 animate-in zoom-in-95 slide-in-from-bottom-4 duration-200 outline-none"
      >
        <button onClick={onClose} className="absolute end-4 top-4 p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-white rounded-full hover:bg-studio-field transition-colors" aria-label={t('common.close')}><X className="w-5 h-5" /></button>

        <div className="space-y-2 pe-8">
          <div className="text-brand-400"><QatlIALogo size="md" /></div>
          <h2 id={headingId} className="text-xl font-black text-slate-900 dark:text-white">{title ?? t('auth.defaultTitle')}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {isLogin
              ? t('auth.loginSubtitle')
              : subtitle ?? t('auth.defaultSubtitle', { count: FREE_VISION_CREDITS })}
          </p>
        </div>

        <div className="flex items-center gap-2 p-2.5 rounded-xl bg-brand-500/10 border border-brand-500/20 text-brand-300 text-xs font-medium">
          <Gift className="w-4 h-4 text-brand-400 shrink-0" />
          {t('auth.perk', { count: FREE_VISION_CREDITS })}
        </div>

        {errorMsg && (
          <div role="alert" className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">{errorMsg}</div>
        )}

        <button
          type="button"
          onClick={handleOAuthGoogle}
          disabled={oauthLoading || loading}
          className="w-full py-3 px-4 rounded-xl bg-white dark:bg-studio-field hover:bg-slate-100 dark:hover:bg-studio-border dark:hover:bg-studio-border text-slate-900 dark:text-white font-semibold text-sm flex items-center justify-center gap-3 disabled:opacity-50"
        >
          <GoogleMark />
          {oauthLoading ? t('auth.googleRedirect') : t('auth.google')}
        </button>

        <div className="relative flex items-center">
          <div className="border-t border-studio-border w-full" />
          <span className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-studio-panel">{t('auth.orEmail')}</span>
        </div>

        <form onSubmit={handleAuth} className="space-y-3">
          {!isLogin && (
            <div className="relative">
              <User className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute start-3 top-3" aria-hidden="true" />
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={t('auth.namePlaceholder')}
                aria-label={t('auth.namePlaceholder')}
                className="w-full bg-studio-field border border-studio-border rounded-xl ps-9 pe-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-600 outline-none focus:border-brand-500/50"
              />
            </div>
          )}
          {/* The placeholder is a sample address, identical in every locale, so
              the accessible name has to be the field's purpose instead. */}
          <div className="relative">
            <Mail className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute start-3 top-3" aria-hidden="true" />
            <input
              type="email"
              required
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('auth.emailPlaceholder')}
              aria-label={t('auth.emailLabel')}
              className="w-full bg-studio-field border border-studio-border rounded-xl ps-9 pe-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-600 outline-none focus:border-brand-500/50"
            />
          </div>
          <div className="relative">
            <Lock className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute start-3 top-3" aria-hidden="true" />
            <input
              type={showPassword ? 'text' : 'password'}
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('auth.passwordPlaceholder')}
              aria-label={t('auth.passwordPlaceholder')}
              className="w-full bg-studio-field border border-studio-border rounded-xl ps-9 pe-10 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-600 outline-none focus:border-brand-500/50"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              aria-pressed={showPassword}
              className="absolute end-3 top-2.5 text-slate-500 dark:text-slate-400"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <button
            type="submit"
            disabled={loading || oauthLoading}
            className="w-full py-3 rounded-xl bg-brand-500 hover:bg-brand-400 text-slate-950 font-black text-sm flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLogin ? t('auth.submitLogin') : t('auth.submitSignup')}
            <ArrowRight className="w-4 h-4 rtl:-scale-x-100" aria-hidden="true" />
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
          {isLogin
            ? t('auth.switchToSignup', { count: FREE_VISION_CREDITS })
            : t('auth.switchToLogin')}
        </button>
      </div>
    </div>
  );
};
