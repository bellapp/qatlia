'use client';

import React, { useEffect, useState } from 'react';
import { Sparkles, Check, Zap, ArrowLeft, ShieldCheck, CreditCard, Landmark, MessageCircle, Mail } from 'lucide-react';
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP_DISPLAY, supportMailto, supportWhatsAppUrl } from '@/lib/support';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { CREDIT_PACKS, PACK_IDS, formatPrice, packPrice, BILLING_CURRENCY } from '@/lib/billing/catalog';
import { cardCurrencyFor, offersManualPayment, type AppCurrency } from '@/lib/currency';
import { CurrencySwitcher, useCurrency } from '@/components/CurrencySwitcher';
import { LocaleSwitcher, useLocale } from '@/components/LocaleProvider';
import { SupportContact } from '@/components/SupportContact';
import { BankTransferDetails, type BankTransferDetailsData } from '@/components/BankTransferDetails';
import { checkoutErrorKey, creditPackLabelKeys } from '@/i18n/domain';
import { LEGAL_DOCS, LEGAL_ROUTES } from '@/lib/legal';
import { ANALYSIS_WINDOW_HOURS, MAX_SCANS_PER_ANALYSIS, VISION_CREDIT_COST } from '@/lib/billing/policy';

/** Payment providers are proper nouns, so they are interpolated, not translated. */
const PAYMENT_PROVIDER_NAMES = { creem: 'Creem', stripe: 'Stripe' } as const;
type CardProvider = keyof typeof PAYMENT_PROVIDER_NAMES;

