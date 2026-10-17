import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { clean, nov, openPalette, openPc, seedPc, shift, TEAM } from './pc-helpers';

const PAGES: [string, string, RegExp][] = [
  ['/', 'Grafik', /listopad 2026/i],
  ['/osoby', 'Osoby', /^Osoby$/],
  ['/godziny', 'Godziny i raporty', /Godziny i raporty/],
  ['/import', 'Import ze zdjęcia', /Import ze zdjęcia/],
  ['/dane', 'Dane i kopie', /Dane i kopie/],
  ['/ustawienia', 'Ustawienia', /^Ustawienia$/],
];

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

const data = {
  persons: TEAM,
  shifts: [
    shift('p0', nov(2)),
    shift('p0', nov(6)),
    shift('p1', nov(3), {
      kind: 'vacation',
      start: undefined,
      end: undefined,
      usesDefaultHours: false,
    }),
    shift('p1', nov(4), {
      kind: 'sick',
      start: undefined,
      end: undefined,
      usesDefaultHours: false,
    }),
    shift('p2', nov(5), { kind: 'off', start: undefined, end: undefined, usesDefaultHours: false }),
    shift('p2', nov(9), {
      kind: 'other',
      start: undefined,
      end: undefined,
      usesDefaultHours: false,
      note: 'szkolenie',
    }),
  ],
};

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`axe — motyw ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    for (const [path, , heading] of PAGES) {
      test(`strona ${path}`, async ({ page }) => {
        await openPc(page, path);
        await seedPc(page, { ...data, settings: { theme: scheme } });
        await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
        await page.waitForTimeout(400);
        await audit(page, `${path} (${scheme})`);
      });
    }

    test('okna: dodawanie osoby, menu kontekstowe i paleta poleceń', async ({ page }) => {
      await openPc(page, '/osoby');
      await seedPc(page, { ...data, settings: { theme: scheme } });
      await page.getByRole('button', { name: 'Dodaj osobę' }).click();
      await expect(page.getByRole('dialog', { name: 'Nowa osoba' })).toBeVisible();
      await audit(page, `modal (${scheme})`);
      await page.keyboard.press('Escape');
      await openPalette(page);
      await expect(page.getByRole('dialog', { name: 'Paleta poleceń' })).toBeVisible();
      await audit(page, `paleta (${scheme})`);
    });
  });
}

test('eksport: podgląd PDF bez naruszeń dostępności', async ({ page }) => {
  await openPc(page, '/eksport');
  await seedPc(page, data);
  await expect(page.getByRole('img', { name: /^Strona 1 z/ })).toBeVisible({ timeout: 45_000 });
  await audit(page, 'eksport');
});

test('CSP i konsola: żadnych naruszeń ani błędów na wszystkich stronach konsoli', async ({
  page,
}) => {
  const problems = await clean(page);
  // WebKit czasem raportuje „modulepreload nieużyty” dla wspólnych fragmentów — to uwaga przeglądarki, nie błąd aplikacji
  const ignorable = /preloaded using link preload but not used/;
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) =>
      console.error(`Content Security Policy: ${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  const res = await page.goto('/pc/');
  expect(res!.headers()['content-security-policy']).toContain("script-src 'self'");
  await openPc(page);
  await seedPc(page, data);
  for (const [path] of [...PAGES, ['/eksport', '', /./] as const]) {
    await page.goto(`/pc/#${path}`);
    await page.waitForTimeout(500);
  }
  expect(problems.filter((p) => !ignorable.test(p))).toEqual([]);
});

test('wersja na komputer ma osobny tytuł i nie jest aplikacją mobilną', async ({ page }) => {
  await openPc(page);
  await expect(page).toHaveTitle('Grafik — wersja na komputer');
  await expect(
    page.getByRole('navigation', { name: 'Główna nawigacja' }).getByRole('link'),
  ).toHaveCount(7);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /pc.webmanifest$/);
  const manifest = await (await page.request.get('/pc.webmanifest')).json();
  expect(manifest).toMatchObject({ start_url: 'pc/', scope: 'pc/', display: 'standalone' });
});
