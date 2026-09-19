import { test, expect } from '@playwright/test';

test.describe('Landing Page (/)', () => {
  test('loads and displays hero title', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1').first()).toContainText('Optimisez');
  });

  test('has "Essayer gratuitement" CTA buttons linking to /atelier', async ({ page }) => {
    await page.goto('/');
    const ctas = page.getByRole('link', { name: /essayer/i });
    const count = await ctas.count();
    expect(count).toBeGreaterThanOrEqual(1);
    await expect(ctas.first()).toHaveAttribute('href', '/atelier');
  });

  test('has "Connexion" link in navbar', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /connexion/i }).first()).toBeVisible();
  });

  test('stats section shows 4 values', async ({ page }) => {
    await page.goto('/');
    const stats = page.locator('.grid.grid-cols-2.sm\\:grid-cols-4');
    await expect(stats).toBeVisible();
    await expect(stats.locator('> div')).toHaveCount(4);
  });

  test('features section has 4 feature cards', async ({ page }) => {
    await page.goto('/');
    const cards = page.locator('.grid.sm\\:grid-cols-2.lg\\:grid-cols-4 > div');
    await expect(cards).toHaveCount(4);
  });

  test('dark mode toggle is present', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('button[aria-label*="Mode" i]').first()).toBeVisible();
  });

  test('the locale switcher offers exactly the locales the app still serves', async ({ page }) => {
    await page.goto('/');
    // A native <select>, not buttons, and English is withdrawn from it
    // (SELECTABLE_LOCALES) while the quotation exists in FR and AR only.
    const picker = page.locator('select:has(option[value="fr"])').first();
    await expect(picker).toBeVisible();
    await expect(picker.locator('option')).toHaveCount(2);
    await expect(picker.locator('option[value="ar"]')).toHaveCount(1);
    await expect(picker.locator('option[value="en"]')).toHaveCount(0);
  });
});