export default function CreditsPage() {
  const { t, tn, n, locale } = useLocale();
  const [loadingPack, setLoadingPack] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  // null until the real balance is known — never a hardcoded placeholder.
  const [credits, setCredits] = useState<number | null>(null);
  // Creem charges the USD price, Stripe the MAD one: the card price is only
  // shown once the server has said which provider will take the payment.
  const [cardProvider, setCardProvider] = useState<CardProvider | null>(null);
  // Creem charges a euro account in euros only once the euro products exist.
  const [euroCard, setEuroCard] = useState(false);
  const [providerKnown, setProviderKnown] = useState(false);
  const { currency } = useCurrency();

  const packs = PACK_IDS.map((id) => CREDIT_PACKS[id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/credits/checkout');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && (data?.provider === 'creem' || data?.provider === 'stripe')) setCardProvider(data.provider);
        if (!cancelled) setEuroCard(data?.euroCard === true);
      } catch { /* the cards keep their account-currency price */ } finally {
        if (!cancelled) setProviderKnown(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;
        const { data: profile } = await supabase.from('profiles').select('credits').eq('id', user.id).single();
        if (!cancelled && profile && typeof profile.credits === 'number') setCredits(profile.credits);
      } catch {
        /* balance stays unknown rather than being invented */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCheckout = async (packId: string) => {
    setLoadingPack(packId);
    setCheckoutError(null);
    try {
      const res = await fetch('/api/credits/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The card checkout opens in the language chosen here (Creem has no
        // Arabic: the server maps it to French).
        body: JSON.stringify({ packId, locale }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      // Card payment not configured yet: the manual order IS the buying path
      // today, so fall straight into it instead of a dead-end error.
      if (data?.error === 'PAYMENT_UNAVAILABLE') {
        setCheckoutError(t('creditsPage.errors.cardFallback'));
        await handleManualOrder(packId);
        return;
      }
      // The route answers with a stable code; its own message is a server
      // string and is never shown to the buyer.
      setCheckoutError(t(checkoutErrorKey(data?.error)));
    } catch {
      setCheckoutError(t('creditsPage.errors.network'));
    } finally {
      setLoadingPack(null);
    }
  };

  // Manual payment: create a pending order; the artisan pays using the order
  // number as reference; the operator grants credits from the back office.
  const [manualOrder, setManualOrder] = useState<{
    order_number: string; amount_mad: number; credits: number; pack_id: string;
  } | null>(null);
  const [myManualOrders, setMyManualOrders] = useState<Array<{
    order_number: string; status: string; amount_mad: number; credits: number; created_at: string;
  }>>([]);
  // The account to pay into, sent by the server only to the signed-in buyer of
  // an order still to be paid (null when not configured).
  const [bankDetails, setBankDetails] = useState<BankTransferDetailsData | null>(null);
  // The server answered with the order the customer already had pending: one
  // order to pay at a time, cancelled explicitly to switch packs.
  const [isExistingOrder, setIsExistingOrder] = useState(false);
  // Which pending order is asking "are you sure?" before being cancelled.
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [ordersVersion, setOrdersVersion] = useState(0);

  const cancelManualOrder = async (orderNumber: string) => {
    setCancelling(true);
    setCheckoutError(null);
    try {
      const res = await fetch('/api/credits/manual', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNumber }),
      });
      if (!res.ok) {
        setCheckoutError(t('creditsPage.manual.cancelFailed'));
        return;
      }
      setConfirmCancel(null);
      setIsExistingOrder(false);
      setManualOrder(null);
      setOrdersVersion((v) => v + 1);
    } catch {
      setCheckoutError(t('creditsPage.manual.cancelFailed'));
    } finally {
      setCancelling(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/credits/manual');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.success) {
          setMyManualOrders(data.orders || []);
          setBankDetails(data.bank ?? null);
        }
      } catch { /* tracking is best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [manualOrder, ordersVersion]);

  const handleManualOrder = async (packId: string) => {
    setLoadingPack(`manual-${packId}`);
    setCheckoutError(null);
    try {
      const res = await fetch('/api/credits/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId, method: 'manual' }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.order) {
        setManualOrder(data.order);
        setBankDetails(data.bank ?? null);
        setIsExistingOrder(data.existing === true);
        setConfirmCancel(null);
      } else {
        setCheckoutError(t(checkoutErrorKey(data?.error)) || t('creditsPage.errors.network'));
      }
    } catch {
      setCheckoutError(t('creditsPage.errors.network'));
    } finally {
      setLoadingPack(null);
    }
  };

  // The currency the packs are priced in: the account's, except a euro
  // account before the euro products exist, which is charged (so shown) in
  // dollars. Null until both answers are in, so no price flips on screen.
  const shownCurrency: AppCurrency | null =
    currency === null || !providerKnown ? null : currency === 'EUR' && !euroCard ? 'USD' : currency;
  // A dirham account pays by card through Creem in dollars: that price is
  // shown under the button. Other accounts are charged the price on the card.
  const cardCurrency = shownCurrency ? cardCurrencyFor(shownCurrency, euroCard) : 'USD';
  const showCardPrice = cardProvider === 'creem' && shownCurrency === 'MAD';
  const manualOffered = shownCurrency !== null && offersManualPayment(shownCurrency);
  const priceOf = (pack: (typeof packs)[number]) =>
    shownCurrency ? formatPrice(packPrice(pack, shownCurrency), shownCurrency) : '…';

  // Rendered around the placeholders so the figure and the provider stay bold.
  const [headlineBefore, headlineAfter = ''] = t('creditsPage.headline', {
    count: CREDIT_PACKS.starter.credits,
  }).split('{price}');
  // Without a card provider (none configured, or the server has not answered yet)
  // only cash and bank transfer are offered, so no card brand may be named.
  const [secureBefore, secureAfter = ''] = cardProvider
    ? (cardProvider === 'creem'
        ? t(cardCurrency === 'EUR' ? 'creditsPage.securePaymentInternationalEur' : 'creditsPage.securePaymentInternational', { currency: cardCurrency })
        : t('creditsPage.securePayment', { currency: BILLING_CURRENCY })
      ).split('{provider}')
    : [];

  return (
    <div className="min-h-screen bg-studio-panel text-slate-700 dark:text-slate-200 font-sans antialiased p-6 md:p-10">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/atelier"
            className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4 rtl:-scale-x-100" aria-hidden="true" />
            {t('creditsPage.back')}
          </Link>
          <div className="flex items-center gap-2">
            <CurrencySwitcher />
            <LocaleSwitcher />
            {/* The balance arrives after the profile is read, so it is a live
                region: the artisan hears the real figure, never the placeholder. */}
            <div
              role="status"
              aria-label={`${t('atelier.header.creditsAria')}: ${credits === null ? '—' : n(credits)}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-400/10 border border-brand-500/30 text-brand-400 text-xs font-bold"
            >
              <Zap className="w-3.5 h-3.5 text-[#F5A623]" aria-hidden="true" />
              <span>
                {credits === null ? t('creditsPage.balanceUnknown') : tn('creditsPage.balance', credits)}
              </span>
            </div>
          </div>
        </div>

        {/* Title */}
        <div className="text-center space-y-2">
          <span className="text-xs font-black uppercase tracking-widest text-[#F5A623] bg-brand-400/10 px-3 py-1 rounded-full border border-brand-500/20">
            {t('creditsPage.eyebrow')}
          </span>
          <h1 className="text-3xl md:text-4xl font-black text-slate-900 dark:text-white">
            {headlineBefore}
            <span dir="ltr" translate="no">{priceOf(CREDIT_PACKS.starter)}</span>
            {headlineAfter}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 max-w-xl mx-auto">{t('creditsPage.policy', { cost: VISION_CREDIT_COST, sheets: MAX_SCANS_PER_ANALYSIS, hours: ANALYSIS_WINDOW_HOURS })}</p>
        </div>

        {checkoutError && (
          <p role="alert" className="text-center text-xs font-semibold text-red-500">
            {checkoutError}
          </p>
        )}

        {/* Manual payment confirmation */}
        {manualOrder && (
          <div role="dialog" aria-label={t('creditsPage.manual.dialogTitle')} className="rounded-2xl border-2 border-[#F5A623] bg-gradient-to-b from-[#1E3A5F] to-[#0F172A] p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Landmark className="w-5 h-5 text-[#F5A623]" aria-hidden="true" />
              <h2 className="text-base font-black text-white">
                {t(isExistingOrder ? 'creditsPage.manual.existingTitle' : 'creditsPage.manual.dialogTitle')}
              </h2>
            </div>
            {isExistingOrder && (
              <p data-testid="existing-order-notice" className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 leading-relaxed">
                {t('creditsPage.manual.existingNotice')}
              </p>
            )}
            <div className="text-center py-3 rounded-xl bg-black/30 border border-white/10">
              <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-1">{t('creditsPage.manual.orderNumberLabel')}</p>
              <p dir="ltr" className="text-2xl font-mono font-black text-[#F5A623] tracking-widest">{manualOrder.order_number}</p>
            </div>
            <ol className="space-y-2 text-xs text-slate-300 leading-relaxed list-decimal list-inside">
              <li>{t('creditsPage.manual.step1', { amount: n(manualOrder.amount_mad) })}</li>
              <li>{t('creditsPage.manual.step2')}</li>
              <li>{t('creditsPage.manual.step3')}</li>
            </ol>
            {bankDetails && <BankTransferDetails bank={bankDetails} />}
            <p className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              {t('creditsPage.manual.keepReference')}
            </p>
            {/* One obvious next step after paying: send the proof on WhatsApp,
                the message already carrying the order number. */}
            <div className="space-y-1.5">
              <a
                href={supportWhatsAppUrl(t('creditsPage.manual.proofMessage', { orderNumber: manualOrder.order_number }))}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="send-proof-whatsapp"
                className="w-full py-3 px-4 rounded-xl bg-[#25D366] hover:bg-[#1FBF5B] text-[#0B2E13] text-sm font-black transition-colors flex items-center justify-center gap-2"
              >
                <MessageCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>{t('creditsPage.manual.sendProof')}</span>
              </a>
              <p className="text-center text-[11px] text-slate-300 leading-relaxed">
                {t('creditsPage.manual.sendProofHint')}{' '}
                <span dir="ltr" translate="no" className="font-mono font-bold text-white whitespace-nowrap">{SUPPORT_WHATSAPP_DISPLAY}</span>
              </p>
              <p className="text-center text-[11px] text-slate-400">
                {t('creditsPage.manual.emailAlternative')}{' '}
                <a
                  href={supportMailto(t('creditsPage.manual.proofMessage', { orderNumber: manualOrder.order_number }))}
                  dir="ltr"
                  className="inline-flex items-center gap-1 font-bold text-slate-200 underline underline-offset-2"
                >
                  <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                  {SUPPORT_EMAIL}
                </a>
              </p>
            </div>
            <button
              onClick={() => { setManualOrder(null); setIsExistingOrder(false); setConfirmCancel(null); }}
              className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-colors"
            >
              {t('creditsPage.manual.close')}
            </button>
            {confirmCancel === manualOrder.order_number ? (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 space-y-2">
                <p className="text-[11px] text-rose-200 leading-relaxed">{t('creditsPage.manual.cancelConfirm')}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    data-testid="confirm-cancel-order"
                    onClick={() => void cancelManualOrder(manualOrder.order_number)}
                    disabled={cancelling}
                    className="flex-1 py-2 rounded-lg bg-rose-500/80 hover:bg-rose-500 text-white text-[11px] font-bold disabled:opacity-50 transition-colors"
                  >
                    {t('creditsPage.manual.cancelYes')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmCancel(null)}
                    className="flex-1 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-bold transition-colors"
                  >
                    {t('creditsPage.manual.cancelKeep')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                data-testid="cancel-order"
                onClick={() => setConfirmCancel(manualOrder.order_number)}
                className="w-full text-center text-[11px] font-bold text-slate-400 hover:text-rose-300 underline underline-offset-2 transition-colors"
              >
                {t('creditsPage.manual.cancel')}
              </button>
            )}
          </div>
        )}

        {/* My manual payment requests */}
        {myManualOrders.length > 0 && !manualOrder && (
          <div className="rounded-2xl border border-studio-border bg-studio-panel/40 p-4 space-y-2">
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">{t('creditsPage.manual.historyTitle')}</h2>
            {myManualOrders.slice(0, 5).map((o) => (
              <div key={o.order_number} className="flex items-center justify-between text-xs py-1.5 border-b border-studio-border/40 last:border-0">
                <span dir="ltr" className="font-mono font-bold text-slate-700 dark:text-slate-200">{o.order_number}</span>
                <span dir="ltr" translate="no" className="font-mono text-slate-500">{n(o.amount_mad)} {t('creditsPage.currency')} · {o.credits} cr</span>
                <span className="flex items-center gap-2">
                  {o.status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => {
                        setManualOrder({ order_number: o.order_number, amount_mad: o.amount_mad, credits: o.credits, pack_id: '' });
                        setIsExistingOrder(false);
                        setConfirmCancel(o.order_number);
                      }}
                      className="text-[10px] font-bold text-slate-500 hover:text-rose-400 underline underline-offset-2 transition-colors"
                    >
                      {t('creditsPage.manual.cancelShort')}
                    </button>
                  )}
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    o.status === 'granted' ? 'bg-emerald-500/15 text-emerald-400' :
                    o.status === 'refused' ? 'bg-rose-500/15 text-rose-400' :
                    o.status === 'expired' ? 'bg-slate-500/15 text-slate-400' :
                    'bg-amber-500/15 text-amber-400'
                  }`}>
                    {t(`creditsPage.manual.status.${
                      o.status === 'granted' ? 'granted' : o.status === 'refused' ? 'refused' : o.status === 'expired' ? 'expired' : 'pending'
                    }`)}
                  </span>
                </span>
              </div>
            ))}
            {bankDetails && myManualOrders.some((o) => o.status === 'pending') && (
              <div className="rounded-2xl bg-gradient-to-b from-[#1E3A5F] to-[#0F172A] p-3">
                <BankTransferDetails bank={bankDetails} />
              </div>
            )}
            <SupportContact
              label={t('support.paymentHelp')}
              message={t('support.prefill')}
              className="pt-1 text-slate-500 dark:text-slate-400"
            />
          </div>
        )}

        {/* Packs Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {packs.map((p) => {
            const labels = creditPackLabelKeys(p.id);
            const packName = t(labels.name);
            // The allowance stays bold, so the line is rendered in two parts
            // around its {count} rather than interpolated into a flat string.
            const [analysesBefore, analysesAfter = ''] = t('creditsPage.packAnalyses').split('{count}');
            // The highlighted card sits on navy in both themes, so its text is
            // always light; the others follow the theme.
            const tone = p.highlight
              ? { strong: 'text-white', muted: 'text-slate-300', rule: 'border-white/15' }
              : { strong: 'text-slate-900 dark:text-white', muted: 'text-slate-600 dark:text-slate-300', rule: 'border-studio-border' };
            return (
              <div
                key={p.id}
                className={`rounded-2xl p-6 flex flex-col justify-between transition-all relative ${
                  p.highlight
                    ? 'bg-gradient-to-b from-[#1E3A5F] to-[#0F172A] border-2 border-[#F5A623] shadow-xl shadow-orange-500/10'
                    : 'bg-studio-panel/60 border border-studio-border'
                }`}
              >
                {p.highlight && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#F5A623] text-black text-[10px] font-black uppercase tracking-wider px-3 py-0.5 rounded-full shadow-md">
                    {t('creditsPage.recommended')}
                  </span>
                )}

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className={`text-base font-bold ${tone.strong}`}>{packName}</h3>
                  </div>
                  <div className="flex items-baseline gap-1 my-3" translate="no">
                    <span dir="ltr" data-testid="pack-price" className={`text-3xl font-black ${tone.strong}`}>
                      {priceOf(p)}
                    </span>
                  </div>
                  <p className={`text-xs leading-relaxed mb-6 ${tone.muted}`}>
                    {t(labels.description, { count: p.credits })}
                  </p>

                  <div className={`space-y-2.5 pt-4 border-t text-xs ${tone.rule}`}>
                    <div className={`flex items-center gap-2 ${tone.strong}`}>
                      <Check className={`w-4 h-4 shrink-0 ${p.highlight ? 'text-emerald-400' : 'text-emerald-600 dark:text-emerald-400'}`} aria-hidden="true" />
                      <span>
                        {analysesBefore}
                        <strong>{p.displayCredits}</strong>
                        {analysesAfter}
                      </span>
                    </div>
                    <div className={`flex items-center gap-2 ${tone.muted}`}>
                      <Check className={`w-4 h-4 shrink-0 ${p.highlight ? 'text-emerald-400' : 'text-emerald-600 dark:text-emerald-400'}`} aria-hidden="true" />
                      <span>{t('creditsPage.freePlans')}</span>
                    </div>
                    <div className={`flex items-center gap-2 ${tone.muted}`}>
                      <Check className={`w-4 h-4 shrink-0 ${p.highlight ? 'text-emerald-400' : 'text-emerald-600 dark:text-emerald-400'}`} aria-hidden="true" />
                      <span>{t('creditsPage.freeExports')}</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => handleCheckout(p.id)}
                  disabled={loadingPack === p.id}
                  aria-label={t('creditsPage.chooseAria', { pack: packName })}
                  aria-busy={loadingPack === p.id}
                  className={`w-full mt-6 py-3 rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
                    p.highlight
                      ? 'bg-[#F5A623] hover:bg-[#D97706] text-black shadow-lg shadow-orange-500/20'
                      : 'bg-[#0284C7] hover:bg-[#0369A1] text-white'
                  }`}
                >
                  {loadingPack === p.id ? (
                    <>
                      <Sparkles className="w-4 h-4 animate-spin" aria-hidden="true" />
                      {t('creditsPage.redirecting')}
                    </>
                  ) : (
                    <>
                      <CreditCard className="w-4 h-4" aria-hidden="true" />
                      {t('creditsPage.choose')}
                    </>
                  )}
                </button>
                {showCardPrice && (
                  <p className={`mt-1.5 text-center text-[11px] font-semibold ${tone.muted}`}>
                    <span dir="ltr" translate="no">{t('creditsPage.cardPrice', { price: formatPrice(packPrice(p, cardCurrency), cardCurrency) })}</span>
                  </p>
                )}
                {/* Transfer and cash go to a Moroccan account, in dirhams. */}
                {manualOffered && (
                <button
                  onClick={() => handleManualOrder(p.id)}
                  disabled={loadingPack === `manual-${p.id}`}
                  aria-busy={loadingPack === `manual-${p.id}`}
                  className={`w-full mt-2 py-2.5 rounded-xl border hover:border-[#F5A623]/50 hover:text-[#F5A623] font-bold text-[11px] transition-all flex items-center justify-center gap-2 disabled:opacity-40 ${
                    p.highlight ? 'border-white/25 text-slate-200' : 'border-studio-border text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <Landmark className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('creditsPage.manual.button')}
                </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Payment Methods Banner */}
        <div className="p-4 rounded-2xl bg-studio-panel/40 border border-studio-border flex flex-wrap items-center justify-between text-xs text-slate-600 dark:text-slate-400 gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-sky-400" aria-hidden="true" />
            {cardProvider ? (
              <span>
                {secureBefore}
                <strong>{PAYMENT_PROVIDER_NAMES[cardProvider]}</strong>
                {secureAfter}
              </span>
            ) : (
              <span>{t('creditsPage.manualPaymentOnly', { currency: BILLING_CURRENCY })}</span>
            )}
          </div>
          <span className="text-[11px] text-[#64748B]">{t('creditsPage.invoiceNote')}</span>
        </div>

        {/* Shown next to every pay button: paying is accepting these. */}
        <p className="text-center text-[11px] text-slate-600 dark:text-slate-400">
          {t('legal.checkoutNotice')}{' '}
          {LEGAL_DOCS.map((doc, i) => (
            <React.Fragment key={doc}>
              {i > 0 && ' · '}
              <Link href={LEGAL_ROUTES[doc]} className="font-semibold underline hover:text-slate-900 dark:hover:text-white">
                {t(`legal.nav.${doc}`)}
              </Link>
            </React.Fragment>
          ))}
        </p>
      </div>
    </div>
  );
}
