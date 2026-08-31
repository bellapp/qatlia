import { test, expect, type Page } from '@playwright/test';

// The language switcher must actually re-render the page, survive a reload, and
// flip the document direction for Arabic — including on the very first paint of
// a seeded visit, where a late React effect would show a French/LTR flash.

const HERO_FR = 'Optimisez vos panneaux';
const HERO_EN = 'Optimize your panels';
const HERO_AR = 'حسِّن ألواحك';

function switcher(page: Page, code: 'FR' | 'EN' | 'AR') {
  return page.getByRole('button', { name: code, exact: true }).first();
}

test.describe('Landing page localization', () => {
  test('defaults to French, then switching to EN changes the visible hero and CTA', async ({ page }) => {
    await page.goto('/');

    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'fr');
    await expect(html).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('h1')).toContainText(HERO_FR);

    await switcher(page, 'EN').click();

    await expect(page.locator('h1')).toContainText(HERO_EN);
    await expect(page.getByRole('link', { name: /try (it )?free/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /sign in/i }).first()).toBeVisible();
    await expect(html).toHaveAttribute('lang', 'en');
    await expect(html).toHaveAttribute('dir', 'ltr');
  });

  test('the chosen locale survives a reload', async ({ page }) => {
    await page.goto('/');
    await switcher(page, 'EN').click();
    await expect(page.locator('h1')).toContainText(HERO_EN);

    await page.reload();

    await expect(page.locator('h1')).toContainText(HERO_EN);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('switching to Arabic translates the hero and flips the document to RTL', async ({ page }) => {
    await page.goto('/');
    await switcher(page, 'AR').click();

    await expect(page.locator('h1')).toContainText(HERO_AR);
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'ar');
    await expect(html).toHaveAttribute('dir', 'rtl');
  });

  test('a seeded Arabic visit is already RTL at DOMContentLoaded', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('qatlia-locale', 'ar');
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Read the direction before waiting on React: the inline init script owns
    // this, so it must already be correct while the page is still loading.
    expect(await page.locator('html').getAttribute('dir')).toBe('rtl');
    expect(await page.locator('html').getAttribute('lang')).toBe('ar');
    await expect(page.locator('h1')).toContainText(HERO_AR);
  });

  test('no raw translation keys leak into the rendered landing page', async ({ page }) => {
    for (const code of ['FR', 'EN', 'AR'] as const) {
      await page.goto('/');
      await switcher(page, code).click();
      const body = (await page.locator('body').innerText()).trim();
      expect(body).not.toMatch(/\b(nav|hero|stats|features|steps|finalCta|footer|language)\.[a-zA-Z]/);
      expect(body).not.toMatch(/\{[a-z]+\}/);
      expect(body).not.toContain('&apos;');
    }
  });
});
