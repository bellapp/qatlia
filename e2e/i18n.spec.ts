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

// Slice 2: the workshop itself. The atelier is where an artisan actually works,
// so every label they read or act on has to follow the switcher — not just the
// marketing page.

async function openAtelier(page: Page) {
  await page.goto('/atelier', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('img', { name: 'QatlIA' })).toBeVisible({ timeout: 15000 });
}

test.describe('Atelier localization', () => {
  test('switching to English translates the workshop chrome an artisan reads', async ({ page }) => {
    await openAtelier(page);

    // French is still the default inside the workshop.
    await expect(page.getByRole('link', { name: /historique/i })).toBeVisible();

    await switcher(page, 'EN').click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    // Header: tagline, history, credits, guided tour.
    await expect(page.getByText('Cutting & nesting workshop')).toBeVisible();
    await expect(page.getByRole('link', { name: /^history$/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /credits/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tour', exact: true })).toBeVisible();
    await expect(page.getByTitle('Guided tour')).toBeVisible();
    // The 1D/2D toggle keeps its domain labels; only the tooltip is translated.
    await expect(page.getByTitle('2D cutting — panels')).toBeVisible();
    await expect(page.getByTitle('1D cutting — bars')).toBeVisible();
    // Quick actions.
    await expect(page.getByText('Scan a paper cut list')).toBeVisible();
    await expect(page.getByText('Upload a file')).toBeVisible();
    // Stock panel, including the material label — the payload value stays `mdf`.
    await expect(page.getByRole('heading', { name: 'Raw panel in stock' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Project display unit' })).toBeVisible();
    const material = page.getByRole('combobox', { name: 'Panel material' });
    await expect(material).toHaveValue('mdf');
    await expect(material).toContainText('MDF / Wood');
    // Pieces manager — the panel the atelier hands the piece list to.
    await expect(page.getByPlaceholder('Filter...')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Paste from Excel' })).toBeVisible();
    // The primary call to action of the piece list, and the quick-add form it
    // opens: the one control an artisan uses on every single cut list.
    const addPiece = page.getByRole('button', { name: 'Add a piece' });
    await expect(addPiece).toBeVisible();
    await addPiece.click();
    // Quick-add fields are named by their own <label>, so these locators cannot
    // fall through to the aria-labelled inputs of the existing piece rows.
    await expect(page.getByRole('spinbutton', { name: 'H (cm)', exact: true })).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: 'W (cm)', exact: true })).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: 'Qty', exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('e.g. Left side')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add the piece' })).toBeVisible();
    await expect(page.getByText('Edging:', { exact: true })).toBeVisible();
    // Existing rows read English too — aria names, not just the visible chrome.
    await expect(page.getByRole('spinbutton', { name: 'Quantity' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete', exact: true }).first()).toBeAttached();
    // The optimizer CTA.
    await expect(page.getByRole('button', { name: 'Optimize the cut plan' })).toBeVisible();
  });

  test('the advanced options panel is translated once expanded', async ({ page }) => {
    await openAtelier(page);
    await switcher(page, 'EN').click();

    const toggle = page.getByRole('button', { name: 'Advanced cutting settings' });
    await expect(toggle).toBeVisible();
    await toggle.click();

    await expect(page.getByText('Blade thickness (kerf)')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Optimization goal' })).toContainText(
      'Edge-to-edge guillotine cuts (workshop)'
    );
    await expect(page.getByText('Lock the grain direction')).toBeVisible();
    await expect(page.getByText('Pricing')).toBeVisible();
  });

  test('an English optimization run translates the results, plan and exports', async ({ page }) => {
    await openAtelier(page);
    await switcher(page, 'EN').click();

    await page.getByRole('button', { name: 'Optimize the cut plan' }).click();

    // Result stats.
    await expect(page.getByText('Estimated total cost')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Sheets', { exact: true })).toBeVisible();
    await expect(page.getByText('Usable', { exact: true })).toBeVisible();
    await expect(page.getByText('Waste', { exact: true })).toBeVisible();
    // Sheet tabs and zoom controls.
    await expect(page.getByRole('button', { name: /^Sheet 1/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zoom out' })).toBeVisible();
    // Cut list + offcuts.
    const cutList = page.getByRole('table', { name: 'Cutting order' });
    await expect(cutList.getByRole('columnheader', { name: 'Piece' })).toBeVisible();
    await expect(cutList.getByRole('columnheader', { name: /H × W/ })).toBeVisible();
    await expect(cutList.getByRole('columnheader', { name: 'Rotation' })).toBeVisible();
    await expect(page.getByTestId('offcuts-list')).toContainText('Offcuts');
    // Cost breakdown + exports.
    await expect(page.getByText('Cost estimate')).toBeVisible();
    await expect(page.getByText('Labour', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export the PDF report' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download the plan as DXF for CNC' })).toBeVisible();
  });

  test('the workshop locale survives a reload', async ({ page }) => {
    await openAtelier(page);
    await switcher(page, 'EN').click();
    await expect(page.getByRole('button', { name: 'Optimize the cut plan' })).toBeVisible();

    await page.reload();

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: 'Optimize the cut plan' })).toBeVisible();
    await expect(page.getByRole('link', { name: /^history$/i })).toBeVisible();
  });

  test('Arabic translates the workshop and flips it to RTL', async ({ page }) => {
    await openAtelier(page);
    await switcher(page, 'AR').click();

    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'ar');
    await expect(html).toHaveAttribute('dir', 'rtl');

    await expect(page.getByRole('link', { name: 'السجل' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'اللوح الخام في المخزون' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'حسِّن مخطط القطع' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'إعدادات القطع المتقدمة' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'مادة اللوح' })).toHaveValue('mdf');

    // The cut plan itself is geometry: it must stay LTR whatever the page does.
    await page.getByRole('button', { name: 'حسِّن مخطط القطع' }).click();
    const plan = page.getByTestId('cut-plan-viewport');
    await expect(plan).toBeVisible({ timeout: 15000 });
    expect(await plan.evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
  });

  test('the Arabic workshop stays inside a mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAtelier(page);
    await switcher(page, 'AR').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    const widths = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(Math.max(widths.document, widths.body)).toBeLessThanOrEqual(widths.viewport + 1);

    await page.setViewportSize({ width: 1280, height: 1024 });
  });

  test('no raw translation keys leak into the rendered workshop', async ({ page }) => {
    for (const code of ['FR', 'EN', 'AR'] as const) {
      await openAtelier(page);
      await switcher(page, code).click();
      await page.getByRole('button', { name: /optimiser|optimize|حسِّن/i }).click();
      await expect(page.getByTestId('cut-plan-svg')).toBeVisible({ timeout: 15000 });

      const body = (await page.locator('body').innerText()).trim();
      expect(body).not.toMatch(
        /\b(atelier|pieces|options|emptyState|tour|account|auth|materials|common|nav)\.[a-zA-Z]/
      );
      expect(body).not.toMatch(/\{[a-z]+\}/);
      expect(body).not.toContain('&apos;');
    }
  });
});
