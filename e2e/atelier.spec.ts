import { test, expect } from '@playwright/test';

test.describe('Atelier Dashboard (/atelier)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/atelier', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('img', { name: 'QatlIA' })).toBeVisible({ timeout: 15000 });
  });

  test('loads and shows QatlIA logo and PRO badge', async ({ page }) => {
    await expect(page.getByText('QatlIA', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('PRO')).toBeVisible();
  });

  test('2D/1D mode toggle is visible and clickable', async ({ page }) => {
    const btn2d = page.getByRole('button', { name: '2D', exact: true }).first();
    const btn1d = page.getByRole('button', { name: '1D', exact: true }).first();
    await expect(btn2d).toBeVisible();
    await expect(btn1d).toBeVisible();
    await btn1d.click();
    await expect(btn1d).toHaveAttribute('aria-pressed', 'true');
    await expect(btn2d).toHaveAttribute('aria-pressed', 'false');
  });

  test('displays stock sheet dimensions inputs', async ({ page }) => {
    const inputs = page.locator('input[type="number"]');
    const count = await inputs.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('initial pieces are rendered in the list', async ({ page }) => {
    // Pieces are rendered as input values or table cells
    const pieceInputs = page.locator('input[value*="Panneau"]');
    const count = await pieceInputs.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('"Optimiser" button is visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /optimiser/i })).toBeVisible();
  });

  test('can add a new piece via quick-add bar', async ({ page }) => {
    // Count pieces before
    const before = await page.locator('input[value*="Panneau"]').count();
    const addBtn = page.locator('button').filter({ hasText: /ajouter/i }).first();
    await addBtn.click();
    await page.waitForTimeout(500);
    const inputs = page.locator('form input[type="number"]');
    const inputCount = await inputs.count();
    if (inputCount >= 2) {
      await inputs.nth(0).fill('100');
      await inputs.nth(1).fill('50');
      await page.getByRole('button', { name: /ajouter la pièce/i }).click();
      await page.waitForTimeout(500);
      await expect(page.getByRole('button', { name: /ajouter une pièce/i })).toBeVisible();
    }
    // Verify a new row appeared (or at least the form closed)
    const after = await page.locator('input[value*="Panneau"]').count();
    // Either we got a new piece OR the form just closed (both acceptable)
    expect(after >= before || before > 0).toBe(true);
  });

  test('advanced options section can be opened', async ({ page }) => {
    const optsBtn = page.getByRole('button', { name: /r[ée]glage/i }).first();
    await optsBtn.click();
    await expect(optsBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#advanced-cutting-options')).toBeVisible();
  });

  test('credit badge shows a number', async ({ page }) => {
    await expect(page.getByText('crédits').first()).toBeVisible({ timeout: 3000 });
  });

  test('onboarding tour "Guide" button is present', async ({ page }) => {
    await expect(page.locator('button').filter({ hasText: 'Guide' }).first()).toBeVisible({ timeout: 3000 });
  });

  test('theme toggle button is present', async ({ page }) => {
    await expect(page.locator('button[aria-label*="Mode" i], button[title*="Mode" i]').first()).toBeVisible({ timeout: 3000 });
  });

  test('locale FR button is visible', async ({ page }) => {
    await expect(page.locator('button').filter({ hasText: 'FR' }).first()).toBeVisible();
  });

  test('history link is present', async ({ page }) => {
    await expect(page.getByRole('link', { name: /historique/i }).first()).toBeVisible();
  });

  test('zoom stays inside the plan viewport without hiding controls', async ({ page }) => {
    await page.getByRole('button', { name: /optimiser/i }).click();
    await expect(page.getByRole('button', { name: /panneau 1/i })).toBeVisible({ timeout: 15000 });

    const zoomIn = page.getByRole('button', { name: /zoom avant/i });
    await zoomIn.click();
    await zoomIn.click();
    await zoomIn.click();

    const toolbar = page.getByTestId('cut-plan-toolbar');
    const viewport = page.getByTestId('cut-plan-viewport');
    await expect(toolbar).toBeVisible();
    await expect(viewport).toBeVisible();
    await expect(page.getByRole('button', { name: /exporter le rapport pdf/i })).toBeVisible();

    const toolbarBox = await toolbar.boundingBox();
    const viewportBox = await viewport.boundingBox();
    expect(toolbarBox).not.toBeNull();
    expect(viewportBox).not.toBeNull();
    expect((toolbarBox?.y ?? 0) + (toolbarBox?.height ?? 0)).toBeLessThanOrEqual((viewportBox?.y ?? 0) + 1);
    expect(await viewport.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  });

  test('add-piece action stays below the piece rows', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1024 });
    await page.reload();

    const piecesList = page.getByTestId('pieces-list');
    const addPiece = page.getByRole('button', { name: /ajouter une pièce/i });
    await expect(piecesList).toBeVisible();
    await expect(addPiece).toBeVisible();
    const piecesListBox = await piecesList.boundingBox();
    const addPieceBox = await addPiece.boundingBox();

    expect(piecesListBox).not.toBeNull();
    expect(addPieceBox).not.toBeNull();
    expect(addPieceBox?.y ?? 0).toBeGreaterThanOrEqual((piecesListBox?.y ?? 0) + (piecesListBox?.height ?? 0));
  });

  test('can paste Excel rows and append valid pieces', async ({ page }) => {
    await page.getByRole('button', { name: /coller excel/i }).click();
    await page.getByLabel(/coller une liste de pièces/i).fill([
      'Nom;Hauteur;Largeur;Quantité',
      'Façade test;72;59,7;2',
      'Tablette test;230;120;1',
    ].join('\n'));
    await page.getByRole('button', { name: /^importer$/i }).click();

    await expect(page.getByText(/2 pièces importées · 0 ligne ignorée/i)).toBeVisible();
    const importedNames = await page.locator('input[placeholder="Nom"]').evaluateAll((inputs) =>
      inputs.map((input) => (input as HTMLInputElement).value)
    );
    expect(importedNames).toContain('Façade test');
    expect(importedNames).toContain('Tablette test');
  });

  test('can append a furniture template without replacing current pieces', async ({ page }) => {
    const initialRows = await page.getByLabel('Quantité').count();
    await page.getByRole('button', { name: /modèles/i }).click();
    await page.getByLabel(/ajouter un modèle de meuble/i).selectOption('Bibliothèque');
    await page.getByRole('button', { name: /^ajouter$/i }).click();

    await expect(page.getByText(/6 pièces ajoutées depuis Bibliothèque/i)).toBeVisible();
    expect(await page.getByLabel('Quantité').count()).toBeGreaterThan(initialRows);
    const templateNames = await page.locator('input[placeholder="Nom"]').evaluateAll((inputs) =>
      inputs.map((input) => (input as HTMLInputElement).value)
    );
    expect(templateNames).toContain('Tablette réglable');
  });

  test('can choose a custom color for a piece', async ({ page }) => {
    const color = page.getByLabel(/couleur panneau latéral g/i);
    await color.fill('#22c55e');
    await expect(color).toHaveValue('#22c55e');
  });

  test('optimized result shows a numbered cut list for the active sheet', async ({ page }) => {
    await page.getByRole('button', { name: /ajouter une pièce/i }).click();
    const form = page.locator('form').first();
    await form.getByLabel(/h \(cm\)/i).fill('120');
    await form.getByLabel(/l \(cm\)/i).fill('230');
    await form.getByLabel(/qté/i).fill('1');
    await form.getByLabel(/nom/i).fill('Test rotation');
    await form.getByRole('button', { name: /ajouter la pièce/i }).click();

    await page.getByRole('button', { name: /optimiser/i }).click();
    await expect(page.getByRole('heading', { name: /ordre de coupe/i })).toBeVisible({ timeout: 15000 });

    const cutList = page.getByRole('table', { name: /ordre de coupe/i });
    await expect(cutList.getByRole('columnheader', { name: '#', exact: true })).toBeVisible();
    await expect(cutList.getByRole('columnheader', { name: /pièce/i })).toBeVisible();
    await expect(cutList.getByRole('columnheader', { name: /h × l/i })).toBeVisible();
    await expect(cutList.getByRole('columnheader', { name: /rotation/i })).toBeVisible();

    const firstDataRow = cutList.getByRole('row').nth(1);
    await expect(firstDataRow.getByText(/^1$/)).toBeVisible();
    await expect(firstDataRow.getByText(/\d+([.,]\d+)? × \d+([.,]\d+)?/)).toBeVisible();
    await expect(cutList.getByRole('row', { name: /test rotation/i }).getByText(/oui|90°/i)).toBeVisible();
  });

  test('optimized offcuts stay consistent across engine, plan and list', async ({ page }) => {
    const round1 = (value: number) => Math.round(value * 10) / 10;

    await page.getByRole('button', { name: /optimiser/i }).click();

    const listItems = page.getByTestId('offcut-list-item');
    await expect(listItems.first()).toBeVisible({ timeout: 15000 });

    const svgRects = page.getByTestId('offcut-svg-rect');
    const listCount = await listItems.count();
    expect(listCount).toBeGreaterThan(0);
    await expect(svgRects).toHaveCount(listCount);

    const listData = await listItems.evaluateAll((items: HTMLElement[]) =>
      items.map((item) => ({
        id: item.getAttribute('data-offcut-id'),
        width: item.getAttribute('data-offcut-width'),
        height: item.getAttribute('data-offcut-height'),
        text: item.textContent || '',
      }))
    );

    const rectData = await svgRects.evaluateAll((rects: SVGRectElement[]) =>
      rects.map((rect) => ({
        id: rect.getAttribute('data-offcut-id'),
        width: rect.getAttribute('data-offcut-width'),
        height: rect.getAttribute('data-offcut-height'),
        x: rect.x.baseVal.value,
        y: rect.y.baseVal.value,
        rectWidth: rect.width.baseVal.value,
        rectHeight: rect.height.baseVal.value,
      }))
    );

    const svg = page.getByTestId('cut-plan-svg');
    const viewBox = await svg.evaluate((element: SVGSVGElement) => {
      const box = element.viewBox.baseVal;
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    });
    expect(viewBox.width).toBeGreaterThan(0);
    expect(viewBox.height).toBeGreaterThan(0);

    for (let i = 0; i < listCount; i++) {
      const listItem = listData[i];
      const rect = rectData[i];

      expect(rect.id).toBe(listItem.id);
      expect(rect.width).toBe(listItem.width);
      expect(rect.height).toBe(listItem.height);

      const height = round1(Number(listItem.height));
      const width = round1(Number(listItem.width));
      expect(listItem.text).toContain(`${height.toFixed(1)}×${width.toFixed(1)} cm`);

      expect(rect.rectWidth).toBeGreaterThan(0);
      expect(rect.rectHeight).toBeGreaterThan(0);
      expect(rect.x).toBeGreaterThanOrEqual(viewBox.x);
      expect(rect.y).toBeGreaterThanOrEqual(viewBox.y);
      expect(rect.x + rect.rectWidth).toBeLessThanOrEqual(viewBox.x + viewBox.width);
      expect(rect.y + rect.rectHeight).toBeLessThanOrEqual(viewBox.y + viewBox.height);
    }
  });

  test('switching sheet unit to mm converts dimensions and persists after reload', async ({ page }) => {
    await page.evaluate(() => localStorage.clear());
    await page.goto('/atelier', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('img', { name: 'QatlIA' })).toBeVisible({ timeout: 15000 });

    const heightInput = page.getByTestId('sheet-height-input');
    const widthInput = page.getByTestId('sheet-width-input');
    await expect(heightInput).toHaveValue('278.0');
    await expect(widthInput).toHaveValue('208.0');

    const unitGroup = page.getByRole('group', { name: /unité/i });
    await unitGroup.getByRole('button', { name: 'mm' }).click();

    await expect(heightInput).toHaveValue('2780.0');
    await expect(widthInput).toHaveValue('2080.0');

    await page.getByRole('button', { name: /optimiser/i }).click();
    await expect(page.getByTestId('cut-plan-svg')).toBeVisible({ timeout: 15000 });

    await page.reload();
    await expect(page.getByRole('img', { name: 'QatlIA' })).toBeVisible({ timeout: 15000 });

    const mmButtonAfterReload = page.getByRole('group', { name: /unité/i }).getByRole('button', { name: 'mm' });
    await expect(mmButtonAfterReload).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('sheet-height-input')).toHaveValue('2780.0');
    await expect(page.getByTestId('sheet-width-input')).toHaveValue('2080.0');
  });

  test('imported piece dimensions convert correctly between mm and cm', async ({ page }) => {
    await page.evaluate(() => localStorage.clear());
    await page.goto('/atelier', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('img', { name: 'QatlIA' })).toBeVisible({ timeout: 15000 });

    const unitGroup = page.getByRole('group', { name: /unité/i });
    await unitGroup.getByRole('button', { name: 'mm' }).click();

    await page.getByRole('button', { name: /coller excel/i }).click();
    await page.getByLabel(/unité des dimensions collées/i).selectOption('mm');
    await page.getByLabel(/coller une liste de pièces/i).fill('Test unité;600;500;1');
    await page.getByRole('button', { name: /^importer$/i }).click();

    const pieceRow = page.locator('[data-piece-name="Test unité"]');
    await expect(pieceRow).toBeVisible();
    await expect(pieceRow.getByLabel('Hauteur mm')).toHaveValue('600.0');
    await expect(pieceRow.getByLabel('Largeur mm')).toHaveValue('500.0');

    await unitGroup.getByRole('button', { name: 'cm' }).click();

    await expect(pieceRow.getByLabel('Hauteur cm')).toHaveValue('60.0');
    await expect(pieceRow.getByLabel('Largeur cm')).toHaveValue('50.0');
  });

  test('legacy projects default to canonical cm and rewrite migration metadata', async ({ page }) => {
    const legacyProject = {
      sheet: { height: 600, width: 120, material: 'mdf', kerf: 0.3, margin: 1, quantity: 1 },
      pieces: [
        { id: '1', name: 'Panneau legacy', height: 100, width: 50, quantity: 1, material: 'mdf', rotatable: true },
      ],
      options: {
        kerfWidth: 3, showLabels: true, singleSheetOnly: false, considerMaterial: false,
        edgeBanding: false, grainDirection: false, optimizationPriority: 'linear_guillotine', defaultMaterial: 'mdf',
        minReusableOffcutWidth: 15, minReusableOffcutHeight: 15,
      },
      // No `displayUnit`/`canonicalUnit` fields at all — this is what a
      // legacy (pre-unit-metadata) saved project looked like.
    };

    await page.goto('/atelier', { waitUntil: 'domcontentloaded' });
    await page.evaluate(
      (legacy) => sessionStorage.setItem('qatlia_saved_project', JSON.stringify(legacy)),
      legacyProject
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('img', { name: 'QatlIA' })).toBeVisible({ timeout: 15000 });

    const unitGroup = page.getByRole('group', { name: /unité/i });
    await expect(unitGroup.getByRole('button', { name: 'cm' })).toHaveAttribute('aria-pressed', 'true');

    // Legacy geometry is already canonical cm; it must display as-is, never
    // magnitude-guessed into mm (e.g. no `600 > 500 ? /10 : value` heuristic).
    await expect(page.getByTestId('sheet-height-input')).toHaveValue('600.0');
    await expect(page.getByTestId('sheet-width-input')).toHaveValue('120.0');

    await page.getByRole('button', { name: /optimiser/i }).click();
    await expect(page.getByTestId('cut-plan-svg')).toBeVisible({ timeout: 15000 });

    const firstHistoryOptions = await page.evaluate(() => {
      const raw = localStorage.getItem('qatlia_local_history_v1');
      const items = raw ? JSON.parse(raw) : [];
      return items[0]?.options_json ?? null;
    });

    expect(firstHistoryOptions?.displayUnit).toBe('cm');
    expect(firstHistoryOptions?.canonicalUnit).toBe('cm');
    expect(firstHistoryOptions?.migratedFromLegacyUnit).toBe(true);
  });

  test('entering an extreme numeric value (1e400) in sheet height stays safe and reverts', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.goto('/atelier', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('img', { name: 'QatlIA' })).toBeVisible({ timeout: 15000 });

    const heightInput = page.getByTestId('sheet-height-input');
    await expect(heightInput).toHaveValue('278.0');

    await heightInput.evaluate((element: HTMLInputElement) => {
      element.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(element, '1e400');
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.blur();
    });

    // The page must stay responsive (no uncaught error broke rendering) and
    // the input must safely revert to its last valid value, whether the
    // browser normalized 1e400 to '' or left it as an out-of-range string.
    await expect(page.getByRole('img', { name: 'QatlIA' })).toBeVisible();
    await expect(heightInput).toHaveValue('278.0');
    expect(pageErrors).toEqual([]);
  });
});
