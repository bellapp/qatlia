import { test, expect } from '@playwright/test';

// P0 Task 5: the customer-facing side of the credit policy.
// Displayed prices must be MAD, the only charged action is a successful photo
// analysis, and no export path may issue a credit-debit request.

test.describe('Credits page (/credits)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/credits', { waitUntil: 'domcontentloaded' });
  });

  test('shows the four MAD packs at their catalog prices', async ({ page }) => {
    await expect(page.getByText('Pack Découverte')).toBeVisible();
    await expect(page.getByText('Pack Artisan')).toBeVisible();
    await expect(page.getByText('Pack Atelier Pro')).toBeVisible();
    await expect(page.getByText('Abonnement Atelier Max')).toBeVisible();

    // Prices are rendered as "<amount> DH" — assert each amount is present.
    for (const price of ['10', '40', '70', '99']) {
      await expect(page.locator('span.text-3xl', { hasText: new RegExp(`^${price}$`) }).first()).toBeVisible();
    }
    await expect(page.getByText(/dirhams \(MAD\)/i)).toBeVisible();
  });

  test('states the policy: credits only for photo analysis, exports free', async ({ page }) => {
    const policy = page.getByText(/1 crédit est débité uniquement lors d.une analyse photo réussie/i);
    await expect(policy).toBeVisible();
    await expect(policy).toContainText(/exports.*sont gratuits et illimités/i);
  });

  test('makes no unsupported CMI/CashPlus payment claim', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/CMI/);
    expect(body).not.toMatch(/CashPlus/i);
  });

  test('never displays a hardcoded 5-credit balance to a signed-out visitor', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/Solde actuel\s*:\s*5\s+[Cc]rédits/);
  });
});

test.describe('Credit debits', () => {
  test('exporting after an optimization never calls /api/credits/consume', async ({ page }) => {
    test.setTimeout(90_000);

    const consumeRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/credits/consume')) consumeRequests.push(request.url());
    });

    await page.goto('/atelier', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('img', { name: 'QatlIA' })).toBeVisible({ timeout: 15000 });

    // Run a real optimization, then exercise the free export paths.
    await page.getByRole('button', { name: /optimiser/i }).first().click();
    await expect(page.getByTestId('cut-plan-svg')).toBeVisible({ timeout: 20000 });

    for (const label of [/json/i, /png/i, /dxf/i, /pdf/i]) {
      const button = page.getByRole('button', { name: label }).first();
      if ((await button.count()) && (await button.isVisible())) {
        await button.click({ noWaitAfter: true, timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(500);
      }
    }

    expect(consumeRequests, 'exports are free and must not debit credits').toEqual([]);
  });

  test('optimizing consumes no credit', async ({ page }) => {
    const debitRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/credits/consume') || url.includes('consume_credit')) debitRequests.push(url);
    });

    await page.goto('/atelier', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('img', { name: 'QatlIA' })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /optimiser/i }).first().click();
    await page.waitForTimeout(3000);

    expect(debitRequests).toEqual([]);
  });
});
