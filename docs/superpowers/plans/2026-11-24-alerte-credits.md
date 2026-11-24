# Alerte crédits — plan

**Spec :** `docs/superpowers/specs/2026-11-24-alerte-credits-design.md`. Exécution : dans la session, test d'abord.

**Goal:** prévenir le client avant zéro crédit, et lui donner un bouton d'achat à zéro.

## Global Constraints

- Seuil : 5 sous 100 ; `ceil(10 %)` à partir de 100 ; inconnu → 5.
- Application Android : aucun lien d'achat visible (`data-sells`).
- fr, en, ar ; clair et sombre.

## Review Focus

- Remboursement d'analyse (+1, type `purchase`) : ne change pas le solde de départ.
- Solde de départ en cours de lecture : pas d'alerte au-dessus de 5, et pas d'oubli de la fermeture.
- `localStorage` indisponible : la page ne casse pas.
- Solde 0 : le message revient même s'il avait été fermé.
- Visiteur non connecté : rien.

## Task 1 — règle

- `src/lib/billing/policy.ts` : `lowCreditsThreshold(start: number | null): number`, `creditLevel(balance: number | null, start: number | null | undefined): CreditLevel` (`'unknown' | 'ok' | 'low' | 'empty'`).
- `src/lib/billing/start-balance.ts` : `readStartBalance(client): Promise<number | null>` ; ajouts de plus de `OPTIMIZE_CREDIT_COST`, le dernier.
- `src/lib/low-credits-dismissal.ts` : `readDismissed`, `writeDismissed`, sans jamais lever d'erreur.
- Test : `tests/low-credits.test.js`.

## Task 2 — affichage

- `src/components/useCreditLevel.ts` : `useCreditLevel(balance)`, `CREDIT_BADGE_TONES`.
- `src/components/LowCreditsBanner.tsx` : `{ balance, level, dismissible }`.
- Badges : atelier, history, panels, account. Message : atelier (fermable), account/credits.
- Atelier à zéro : bouton dans l'erreur photo, `account.buyCredits` dans celle de l'optimisation (clé `recharge` retirée), solde mis à jour sur 402.

## Task 3 — vérification

`npm run test:node` (10 échecs connus), `npx tsc --noEmit`, `npm run lint`, rendu clair/sombre, PR.
