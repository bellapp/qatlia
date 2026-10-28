import { redirect } from 'next/navigation';

/**
 * A plain sign-up link for directories, profiles and the « free account » buttons.
 * Sign-in and sign-up share /auth/login, which opens in sign-in mode; ?mode=signup
 * opens it in sign-up mode. A same-site ?redirect= is passed through.
 */
export default function SignupPage({
  searchParams,
}: {
  searchParams?: { redirect?: string | string[] };
}) {
  const target = new URLSearchParams({ mode: 'signup' });
  const r = searchParams?.redirect;
  const back = Array.isArray(r) ? r[0] : r;
  // Only same-site paths: never let /signup?redirect=https://… bounce a visitor elsewhere.
  if (back && back.startsWith('/') && !back.startsWith('//')) target.set('redirect', back);
  redirect(`/auth/login?${target.toString()}`);
}
