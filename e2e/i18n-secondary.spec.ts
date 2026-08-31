import { test, expect, type Page } from '@playwright/test';

// Slice 3: the surfaces around the workshop — buying credits, the payment
// return page, the project history, the account space and the standalone
// sign-in page. What matters here is that the money and the account copy follow
// the artisan's language while the MAD amounts, the credit counts and the pack
// ids stay exactly what the billing catalog says they are.

const PACKS_FR = ['Pack Découverte', 'Pack Artisan', 'Pack Atelier Pro', 'Abonnement Atelier Max'];
const PACKS_EN = ['Starter Pack', 'Craftsman Pack', 'Pro Workshop Pack', 'Workshop Max Subscription'];
const PACKS_AR = ['باقة الانطلاق', 'باقة الصانع', 'باقة الورشة الاحترافية', 'اشتراك الورشة الأقصى'];

/** Catalog prices in MAD; identical in every locale. */
const PACK_PRICES = ['10', '40', '70', '99'];

/** Every group the localized pages read from, for the raw-key scan. */
const CATALOG_GROUPS =
  /\b(billing|creditsPage|creditsSuccess|historyPage|accountPage|loginPage|account|auth|atelier|nav|common|materials|emptyState)\.[a-zA-Z]/;

function switcher(page: Page, code: 'FR' | 'EN' | 'AR') {
  return page.getByRole('button', { name: code, exact: true }).first();
}

/** Seeds the persisted preference, as a returning visitor would carry it. */
async function seedLocale(page: Page, locale: 'fr' | 'en' | 'ar') {
  await page.addInitScript((value) => {
    window.localStorage.setItem('qatlia-locale', value);
  }, locale);
}

async function expectNoRawCopy(page: Page) {
  const body = (await page.locator('body').innerText()).trim();
  expect(body).not.toMatch(CATALOG_GROUPS);
  expect(body).not.toMatch(/\{[a-z]+\}/);
  expect(body).not.toContain('&apos;');
}

test.describe('Credits page localization', () => {
  test('French stays the default, with the catalog pack names and MAD prices', async ({ page }) => {
    await page.goto('/credits', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    for (const name of PACKS_FR) {
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: /Choisir le Pack Artisan/ })).toBeVisible();
  });

  test('English translates the packs and the credit policy without touching the amounts', async ({ page }) => {
    await page.goto('/credits', { waitUntil: 'domcontentloaded' });
    await switcher(page, 'EN').click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    // Pack names, description and the recurring pack's renewal note.
    for (const name of PACKS_EN) {
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }
    for (const name of PACKS_FR) {
      await expect(page.getByText(name, { exact: true })).toHaveCount(0);
    }
    await expect(page.getByText('1000 credits added to your balance every month')).toBeVisible();

    // The credit policy: only a successful photo analysis is charged.
    const policy = page.getByText(/1 credit is charged only when a photo analysis succeeds/i);
    await expect(policy).toBeVisible();
    await expect(policy).toContainText(/free and unlimited/i);

    // The figures are the catalog's, unchanged by the translation.
    for (const price of PACK_PRICES) {
      await expect(page.locator('span.text-3xl', { hasText: new RegExp(`^${price}$`) }).first()).toBeVisible();
    }
    await expect(page.getByRole('heading', { level: 1 })).toContainText('10 DH');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('10 photo analyses');
    await expect(page.getByText(/charged in dirhams \(MAD\)/i)).toBeVisible();

    // Balance and the per-pack call to action.
    await expect(page.getByText('Balance unavailable')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose the Craftsman Pack' })).toBeVisible();
    await expectNoRawCopy(page);
  });

  test('Arabic flips the credits page to RTL and keeps the MAD amounts in Western digits', async ({ page }) => {
    await page.goto('/credits', { waitUntil: 'domcontentloaded' });
    await switcher(page, 'AR').click();

    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'ar');
    await expect(html).toHaveAttribute('dir', 'rtl');

    for (const name of PACKS_AR) {
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }
    for (const price of PACK_PRICES) {
      const amount = page.locator('span.text-3xl', { hasText: new RegExp(`^${price}$`) }).first();
      await expect(amount).toBeVisible();
      // A price is a Latin figure whatever the page direction is.
      expect(await amount.evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
    }
    const body = await page.locator('body').innerText();
    expect(body, 'Morocco writes figures with Western digits').not.toMatch(/[٠-٩]/);
    await expectNoRawCopy(page);
  });

  test('the Arabic credits page stays inside a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/credits', { waitUntil: 'domcontentloaded' });
    await switcher(page, 'AR').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText(PACKS_AR[0], { exact: true })).toBeVisible();

    const widths = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(Math.max(widths.document, widths.body)).toBeLessThanOrEqual(widths.viewport + 1);

    await page.setViewportSize({ width: 1280, height: 1024 });
  });

  test('the payment return page reads in the seeded locale, demo mode included', async ({ page }) => {
    await seedLocale(page, 'en');

    await page.goto('/credits/success', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Payment received' })).toBeVisible();
    await expect(page.getByText('Credit balance updated')).toBeVisible();
    await expect(page.getByRole('link', { name: /Back to panel cutting/ })).toBeVisible();
    await expectNoRawCopy(page);

    // The demo link grants nothing, so it must not claim a recharge in any language.
    await page.goto('/credits/success?demo=true', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Demonstration mode' })).toBeVisible();
    await expect(page.getByText('Balance unchanged')).toBeVisible();
    await expect(page.getByText('Payment received')).toHaveCount(0);
    await expectNoRawCopy(page);
  });
});

