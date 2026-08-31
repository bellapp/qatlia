import { test, expect } from '@playwright/test';

// Task 8 — the QuotationDialog UI: available only after a result, responsive
// in FR/AR, VAT off by default (explicit, never a silent 20%), and a mocked
// authenticated successful download with the exact request payload shape.
//
// Real Supabase auth is never exercised here (no test account/credentials
// available) — the session and the /auth/v1/user revalidation call are
// mocked at the network boundary, exactly like /api/export-quotation itself,
// so the test stays deterministic and offline.

const FAKE_USER = {
  id: '11111111-2222-4333-8444-555555555555',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'artisan@example.ma',
  app_metadata: {},
  user_metadata: {},
  created_at: new Date().toISOString(),
};

function fakeSession() {
  return {
    access_token: 'fake-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'fake-refresh-token',
    user: FAKE_USER,
  };
}

/** Supabase-js's default localStorage key: `sb-<project-ref>-auth-token`. */
function supabaseStorageKey(supabaseUrl: string): string {
  const host = new URL(supabaseUrl).hostname;
  const ref = host.split('.')[0];
  return `sb-${ref}-auth-token`;
}

async function mockAuthenticatedSession(page: import('@playwright/test').Page) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://demo-placeholder.supabase.co';
  const cookieName = supabaseStorageKey(supabaseUrl);
  const session = fakeSession();

  // `@supabase/ssr`'s browser client persists the session as a *cookie*
  // (never localStorage, unlike the plain supabase-js default) so the same
  // session is readable server-side too, and by default (cookieEncoding:
  // "base64url") the value is a `base64-` prefix followed by the
  // base64url-encoded session JSON — see
  // node_modules/@supabase/ssr/dist/module/cookies.js's `createStorageFromOptions`.
  const encoded = `base64-${Buffer.from(JSON.stringify(session), 'utf-8').toString('base64url')}`;
  await page.context().addCookies([{ name: cookieName, value: encoded, domain: 'localhost', path: '/' }]);

  // getUser() always revalidates against the server rather than trusting the
  // locally cached session — intercepting this is what actually makes the
  // dialog see a signed-in artisan.
  await page.route('**/auth/v1/user', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(FAKE_USER) })
  );
  await page.route('**/auth/v1/token**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) })
  );
}

const MINIMAL_PDF = Buffer.from(
  '%PDF-1.3\n%\xC2\xA5\xC2\xB1\xC3\x8B\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
  'binary'
);

async function runOptimization(page: import('@playwright/test').Page) {
  await page.goto('/atelier', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('img', { name: 'QatlIA' })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: /optimiser/i }).first().click();
  await expect(page.getByTestId('cut-plan-svg')).toBeVisible({ timeout: 15000 });
}

