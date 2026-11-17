import { test, expect } from '@playwright/test';

// « Configuration des panneaux » (owner request, 2026-11-17): the list of
// panels the artisan works with. Signed out, the list is kept on the device,
// which is what this journey exercises: add, edit, then remove in two clicks.

test.describe('Panel setup page', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('qatlia-locale', 'fr');
      window.localStorage.removeItem('qatlia-panel-presets');
    });
  });

  test('the bar leads to the page and marks it as the screen on display', async ({ page }) => {
    await page.goto('/history', { waitUntil: 'domcontentloaded' });
    const bar = page.getByRole('navigation', { name: 'Écrans de l’application' });
    await bar.getByRole('link', { name: 'Configuration des panneaux' }).click();

    await expect(page).toHaveURL(/\/panels$/);
    await expect(page.getByRole('heading', { name: 'Configuration des panneaux', level: 2 })).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Configuration des panneaux' })).toHaveAttribute('aria-current', 'page');
  });

  test('a signed-out artisan adds, edits and removes a panel of the device list', async ({ page }) => {
    await page.goto('/panels', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Cette liste est gardée sur cet appareil.')).toBeVisible();
    await expect(page.getByText('Aucun panneau enregistré.', { exact: false })).toBeVisible();

    await page.getByRole('button', { name: 'Préremplir avec Grand panneau 244 × 122' }).click();
    await page.getByLabel('Nom du panneau').first().fill('MDF blanc atelier');
    await page.getByRole('button', { name: 'Ajouter à ma liste' }).click();

    const row = page.getByRole('listitem').filter({ hasText: 'MDF blanc atelier' });
    await expect(row).toContainText('244.0 × 122.0 cm');

    await row.getByRole('button', { name: 'Modifier MDF blanc atelier' }).click();
    await row.getByLabel('Nom du panneau').fill('MDF 19 mm');
    await row.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'MDF 19 mm' })).toBeVisible();

    const edited = page.getByRole('listitem').filter({ hasText: 'MDF 19 mm' });
    await edited.getByRole('button', { name: 'Supprimer MDF 19 mm' }).click();
    await expect(edited.getByRole('button', { name: 'Confirmer la suppression de MDF 19 mm' })).toBeVisible();
    await edited.getByRole('button', { name: 'Confirmer la suppression de MDF 19 mm' }).click();
    await expect(page.getByText('Aucun panneau enregistré.', { exact: false })).toBeVisible();
  });
});
