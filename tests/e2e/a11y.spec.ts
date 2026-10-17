import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const NOW = new Date(2026, 10, 4, 10, 0);

async function start(page: Page) {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('textbox', { name: 'Imię' }).fill('Ania');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('button', { name: 'Gotowe' }).click();
  await expect(page.getByRole('heading', { name: 'Mój grafik' })).toBeVisible();
}

async function audit(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const bad = r.violations.flatMap((v) =>
    v.nodes.map((n) => {
      const d = n.any[0]?.data as
        { fgColor?: string; bgColor?: string; contrastRatio?: number } | undefined;
      return `${v.id}: ${n.target.join(' ')} ${d?.fgColor ?? ''}/${d?.bgColor ?? ''} ${d?.contrastRatio ?? ''}`;
    }),
  );
  expect(bad, label).toEqual([]);
}

test('axe: ekrany główne bez naruszeń WCAG A/AA', async ({ page }) => {
  await start(page);
  await audit(page, 'Mój grafik');
  await page.getByRole('button', { name: /Zespół/ }).click();
  await expect(page.getByRole('heading', { name: 'Zespół' })).toBeVisible();
  await audit(page, 'Zespół');
  await page.getByRole('button', { name: /Kalendarz/ }).click();
  await expect(page.getByRole('heading', { name: 'Kalendarz' })).toBeVisible();
  await audit(page, 'Kalendarz');
  await page.getByRole('button', { name: /Ustawienia/ }).click();
  await expect(page.getByRole('heading', { name: 'Ustawienia' })).toBeVisible();
  await audit(page, 'Ustawienia');
});

test('axe: arkusz dodawania zmiany', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Dodaj', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Dodaj zmianę' }).click();
  await expect(page.getByRole('dialog', { name: 'Dodaj zmianę' })).toBeVisible();
  await audit(page, 'Dodaj zmianę');
});

test('axe: onboarding', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Dalej' })).toBeVisible();
  await page.waitForTimeout(1000);
  await audit(page, 'Onboarding');
});
