-- Migration 003 : Fonctions sécurisées de gestion des crédits (Déduction & Ajout)

-- 1. Fonction pour déduire 1 crédit de manière atomique lors d'une action (Téléchargement PDF ou Scan Vision)
CREATE OR REPLACE FUNCTION public.deduct_credit(p_user_id UUID, p_amount INT DEFAULT 1)
RETURNS INT AS $$
DECLARE
  current_credits INT;
BEGIN
  SELECT credits INTO current_credits FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  
  IF current_credits IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;
  
  IF current_credits < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDITS';
  END IF;
  
  UPDATE public.profiles
  SET credits = credits - p_amount,
      updated_at = NOW()
  WHERE id = p_user_id;

  INSERT INTO public.credit_transactions (user_id, amount, reason)
  VALUES (p_user_id, -p_amount, 'Téléchargement Rapport PDF Débit QatlIA');

  RETURN current_credits - p_amount;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Fonction pour ajouter des crédits après achat Stripe
CREATE OR REPLACE FUNCTION public.add_credits(p_user_id UUID, p_credits INT)
RETURNS INT AS $$
DECLARE
  new_credits INT;
BEGIN
  UPDATE public.profiles
  SET credits = credits + p_credits,
      updated_at = NOW()
  WHERE id = p_user_id
  RETURNING credits INTO new_credits;

  INSERT INTO public.credit_transactions (user_id, amount, reason)
  VALUES (p_user_id, p_credits, 'Achat Pack Crédits Stripe');

  RETURN new_credits;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
