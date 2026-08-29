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

  test('atelier loads on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/atelier');
    await page.waitForSelector('text=QatlIA', { timeout: 5000 });
    await expect(page.getByText('QatlIA').first()).toBeVisible();
  });
});