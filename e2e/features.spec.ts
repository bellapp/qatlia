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

  test('initial Arabic load keeps the mobile atelier inside the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.addInitScript(() => localStorage.setItem('qatlia-locale', 'ar'));
    await page.goto('/atelier');

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');

    const widths = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    expect(Math.max(widths.documentWidth, widths.bodyWidth)).toBeLessThanOrEqual(widths.viewportWidth + 1);
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

test.describe('Arabic layout: no horizontal overflow at fixed viewports', () => {
  // Every viewport this app explicitly targets (mobile portrait x2, desktop)
  // — on both public pages an artisan can land on in Arabic. A component
  // that grows past 100dvw only in RTL (a fixed-width child fighting the
  // mirrored flex direction, an untranslated-but-longer string, a
  // non-wrapping row) would show up here as `scrollWidth`/`clientWidth`
  // exceeding the viewport, regardless of which specific element caused it.
  const VIEWPORTS = [
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 1280, height: 1024 },
  ] as const;
  const PAGES = ['/', '/atelier'] as const;

  for (const viewport of VIEWPORTS) {
    for (const path of PAGES) {
      test(`${path} at ${viewport.width}x${viewport.height} stays within the viewport in Arabic`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.addInitScript(() => localStorage.setItem('qatlia-locale', 'ar'));
        await page.goto(path, { waitUntil: 'domcontentloaded' });

        const html = page.locator('html');
        await expect(html).toHaveAttribute('dir', 'rtl');
        await expect(html).toHaveAttribute('lang', 'ar');
        // Let the page settle past first paint (fonts, layout of the
        // atelier's heavier client components) before measuring.
        await page.waitForSelector('text=QatlIA', { timeout: 15000 });

        const widths = await page.evaluate(() => ({
          viewport: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
        }));
        expect(Math.max(widths.documentWidth, widths.bodyWidth)).toBeLessThanOrEqual(widths.viewport + 1);
      });
    }
  }
});

test.describe('Keyboard focus order: DOM order holds, visual order mirrors under RTL', () => {
  // Tags every focusable header control with its document-order index, so
  // the assertions below read straight off the DOM/accessibility tree
  // instead of assuming anything about how the header's flexbox happens to
  // lay its children out.
  async function tagFocusableOrder(page: import('@playwright/test').Page, containerSelector: string) {
    return page.locator(containerSelector).evaluateAll((container) => {
      const root = container[0] as HTMLElement;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
      focusable.forEach((el, index) => el.setAttribute('data-tab-probe', String(index)));
      return focusable.length;
    });
  }

  // Tabs forward through the whole document (not just the header) and
  // records, in encounter order, the probe index of every tagged header
  // control the browser's native Tab order actually lands on -- so this is
  // exactly what a keyboard user experiences, not a re-derivation of it.
  async function observedTabOrder(page: import('@playwright/test').Page, steps: number): Promise<number[]> {
    const seen: number[] = [];
    for (let i = 0; i < steps; i++) {
      await page.keyboard.press('Tab');
      const probe = await page.evaluate(() => document.activeElement?.getAttribute('data-tab-probe') ?? null);
      if (probe !== null) seen.push(Number(probe));
    }
    // Keep only each probe's first appearance, in the order first reached —
    // a focus ring can legitimately revisit a control on a later Tab past
    // the header (e.g. a modal reopening focus), which isn't part of the
    // header's own order.
    return seen.filter((value, index) => seen.indexOf(value) === index);
  }

  // Sets the atelier's persisted locale and reloads, rather than
  // `page.addInitScript`: an initScript registered inside a per-locale loop
  // on the same `page` accumulates across iterations (Playwright never
  // un-registers a prior one), so by the second iteration *both* the fr-
  // and ar-setting scripts would run on every subsequent navigation. It
  // happened to still resolve correctly here (registration order matches
  // execution order, so the last-registered locale wins) — but that is an
  // accident of iteration count, not something to depend on. Navigating
  // first, then setting `localStorage` and reloading, applies exactly one
  // locale per iteration with nothing left over from the last one.
  async function setLocale(page: import('@playwright/test').Page, path: string, locale: 'fr' | 'ar') {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await page.evaluate((l) => localStorage.setItem('qatlia-locale', l), locale);
    await page.reload({ waitUntil: 'domcontentloaded' });
  }

  for (const [label, path, containerSelector] of [
    ['landing', '/', 'header'],
    ['atelier', '/atelier', 'header'],
  ] as const) {
    test(`${label} header: Tab visits controls in DOM order, in both LTR (fr) and RTL (ar)`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 1024 });

      for (const [locale, dir] of [
        ['fr', 'ltr'],
        ['ar', 'rtl'],
      ] as const) {
        await setLocale(page, path, locale);
        await expect(page.locator('html')).toHaveAttribute('dir', dir);
        await page.waitForSelector('text=QatlIA', { timeout: 15000 });

        const controlCount = await tagFocusableOrder(page, containerSelector);
        expect(controlCount).toBeGreaterThan(0);

        // Explicitly return focus to the very start of the document before
        // the first Tab of this iteration — the prior iteration's Tab
        // presses (or the reload above, which usually already clears focus)
        // must never let this iteration inherit a mid-page starting point.
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

        const observed = await observedTabOrder(page, controlCount + 5);
        const domOrder = Array.from({ length: controlCount }, (_, i) => i);
        // The controls actually reached, filtered to header controls only
        // (observedTabOrder already drops anything without a probe), must
        // come back as the *complete*, exact ascending DOM order — same
        // length, same sequence — regardless of whether the browser is
        // laying the row out LTR or mirrored RTL. A control skipped,
        // reordered, or a phantom extra stop would fail this single
        // assertion instead of silently passing a prefix-only check.
        expect(observed).toEqual(domOrder);
      }
    });

    test(`${label} header: visual (left-to-right) order actually mirrors between LTR (fr) and RTL (ar)`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 1024 });

      const firstLastX: Record<'fr' | 'ar', { first: number; last: number }> = { fr: null!, ar: null! };
      for (const locale of ['fr', 'ar'] as const) {
        await setLocale(page, path, locale);
        await page.waitForSelector('text=QatlIA', { timeout: 15000 });

        await tagFocusableOrder(page, containerSelector);
        const boxes = await page.locator(`${containerSelector} [data-tab-probe]`).evaluateAll((els) =>
          els
            .map((el) => ({ index: Number(el.getAttribute('data-tab-probe')), x: el.getBoundingClientRect().x }))
            .sort((a, b) => a.index - b.index)
        );
        firstLastX[locale] = { first: boxes[0].x, last: boxes[boxes.length - 1].x };
      }

      // Same DOM-order pair of controls; the first-in-DOM control sits to
      // the left of the last-in-DOM control in LTR, and to the right of it
      // in RTL — a real visual mirror, not just a `dir` attribute with no
      // rendered effect. Tab order itself is asserted separately above.
      expect(firstLastX.fr.first).toBeLessThan(firstLastX.fr.last);
      expect(firstLastX.ar.first).toBeGreaterThan(firstLastX.ar.last);
    });
  }
});