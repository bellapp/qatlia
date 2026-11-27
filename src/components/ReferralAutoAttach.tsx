'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { readReferralCookie } from '@/lib/referral';

/**
 * While a referral link's code is kept in this browser (src/lib/referral.ts),
 * attaches the signed-in account to its parrain: right away when a session
 * exists, else as soon as the visitor signs up or signs in. The server
 * decides everything and clears the cookie once its answer is final. Renders
 * nothing; does nothing at all in a browser that keeps no code.
 */
export function ReferralAutoAttach() {
  useEffect(() => {
    if (!readReferralCookie(document.cookie)) return;

    let busy = false;
    const attach = async () => {
      if (busy || !readReferralCookie(document.cookie)) return;
      busy = true;
      try {
        await fetch('/api/referral/attach', { method: 'POST', credentials: 'same-origin' });
      } catch {
        // Offline: the code stays kept and the next page tries again.
      } finally {
        busy = false;
      }
    };

    let unsubscribe: (() => void) | undefined;
    try {
      const supabase = createClient();
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) void attach();
      });
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) void attach();
      });
      unsubscribe = () => data.subscription.unsubscribe();
    } catch {
      // No Supabase configured (local build): nothing to attach to.
    }
    return () => unsubscribe?.();
  }, []);

  return null;
}
