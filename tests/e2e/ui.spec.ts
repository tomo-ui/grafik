import { expect, test, type Page } from '@playwright/test';

async function open(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto('/_dev/ui');
  await expect(page.getByRole('heading', { name: 'Katalog UI' })).toBeVisible();
  return problems;
}

const log = (page: Page) => page.getByTestId('log');

test('brak błędów konsoli i poziomego przewijania; dotyk >= 44 px', async ({ page }) => {
  const problems = await open(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);

  const small = await page.evaluate(() =>
    [...document.querySelectorAll('button')]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && (r.height < 43.5 || r.width < 43.5);
      })
      .map(
        (b) =>
          `${b.textContent?.trim() || b.getAttribute('aria-label')} ${b.getBoundingClientRect().width}x${b.getBoundingClientRect().height}`,
      ),
  );
  expect(small).toEqual([]);
  expect(problems).toEqual([]);
});

test('Sheet: otwiera się, zamyka scrimem i systemowym „wstecz” (P-15)', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Sheet', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nowa zmiana' });
  await expect(dialog).toBeVisible();

  await page.getByTestId('sheet-scrim').click({ position: { x: 10, y: 10 } });
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Sheet', exact: true }).click();
  await expect(dialog).toBeVisible();
  const before = page.url();
  await page.goBack();
  await expect(dialog).toBeHidden();
  expect(page.url()).toBe(before); // nie opuściliśmy strony
});

test('Alert: akcja destrukcyjna wykonuje się raz', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Alert' }).click();
  const dlg = page.getByRole('alertdialog');
  await expect(dlg).toBeVisible();
  const del = dlg.getByRole('button', { name: 'Usuń' });
  await expect(del).toHaveCSS('color', /rgb\(255, (59|69), (48|58)\)/);
  await del.click();
  await expect(log(page)).toHaveText('alert: usuń');
  await expect(dlg).toBeHidden();
});

test('ActionSheet i menu „+”', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'ActionSheet' }).click();
  await page
    .getByRole('dialog', { name: 'Co zrobić ze zmianą?' })
    .getByRole('button', { name: 'Edytuj' })
    .click();
  await expect(log(page)).toHaveText('as: edytuj');

  await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Skanuj grafik' }).click();
  await expect(log(page)).toHaveText('fab: skanuj');
});

test('Toast z Cofnij', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Toast' }).click();
  const toast = page.getByRole('status').filter({ hasText: 'Usunięto zmianę' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Cofnij' }).click();
  await expect(log(page)).toHaveText('cofnięto');
  await expect(toast).toBeHidden();
});

test('SegmentedControl, Toggle, Stepper, TabBar', async ({ page }) => {
  await open(page);
  await page.getByRole('radio', { name: 'Miesiąc' }).click();
  await expect(page.getByRole('radio', { name: 'Miesiąc' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  const sw = page.getByRole('switch', { name: 'Przełącznik' });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');

  await page.getByRole('button', { name: 'Liczba zmian: więcej' }).click();
  await expect(page.getByRole('button', { name: 'Liczba zmian: więcej' })).toBeVisible();

  await page.getByRole('button', { name: 'Zespół' }).click();
  await expect(page.getByRole('button', { name: 'Zespół' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('ContextMenu po long-press 450 ms', async ({ page }) => {
  await open(page);
  const row = page.getByText('Przytrzymaj mnie');
  await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 10);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Usuń' }).click();
  await expect(log(page)).toHaveText('menu: usuń');
});

test('SwipeActions: przesunięcie odsłania akcje, Usuń + Cofnij', async ({ page }) => {
  await open(page);
  const row = page.getByText('Katarzyna Nowak');
  await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const box = (await row.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 250, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, y, { steps: 5 });
  await page.mouse.move(box.x + 100, y, { steps: 5 });
  await page.mouse.up();
  await page.locator('[class*=swipeBtn]', { hasText: 'Usuń' }).click();
  await expect(row).toBeHidden();
  await page.getByRole('button', { name: 'Cofnij' }).click();
  await expect(row).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`zrzut katalogu — ${scheme}`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page);
    await page.screenshot({ path: `docs/screens/faza2/${info.project.name}-${scheme}.png` });
    await page.getByRole('button', { name: 'Sheet', exact: true }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `docs/screens/faza2/${info.project.name}-${scheme}-sheet.png` });
  });
}
