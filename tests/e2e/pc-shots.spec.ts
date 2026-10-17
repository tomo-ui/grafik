import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { nov, openPc, person, seedPc, shift, type P, type S } from './pc-helpers';

/** Zrzuty konsoli do przeglądu wizualnego (docs/screens/pc) — też test dymny wszystkich stron. */
const NAMES = ['Ania', 'Basia', 'Celina', 'Dorota', 'Ewa', 'Fela', 'Gosia', 'Hania', 'Iga', 'Jola'];
const persons: P[] = NAMES.map((n, i) =>
  person(i, n, {
    lastName: `Nazwisko${i}`,
    isMe: i === 0,
    aliases: i % 3 === 0 ? [`${n[0]}.`] : [],
  }),
);
const shifts: S[] = [];
for (const p of persons) {
  for (let d = 1; d <= 30; d++) {
    const k = (d + Number(p.id.slice(1)) * 3) % 8;
    if (k === 0 || k === 4) continue;
    if (k === 6 && d % 5 === 0)
      shifts.push(
        shift(p.id, nov(d), {
          kind: 'vacation',
          start: undefined,
          end: undefined,
          usesDefaultHours: false,
        }),
      );
    else if (k === 7 && d % 4 === 0)
      shifts.push(
        shift(p.id, nov(d), {
          kind: 'sick',
          start: undefined,
          end: undefined,
          usesDefaultHours: false,
        }),
      );
    else
      shifts.push(
        shift(
          p.id,
          nov(d),
          d % 7 === 3
            ? { start: '12:00', end: '20:00', usesDefaultHours: false, note: 'zamiana' }
            : {},
        ),
      );
  }
}

for (const scheme of ['light', 'dark'] as const) {
  test(`zrzuty konsoli — ${scheme}`, async ({ page }) => {
    test.setTimeout(120_000);
    mkdirSync('docs/screens/pc', { recursive: true });
    await page.emulateMedia({ colorScheme: scheme });
    await openPc(page);
    await seedPc(page, { persons, shifts, settings: { theme: scheme } });
    const pages: [string, string][] = [
      ['siatka', '/'],
      ['osoby', '/osoby'],
      ['godziny', '/godziny'],
      ['import', '/import'],
      ['dane', '/dane'],
      ['ustawienia', '/ustawienia'],
      ['eksport', '/eksport'],
    ];
    for (const [name, path] of pages) {
      await page.goto(`/pc/#${path}`);
      await page.waitForTimeout(name === 'eksport' ? 4000 : 500);
      if (name === 'siatka') {
        await page.getByRole('gridcell', { name: /^Basia, [^,]+, 10 listopada/ }).click();
        await page.keyboard.press('Shift+ArrowRight');
        await page.keyboard.press('Shift+ArrowDown');
      }
      await page.screenshot({ path: `docs/screens/pc/${name}-${scheme}.png` });
    }
  });
}
