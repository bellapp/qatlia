import { test, expect } from '@playwright/test';

// The account-protected back office (plan 2026-11-12): nothing is readable
// without a session, and a visitor is sent to the login page with a way back.

test('un visiteur non connecté est renvoyé vers la connexion', async ({ page }) => {
  await page.goto('/admin/clients');
  await expect(page).toHaveURL(/\/auth\/login\?redirect=%2Fadmin%2Fclients/);
});

for (const [path, encoded] of [
  ['/admin', '%2Fadmin'],
  ['/admin/paiements', '%2Fadmin%2Fpaiements'],
]) {
  test(`${path} sans session renvoie vers la connexion`, async ({ page }) => {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/auth/login\\?redirect=${encoded}$`));
  });
}

test("l'ancienne route à code secret n'existe plus", async ({ request }) => {
  const res = await request.post('/api/credits/manual/admin', {
    headers: { authorization: `Bearer ${'x'.repeat(32)}` },
    data: { order_number: 'QIA-20261112-AB23', decision: 'grant' },
  });
  expect(res.status()).toBe(404);
});

test('la décision sur une commande refuse un appel sans session', async ({ request }) => {
  const res = await request.post('/api/admin/payments', { data: { order_number: 'QIA-20261112-AB23', decision: 'grant' } });
  expect(res.status()).toBe(401);
});

test("une fiche client n'est pas lisible sans session", async ({ page }) => {
  await page.goto('/admin/clients/11111111-2222-4333-8444-555555555555');
  await expect(page).toHaveURL(/\/auth\/login/);
  await expect(page.getByText('11111111-2222-4333-8444-555555555555')).toHaveCount(0);
});
