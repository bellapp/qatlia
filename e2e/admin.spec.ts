import { test, expect } from '@playwright/test';

// The account-protected back office (plan 2026-11-12): nothing is readable
// without a session, and a visitor is sent to the login page with a way back.

test('un visiteur non connecté est renvoyé vers la connexion', async ({ page }) => {
  await page.goto('/admin/clients');
  await expect(page).toHaveURL(/\/auth\/login\?redirect=%2Fadmin%2Fclients/);
});

test("une fiche client n'est pas lisible sans session", async ({ page }) => {
  await page.goto('/admin/clients/11111111-2222-4333-8444-555555555555');
  await expect(page).toHaveURL(/\/auth\/login/);
  await expect(page.getByText('11111111-2222-4333-8444-555555555555')).toHaveCount(0);
});