test.describe('History page localization', () => {
  test('a signed-out English visitor reads the whole history chrome in English', async ({ page }) => {
    await page.goto('/history', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Historique' })).toBeVisible();

    await switcher(page, 'EN').click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your cut lists' })).toBeVisible();
    await expect(page.getByText('Reopen a plan, run the nesting again or export the PDF once more.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Refresh/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Workshop', exact: true })).toBeVisible();
    // Signed out: the sign-in call to action, not the account menu.
    await expect(page.getByRole('link', { name: /^Sign in$/ })).toBeVisible();
    // The empty state of a visitor with no saved plan.
    await expect(page.getByRole('heading', { name: 'Ready to nest' })).toBeVisible();
    await expectNoRawCopy(page);
  });

  test('Arabic flips the history page to RTL', async ({ page }) => {
    await seedLocale(page, 'ar');
    await page.goto('/history', { waitUntil: 'domcontentloaded' });

    const html = page.locator('html');
    await expect(html).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'قوائم القطع الخاصة بك' })).toBeVisible();
    await expect(page.getByRole('button', { name: /تحديث/ })).toBeVisible();
    await expectNoRawCopy(page);
  });
});

test.describe('Account and sign-in localization', () => {
  test('a signed-out visitor is sent to a fully translated sign-in page', async ({ page }) => {
    await seedLocale(page, 'en');
    await page.goto('/account', { waitUntil: 'domcontentloaded' });

    await page.waitForURL(/\/auth\/login\?redirect=%2Faccount|\/auth\/login\?redirect=\/account/);
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByText('Pick up your cut lists and credits.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.getByText('or email', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /No account yet\? Create one \(\+ 5 credits\)/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to the workshop' })).toBeVisible();
    await expectNoRawCopy(page);
  });

  test('the sign-in page translates the sign-up form and its perks', async ({ page }) => {
    await page.goto('/auth/login', { waitUntil: 'domcontentloaded' });
    await switcher(page, 'EN').click();

    await page.getByRole('button', { name: /No account yet\?/ }).click();

    await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
    await expect(page.getByText('5 free credits to run your first scans.')).toBeVisible();
    await expect(page.getByPlaceholder('Atlas Joinery')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create the account' })).toBeVisible();
    // The password toggle is named by what it does, in the active language.
    await expect(page.getByRole('button', { name: 'Show the password' })).toBeVisible();
    await expectNoRawCopy(page);
  });

  test('Arabic sign-in mirrors without overflowing a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedLocale(page, 'ar');
    await page.goto('/auth/login', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'تسجيل الدخول', exact: true })).toBeVisible();
    // The address stays a Latin identifier.
    const emailField = page.getByPlaceholder('artisan@atelier.ma');
    expect(await emailField.evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');

    const widths = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(Math.max(widths.document, widths.body)).toBeLessThanOrEqual(widths.viewport + 1);

    await page.setViewportSize({ width: 1280, height: 1024 });
  });
});

test.describe('Locale persistence across the secondary surfaces', () => {
  test('a locale chosen on the landing page still applies on credits and history', async ({ page }) => {
    await page.goto('/');
    await switcher(page, 'EN').click();
    await expect(page.locator('h1')).toContainText('Optimize your panels');

    await page.goto('/credits', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByText('Starter Pack', { exact: true })).toBeVisible();

    await page.goto('/history', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: 'Your cut lists' })).toBeVisible();

    // And it survives a reload of the last page in the journey.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('heading', { name: 'Your cut lists' })).toBeVisible();
  });

  test('no raw translation key leaks into any secondary page in any locale', async ({ page }) => {
    for (const locale of ['fr', 'en', 'ar'] as const) {
      await seedLocale(page, locale);
      for (const path of ['/credits', '/credits/success', '/history', '/auth/login']) {
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expectNoRawCopy(page);
      }
    }
  });
});
