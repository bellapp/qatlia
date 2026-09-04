-- Manual payments (paiement manuel): virement/espèces/CashPlus-agence validated
-- by the operator. A pending row is created at checkout time with a generated
-- order number; the artisan pays using that reference; the operator validates
-- or refuses from the admin endpoint, which grants credits exactly like the
-- Stripe webhook does (same credit ledger path).

CREATE TABLE IF NOT EXISTS public.manual_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human-facing order number, e.g. QIA-20260902-4F7K (shown to the artisan at
  -- checkout and used as the payment reference in the transfer/agence).
  order_number TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pack_id TEXT NOT NULL CHECK (pack_id IN ('starter', 'standard', 'pro', 'atelier_max')),
  amount_mad NUMERIC(10,2) NOT NULL CHECK (amount_mad > 0),
  credits NUMERIC NOT NULL CHECK (credits > 0),
  -- pending -> paid -> granted | refused | expired
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'granted', 'refused', 'expired')),
  method TEXT NOT NULL DEFAULT 'manual' CHECK (method IN ('manual', 'cashplus_agency', 'bank_transfer', 'wafacash')),
  -- Operator-observed reference of the actual money movement (bank label,
  -- CashPlus SMS code...). Free text; uniqueness is on order_number above.
  payment_reference TEXT,
  operator_note TEXT,
  -- The ledger idempotency key once credits are granted (links to credit_transactions).
  granted_transaction_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_manual_payments_user ON public.manual_payments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_manual_payments_status ON public.manual_payments (status, created_at DESC);

ALTER TABLE public.manual_payments ENABLE ROW LEVEL SECURITY;

-- The artisan sees only their own payment requests.
DROP POLICY IF EXISTS "manual_payments_select_own" ON public.manual_payments;
CREATE POLICY "manual_payments_select_own"
  ON public.manual_payments FOR SELECT
  USING (auth.uid() = user_id);

-- The artisan can create a pending request for themselves.
DROP POLICY IF EXISTS "manual_payments_insert_own" ON public.manual_payments;
CREATE POLICY "manual_payments_insert_own"
  ON public.manual_payments FOR INSERT
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

-- Decisions (paid/granted/refused) go through the service-role admin route only:
-- no client-side UPDATE policy, by design.