test.describe('Quotation dialog', () => {
  test('the "Devis client" action is absent before optimizing and appears once a result exists', async ({ page }) => {
    await page.goto('/atelier', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('img', { name: 'QatlIA' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Devis client' })).toHaveCount(0);

    await page.getByRole('button', { name: /optimiser/i }).first().click();
    await expect(page.getByTestId('cut-plan-svg')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Devis client' })).toBeVisible();
  });

  test('opens as a labelled, dismissible dialog with company/client fields', async ({ page }) => {
    await runOptimization(page);
    await page.getByRole('button', { name: 'Devis client' }).click();

    const dialog = page.getByTestId('quotation-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Devis client' })).toBeVisible();
    await expect(dialog.getByLabel('Nom de l’entreprise')).toBeVisible();
    await expect(dialog.getByLabel('Nom du client')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('VAT is off by default (unchecked, no rate shown) — never a silent default rate', async ({ page }) => {
    await runOptimization(page);
    await page.getByRole('button', { name: 'Devis client' }).click();
    const dialog = page.getByTestId('quotation-dialog');

    const vatCheckbox = dialog.getByRole('checkbox', { name: /tva/i });
    await expect(vatCheckbox).not.toBeChecked();
    await expect(dialog.getByLabel(/taux \(%\)/i)).toHaveCount(0);
  });

  test('the document-language toggle defaults to French and switches to Arabic on click', async ({ page }) => {
    await runOptimization(page);
    await page.getByRole('button', { name: 'Devis client' }).click();
    const dialog = page.getByTestId('quotation-dialog');

    const frToggle = dialog.getByRole('button', { name: 'Français' });
    const arToggle = dialog.getByRole('button', { name: 'Arabe' });
    await expect(frToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(arToggle).toHaveAttribute('aria-pressed', 'false');

    await arToggle.click();
    await expect(arToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(frToggle).toHaveAttribute('aria-pressed', 'false');
  });

  test('stays usable at a narrow (mobile) viewport width, in both FR and AR UI locale', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await runOptimization(page);
    await page.getByRole('button', { name: 'Devis client' }).click();

    const dialog = page.getByTestId('quotation-dialog');
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(375);
    await expect(dialog.getByRole('button', { name: 'Générer le PDF' })).toBeVisible();

    await page.keyboard.press('Escape');

    // Switch the UI locale to Arabic (RTL) and repeat the width check.
    await page.locator('button').filter({ hasText: 'AR' }).first().click();
    await page.getByRole('button', { name: /عرض سعر للزبون/ }).click();
    const arDialog = page.getByTestId('quotation-dialog');
    await expect(arDialog).toBeVisible();
    const arBox = await arDialog.boundingBox();
    expect(arBox).not.toBeNull();
    expect(arBox!.width).toBeLessThanOrEqual(375);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('a mocked authenticated submit downloads the PDF and sends the exact expected payload', async ({ page }) => {
    await mockAuthenticatedSession(page);

    let capturedPayload: Record<string, unknown> | null = null;
    await page.route('**/api/export-quotation', (route) => {
      capturedPayload = route.request().postDataJSON();
      route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        headers: { 'Content-Disposition': 'attachment; filename="devis.pdf"' },
        body: MINIMAL_PDF,
      });
    });

    await runOptimization(page);
    await page.getByRole('button', { name: 'Devis client' }).click();
    const dialog = page.getByTestId('quotation-dialog');

    await dialog.getByLabel('Nom de l’entreprise').fill('Atelier Karim');
    await dialog.getByLabel('Nom du client').fill('Client Test');
    await dialog.getByLabel('N° de devis').fill('DEV-TEST-001');
    await dialog.getByLabel('Référence projet').fill('PO-2026-0456');

    const downloadPromise = page.waitForEvent('download', { timeout: 8000 });
    await dialog.getByRole('button', { name: 'Générer le PDF' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);

    await expect(dialog.getByRole('status')).toBeVisible();

    expect(capturedPayload).not.toBeNull();
    const payload = capturedPayload as unknown as Record<string, unknown>;
    expect(payload.quoteNumber).toBe('DEV-TEST-001');
    expect((payload.company as { name: string }).name).toBe('Atelier Karim');
    expect((payload.client as { name: string }).name).toBe('Client Test');
    expect(payload.projectReference).toBe('PO-2026-0456');
    expect(payload.tax).toEqual({ mode: 'none' });
    expect(payload.discount).toEqual({ mode: 'none' });
    expect(payload.deliveryCost).toBe(0);
    expect(payload.locale).toBe('fr');
    expect(payload.includeAmountInWords).toBe(false);
    expect(payload.costingInput).toBeTruthy();
    expect(payload.logoDataUrl).toBeUndefined();
  });

  test('an empty project reference is sent as undefined, never an empty string', async ({ page }) => {
    await mockAuthenticatedSession(page);

    let capturedPayload: Record<string, unknown> | null = null;
    await page.route('**/api/export-quotation', (route) => {
      capturedPayload = route.request().postDataJSON();
      route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        headers: { 'Content-Disposition': 'attachment; filename="devis.pdf"' },
        body: MINIMAL_PDF,
      });
    });

    await runOptimization(page);
    await page.getByRole('button', { name: 'Devis client' }).click();
    const dialog = page.getByTestId('quotation-dialog');

    await dialog.getByLabel('Nom de l’entreprise').fill('Atelier Karim');
    await dialog.getByLabel('Nom du client').fill('Client Test');

    const downloadPromise = page.waitForEvent('download', { timeout: 8000 });
    await dialog.getByRole('button', { name: 'Générer le PDF' }).click();
    await downloadPromise;

    expect(capturedPayload).not.toBeNull();
    expect((capturedPayload as unknown as Record<string, unknown>).projectReference).toBeUndefined();
  });

  test('company identity persists locally across dialog opens, but the client never does (no local client PII)', async ({ page }) => {
    await mockAuthenticatedSession(page);
    await page.route('**/api/export-quotation', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        headers: { 'Content-Disposition': 'attachment; filename="devis.pdf"' },
        body: MINIMAL_PDF,
      })
    );

    await runOptimization(page);
    await page.getByRole('button', { name: 'Devis client' }).click();
    let dialog = page.getByTestId('quotation-dialog');
    await dialog.getByLabel('Nom de l’entreprise').fill('Atelier Karim');
    await dialog.getByLabel('Nom du client').fill('Client Confidentiel');

    const downloadPromise = page.waitForEvent('download', { timeout: 8000 });
    await dialog.getByRole('button', { name: 'Générer le PDF' }).click();
    await downloadPromise;
    await expect(dialog.getByRole('status')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    await page.getByRole('button', { name: 'Devis client' }).click();
    dialog = page.getByTestId('quotation-dialog');
    await expect(dialog.getByLabel('Nom de l’entreprise')).toHaveValue('Atelier Karim');
    await expect(dialog.getByLabel('Nom du client')).toHaveValue('');
  });

  test('Tab from the last focusable control wraps back to the first, trapping focus inside the dialog', async ({ page }) => {
    await runOptimization(page);
    await page.getByRole('button', { name: 'Devis client' }).click();
    const dialog = page.getByTestId('quotation-dialog');
    // DOM order: the close ("Fermer") button is the dialog's first focusable
    // element, the "Générer le PDF" submit button its last.
    const closeButton = dialog.getByRole('button', { name: 'Fermer' });
    const submitButton = dialog.getByRole('button', { name: 'Générer le PDF' });

    await submitButton.focus();
    await page.keyboard.press('Tab');
    await expect(closeButton).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect(submitButton).toBeFocused();
  });

  test('an unauthenticated submit opens the sign-in modal instead of calling the API', async ({ page }) => {
    let quotationCalls = 0;
    await page.route('**/api/export-quotation', (route) => {
      quotationCalls += 1;
      route.abort();
    });

    await runOptimization(page);
    await page.getByRole('button', { name: 'Devis client' }).click();
    const dialog = page.getByTestId('quotation-dialog');
    await dialog.getByLabel('Nom de l’entreprise').fill('Atelier Karim');
    await dialog.getByLabel('Nom du client').fill('Client Test');

    await dialog.getByRole('button', { name: 'Générer le PDF' }).click();
    // Triggered from the quotation flow, the shared auth modal takes the
    // contextual "Devis client" title and quotation-specific subtitle (see
    // AuthModal's title/subtitle prop wiring in atelier/page.tsx) instead of
    // its generic PDF-report default — that subtitle text is what
    // distinguishes it from the (still-open) QuotationDialog underneath,
    // which shares the same "Devis client" heading text.
    await expect(page.getByText('Connectez-vous pour générer un devis client.')).toBeVisible({ timeout: 10000 });
    expect(quotationCalls).toBe(0);
  });
});
