import { expect, test } from '@playwright/test';

test('CSP: nagłówek jest ustawiony, a główne ścieżki nie naruszają polityki', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  const res = await page.goto('/');
  const csp = res!.headers()['content-security-policy'];
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain('connect-src');
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) =>
      console.error('Content Security Policy: ' + e.violatedDirective + ' ' + e.blockedURI),
    );
  });
  await page.reload();
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('textbox', { name: 'Imię' }).fill('Ania');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('button', { name: 'Gotowe' }).click();
  await expect(page.getByRole('heading', { name: 'Mój grafik' })).toBeVisible();
  await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Skanuj grafik' }).click();
  await expect(page.getByRole('dialog', { name: 'Skanuj grafik' })).toBeVisible();
  expect(violations).toEqual([]);
});
