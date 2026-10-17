/* eslint-disable @typescript-eslint/no-explicit-any -- rekordy IndexedDB i ciała zapytań w testach */
import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import sharp from 'sharp';
import {
  activeShifts,
  clean,
  openPc,
  person,
  readStore,
  seedPc,
  shift,
  type P,
  type S,
} from './pc-helpers';

// page.route() nie przechwytuje żądań obsługiwanych przez Service Worker
test.use({ serviceWorkers: 'block' });

const KEY = 'AIzaSy-TESTOWY-KLUCZ-123';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};
const api = (name: string) =>
  readFileSync(`tests/fixtures/gemini-responses/api-${name}.json`, 'utf8');
const png = () =>
  sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 245, g: 245, b: 245 } },
  })
    .png()
    .toBuffer();

const PEOPLE: P[] = [
  person(0, 'Katarzyna', { lastName: 'Nowak', aliases: ['Kasia'] }),
  person(1, 'Barbara', { lastName: 'Wiśniewska', aliases: ['Basia'] }),
];

async function mock(page: Page, handler: (r: Route) => Promise<void> | void) {
  const calls: { key?: string; url: string; body: any }[] = [];
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    calls.push({
      key: req.headers()['x-goog-api-key'],
      url: req.url(),
      body: req.postData() ? JSON.parse(req.postData()!) : undefined,
    });
    return handler(route);
  });
  return calls;
}
const ok = (name: string) => (r: Route) =>
  r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: api(name) });

async function start(page: Page, data: { shifts?: S[]; settings?: Record<string, unknown> } = {}) {
  await openPc(page, '/import');
  await seedPc(page, {
    persons: PEOPLE,
    settings: { geminiApiKey: KEY, aiPrivacyAcknowledged: true, ...data.settings },
    shifts: data.shifts,
  });
}
const pick = async (page: Page) =>
  page
    .getByLabel('Wybierz pliki ze zdjęciami')
    .setInputFiles({ name: 'grafik.png', mimeType: 'image/png', buffer: await png() });

