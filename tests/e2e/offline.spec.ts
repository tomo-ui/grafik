import { expect, test } from '@playwright/test';

const NOW = new Date(2026, 10, 4, 10, 0);

test('offline: zimny start bez sieci, edycja zmian i zapis przetrwają przeładowanie', async ({
  page,
  context,
}) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('textbox', { name: 'Imię' }).fill('Ania');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('button', { name: 'Gotowe' }).click();
  await expect(page.getByRole('heading', { name: 'Mój grafik' })).toBeVisible();

  // service worker przejmuje stronę i kończy precache
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mój grafik' })).toBeVisible();

  await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Dodaj zmianę' }).click();
  const sheet = page.getByRole('dialog', { name: 'Dodaj zmianę' });
  await sheet.getByRole('button', { name: 'wtorek, 10 listopada' }).click();
  await sheet.getByRole('button', { name: /Dodaj 1 zmian/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Dodano 1 zmiana' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mój grafik' })).toBeVisible();
  const count = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('grafik');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction('shifts').objectStore('shifts').count();
          req.onsuccess = () => resolve(req.result);
        };
      }),
  );
  expect(count).toBe(1);
  await context.setOffline(false);
});
