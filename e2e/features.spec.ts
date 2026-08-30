import { test, expect } from '@playwright/test';

test.describe('Dark/Light Mode', () => {
  test('dark mode toggle switches theme', async ({ page }) => {
    await page.goto('/');
    const toggle = page.locator('button[aria-label*="Mode" i], button[title*="Mode" i]').first();
    await expect(toggle).toBeVisible();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await toggle.click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await toggle.click();
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('preference persists across page reload', async ({ page }) => {
    await page.goto('/');
    const toggle = page.locator('button[aria-label*="Mode" i], button[title*="Mode" i]').first();
    await toggle.click();
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });
});

test.describe('Responsive', () => {
  test('mobile viewport shows landing page', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('Arabic locale keeps the mobile atelier inside the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.addInitScript(() => localStorage.setItem('qatlia-locale', 'fr'));
    await page.goto('/atelier');

    const measureOverflow = () => page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      main: (() => {
        const rect = document.querySelector('main')?.getBoundingClientRect();
        return rect ? { left: rect.left, right: rect.right, width: rect.width } : null;
      })(),
    }));

    const before = await measureOverflow();
    expect(Math.max(before.documentWidth, before.bodyWidth)).toBeLessThanOrEqual(before.viewportWidth + 1);

    await page.getByRole('button', { name: 'AR', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    const after = await measureOverflow();
    expect(Math.max(after.documentWidth, after.bodyWidth)).toBeLessThanOrEqual(after.viewportWidth + 1);
    expect(after.main).not.toBeNull();
    expect(after.main?.left ?? -1).toBeGreaterThanOrEqual(-1);
    expect(after.main?.right ?? after.viewportWidth + 2).toBeLessThanOrEqual(after.viewportWidth + 1);
  });

  test('desktop header actions remain right aligned', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1024 });
    await page.addInitScript(() => localStorage.setItem('qatlia-locale', 'fr'));
    await page.goto('/atelier');

    const loginBox = await page.getByRole('link', { name: /connexion/i }).boundingBox();
    expect(loginBox).not.toBeNull();
    expect((loginBox?.x ?? 0) + (loginBox?.width ?? 0)).toBeGreaterThanOrEqual(1240);
  });

  test('atelier loads on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/atelier');
    await page.waitForSelector('text=QatlIA', { timeout: 5000 });
    await expect(page.getByText('QatlIA').first()).toBeVisible();
  });
});