test('import ze zdjęcia: analiza, rozstrzygnięcie osób, import i Cofnij', async ({ page }) => {
  const problems = await clean(page);
  const calls = await mock(page, ok('standard'));
  await start(page);

  await expect(page.getByRole('button', { name: 'Analizuj zdjęcia' })).toBeDisabled();
  await pick(page);
  await expect(page.getByRole('img', { name: 'Strona 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Analizuj zdjęcia' }).click();
  await expect(page.getByRole('heading', { name: 'Weryfikacja odczytu' })).toBeVisible();

  // klucz w nagłówku (nie w URL ani w treści), model i obraz
  expect(calls).toHaveLength(1);
  expect(calls[0]!.key).toBe(KEY);
  expect(calls[0]!.url).not.toContain(KEY);
  expect(JSON.stringify(calls[0]!.body)).not.toContain(KEY);
  expect(calls[0]!.body.contents[0].parts[1].inline_data.mime_type).toBe('image/jpeg');

  // Kasia i Basia rozpoznane przez aliasy, Łukasz czeka na decyzję → import zablokowany
  const kasia = page.getByRole('region', { name: 'Osoba z grafiku: Kasia' });
  await expect(page.getByLabel('Przypisanie: Kasia')).toHaveValue('p:p0');
  await expect(page.getByLabel('Przypisanie: Basia')).toHaveValue('p:p1');
  await expect(page.getByLabel('Przypisanie: Łukasz')).toHaveValue('');
  await expect(page.getByRole('button', { name: /^Importuj/ })).toBeDisabled();
  await expect(page.getByText('Import jest zablokowany')).toBeVisible();

  await page.getByLabel('Przypisanie: Łukasz').selectOption('new');
  await expect(page.getByRole('textbox', { name: 'Imię nowej osoby' })).toHaveValue('Łukasz');
  await expect(page.getByRole('button', { name: /^Importuj/ })).toBeEnabled();

  // usunięcie jednego wpisu zmniejsza liczbę zmian do zapisu
  const label = await page.getByRole('button', { name: /^Importuj/ }).textContent();
  await kasia.getByRole('button', { name: 'Usuń' }).first().click();
  await expect(page.getByRole('button', { name: /^Importuj/ })).not.toHaveText(label ?? '');

  await page.getByRole('button', { name: /^Importuj/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Zaimportowano' })).toBeVisible();
  const added = (await activeShifts(page)).filter((s) => s.source === 'ai');
  expect(added.length).toBeGreaterThan(5);
  expect(new Set(added.map((s) => s.personId)).size).toBe(3); // Kasia, Basia i nowy Łukasz
  expect((await readStore<P>(page, 'persons')).some((p) => p.firstName === 'Łukasz')).toBe(true);
  expect(await readStore<any>(page, 'importBatches')).toHaveLength(1);
  // po imporcie wraca ekran wyboru zdjęć, szkic wyczyszczony
  await expect(page.getByRole('heading', { name: '1. Dodaj zdjęcia grafiku' })).toBeVisible();

  await page
    .getByRole('status')
    .filter({ hasText: 'Zaimportowano' })
    .getByRole('button', { name: 'Cofnij' })
    .click();
  await expect
    .poll(async () => (await activeShifts(page)).filter((s) => s.source === 'ai').length)
    .toBe(0);
  expect(problems.filter((p) => !/Service Worker registration blocked/.test(p))).toEqual([]);
});

test('pierwszy skan pyta o prywatność darmowego API', async ({ page }) => {
  await mock(page, ok('standard'));
  await start(page, { settings: { aiPrivacyAcknowledged: false } });
  await pick(page);
  await page.getByRole('button', { name: 'Analizuj zdjęcia' }).click();
  const dlg = page.getByRole('dialog', { name: 'Prywatność darmowego API' });
  await expect(dlg).toContainText('ulepszania modeli');
  await dlg.getByRole('button', { name: 'Rozumiem, analizuj' }).click();
  await expect(page.getByRole('heading', { name: 'Weryfikacja odczytu' })).toBeVisible();
  expect((await readStore<any>(page, 'settings'))[0].aiPrivacyAcknowledged).toBe(true);
});

test('bez klucza API: komunikat i link do ustawień; błąd API po polsku; zdjęcie zostaje do ponowienia', async ({
  page,
}) => {
  await mock(page, (r) =>
    r.fulfill({
      status: 500,
      contentType: 'application/json',
      headers: CORS,
      body: JSON.stringify({ error: { code: 500, message: 'oops' } }),
    }),
  );
  await start(page, { settings: { geminiApiKey: undefined } });
  await pick(page);
  await page.getByRole('button', { name: 'Analizuj zdjęcia' }).click();
  await expect(page.getByRole('alert')).toContainText(/klucz/i);
  await expect(page.getByRole('link', { name: 'Przejdź do ustawień' })).toBeVisible();

  await seedPc(page, { settings: { geminiApiKey: KEY, aiPrivacyAcknowledged: true } });
  await pick(page);
  await page.getByRole('button', { name: 'Analizuj zdjęcia' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Strona 1' })).toBeVisible(); // zdjęcie nie zniknęło
  await expect(page.getByRole('button', { name: 'Analizuj zdjęcia' })).toBeEnabled();
});

test('kolizje z istniejącymi zmianami: pomiń lub zastąp; szkic wraca po przeładowaniu', async ({
  page,
}) => {
  await mock(page, ok('standard'));
  // Kasia ma już zmianę 2.11 z własnymi godzinami
  await start(page, {
    shifts: [shift('p0', '2026-11-02', { start: '08:00', end: '12:00', usesDefaultHours: false })],
  });
  await pick(page);
  await page.getByRole('button', { name: 'Analizuj zdjęcia' }).click();
  await expect(page.getByRole('heading', { name: 'Weryfikacja odczytu' })).toBeVisible();
  await page.getByLabel('Przypisanie: Łukasz').selectOption('skip');
  await expect(page.getByText(/kolizje z istniejącymi: 1/)).toBeVisible();
  // szkic zapisuje się z opóźnieniem — poczekaj, aż trafi do bazy
  await expect.poll(async () => (await readStore<any>(page, 'scanDrafts')).length).toBe(1);
  await expect
    .poll(async () =>
      JSON.stringify((await readStore<any>(page, 'scanDrafts'))[0]?.decisions ?? {}),
    )
    .toContain('"mode":"skip"');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Weryfikacja odczytu' })).toBeVisible(); // szkic odtworzony (P-12)
  await expect(page.getByLabel('Przypisanie: Łukasz')).toHaveValue('skip');

  await page.getByLabel('Postępowanie z kolizjami').selectOption('replace');
  await page.getByRole('button', { name: /^Importuj/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Zaimportowano' })).toBeVisible();
  const day = (await activeShifts(page)).find(
    (s) => s.personId === 'p0' && s.date === '2026-11-02',
  )!;
  expect(day.source).toBe('ai');
  expect(day.start).not.toBe('08:00');
  // cofnięcie przywraca zastąpioną zmianę 1:1
  await page
    .getByRole('status')
    .filter({ hasText: 'Zaimportowano' })
    .getByRole('button', { name: 'Cofnij' })
    .click();
  await expect
    .poll(
      async () =>
        (await activeShifts(page)).find((s) => s.date === '2026-11-02' && s.personId === 'p0')
          ?.start,
    )
    .toBe('08:00');
});

test('odrzucenie szkicu, zły format pliku i limit stron', async ({ page }) => {
  await mock(page, ok('standard'));
  await start(page);
  await page
    .getByLabel('Wybierz pliki ze zdjęciami')
    .setInputFiles({ name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.getByRole('alert')).toBeVisible();
  // pięć plików naraz (pole obsługuje wielokrotny wybór) — piąty przekracza limit czterech stron
  const buffer = await png();
  await page
    .getByLabel('Wybierz pliki ze zdjęciami')
    .setInputFiles(
      Array.from({ length: 5 }, (_, i) => ({ name: `s${i}.png`, mimeType: 'image/png', buffer })),
    );
  await expect(page.getByRole('img', { name: /^Strona \d/ })).toHaveCount(4);
  await expect(page.getByRole('alert')).toContainText('4');
  await page.getByRole('button', { name: 'Analizuj zdjęcia' }).click();
  await expect(page.getByRole('heading', { name: 'Weryfikacja odczytu' })).toBeVisible();
  await page.getByRole('button', { name: 'Odrzuć' }).click();
  await expect(page.getByRole('heading', { name: '1. Dodaj zdjęcia grafiku' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '1. Dodaj zdjęcia grafiku' })).toBeVisible();
});
