/* eslint-disable @typescript-eslint/no-explicit-any -- rekordy IndexedDB i ciała zapytań w testach */
import { readFile } from 'node:fs/promises';
import { expect, test, type Download, type Page } from '@playwright/test';
import {
  activeShifts,
  clean,
  nov,
  openPalette,
  openPc,
  readStore,
  seedPc,
  shift,
  TEAM,
  type P,
  type S,
} from './pc-helpers';

// page.route() nie przechwytuje żądań obsługiwanych przez Service Worker (test klucza/Gemini)
test.use({ serviceWorkers: 'block' });

const nav = (page: Page, name: string | RegExp) =>
  page.getByRole('navigation', { name: 'Główna nawigacja' }).getByRole('link', { name });
const toast = (page: Page, text: string | RegExp) =>
  page.getByRole('status').filter({ hasText: text });
const text = async (d: Download) => readFile((await d.path())!, 'utf8');

async function start(
  page: Page,
  data: { persons?: P[]; shifts?: S[]; settings?: Record<string, unknown> } = {},
  hash = '',
) {
  await openPc(page, hash);
  await seedPc(page, { persons: TEAM, ...data });
}

test.describe('Osoby', () => {
  test('dodanie osoby z aliasem i kolorem, edycja i zapis przetrwa przeładowanie', async ({
    page,
  }) => {
    const problems = await clean(page);
    await start(page, { persons: [] }, '/osoby');
    await expect(page.getByRole('heading', { name: 'Nie ma jeszcze żadnych osób' })).toBeVisible();
    await page.getByRole('button', { name: 'Dodaj osobę' }).first().click();
    const dlg = page.getByRole('dialog', { name: 'Nowa osoba' });
    await expect(dlg.getByRole('button', { name: 'Zapisz' })).toBeDisabled();
    await dlg.getByRole('textbox', { name: 'Imię' }).fill('Kasia');
    await dlg.getByRole('textbox', { name: 'Nazwisko' }).fill('Nowak');
    await dlg.getByRole('radio', { name: 'purple' }).click();
    await dlg.getByRole('textbox', { name: 'Nowy alias' }).fill('Katarzyna N.');
    await dlg.getByRole('textbox', { name: 'Nowy alias' }).press('Enter');
    await expect(dlg).toContainText('Katarzyna N.');
    await dlg.getByRole('button', { name: 'Zapisz' }).click();
    await expect(dlg).toBeHidden();
    const row = page.getByRole('row', { name: /Kasia Nowak/ });
    await expect(row).toContainText('Katarzyna N.');
    await page.reload();
    await expect(page.getByRole('row', { name: /Kasia Nowak/ })).toBeVisible();
    const [p] = await readStore<P>(page, 'persons');
    expect(p).toMatchObject({
      firstName: 'Kasia',
      lastName: 'Nowak',
      color: 'purple',
      aliases: ['Katarzyna N.'],
    });

    await page
      .getByRole('row', { name: /Kasia Nowak/ })
      .getByRole('button', { name: 'Edytuj' })
      .click();
    const edit = page.getByRole('dialog', { name: 'Edytuj osobę' });
    await edit.getByRole('textbox', { name: 'Imię' }).fill('Katarzyna');
    await edit.getByRole('button', { name: 'Zapisz' }).click();
    await expect(page.getByRole('row', { name: /Katarzyna Nowak/ })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('„To ja” ma tylko jedna osoba; szukanie po aliasie', async ({ page }) => {
    await start(page, {}, '/osoby');
    await expect(page.getByRole('row', { name: /Ania Kowalska/ })).toContainText('To ja');
    await page
      .getByRole('row', { name: /Basia Nowak/ })
      .getByRole('button', { name: 'Edytuj' })
      .click();
    const dlg = page.getByRole('dialog', { name: 'Edytuj osobę' });
    await dlg.getByRole('checkbox', { name: /To ja/ }).check();
    await dlg.getByRole('button', { name: 'Zapisz' }).click();
    await expect(page.getByRole('row', { name: /Basia Nowak/ })).toContainText('To ja');
    await expect(page.getByRole('row', { name: /Ania Kowalska/ })).not.toContainText('To ja');
    await page.getByRole('searchbox', { name: 'Szukaj osoby' }).fill('anka');
    await expect(page.getByRole('row', { name: /Ania Kowalska/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Basia/ })).toHaveCount(0);
  });

  test('archiwizacja i przywrócenie, zmiana kolejności', async ({ page }) => {
    await start(page, {}, '/osoby');
    await page
      .getByRole('row', { name: /Celina Lis/ })
      .getByRole('button', { name: 'Archiwizuj' })
      .click();
    await expect(page.getByRole('row', { name: /Celina Lis/ })).toHaveCount(0);
    await page.getByLabel('Pokaż zarchiwizowane').check();
    await expect(page.getByRole('row', { name: /Celina Lis/ })).toContainText('Archiwum');
    await page
      .getByRole('row', { name: /Celina Lis/ })
      .getByRole('button', { name: 'Przywróć' })
      .click();
    await page.getByLabel('Pokaż zarchiwizowane').uncheck();
    await expect(page.getByRole('row', { name: /Celina Lis/ })).not.toContainText('Archiwum');

    await page.getByRole('button', { name: 'Przesuń w dół: Ania Kowalska' }).click();
    await expect
      .poll(async () =>
        (await readStore<P>(page, 'persons'))
          .sort((a, b) => a.order - b.order)
          .map((p) => p.firstName),
      )
      .toEqual(['Basia', 'Ania', 'Celina']);
  });

  test('usunięcie z potwierdzeniem i Cofnij przywraca osobę razem ze zmianami', async ({
    page,
  }) => {
    await start(
      page,
      { shifts: [shift('p1', nov(2)), shift('p1', nov(3)), shift('p0', nov(2))] },
      '/osoby',
    );
    await page
      .getByRole('row', { name: /Basia Nowak/ })
      .getByRole('button', { name: 'Usuń' })
      .click();
    const confirm = page.getByRole('dialog', { name: /Usunąć osobę Basia Nowak/ });
    await confirm.getByRole('button', { name: 'Usuń' }).click();
    await expect(page.getByRole('row', { name: /Basia Nowak/ })).toHaveCount(0);
    expect((await activeShifts(page)).map((s) => s.personId)).toEqual(['p0']);
    await toast(page, 'Usunięto').getByRole('button', { name: 'Cofnij' }).click();
    await expect(page.getByRole('row', { name: /Basia Nowak/ })).toBeVisible();
    await expect.poll(async () => (await activeShifts(page)).length).toBe(3);
  });

  test('akcje grupowe: zaznacz kilka i zarchiwizuj', async ({ page }) => {
    await start(page, {}, '/osoby');
    await page.getByRole('checkbox', { name: 'Zaznacz: Ania Kowalska' }).check();
    await page.getByRole('checkbox', { name: 'Zaznacz: Basia Nowak' }).check();
    const bar = page.getByRole('region', { name: 'Akcje grupowe' });
    await expect(bar).toContainText('Zaznaczono: 2');
    await bar.getByRole('button', { name: 'Archiwizuj' }).click();
    await expect(page.getByRole('row', { name: /Ania Kowalska/ })).toHaveCount(0);
    await expect(page.getByRole('row', { name: /Celina Lis/ })).toBeVisible();
  });
});

test.describe('Godziny i raporty', () => {
  const shifts = [
    shift('p0', nov(2)),
    shift('p0', nov(6)),
    shift('p0', nov(7)),
    shift('p1', nov(2)),
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
  ];

  test('raport miesiąca: dni, godziny, Pt/Sb, urlop, L4, suma i obsada', async ({ page }) => {
    await start(page, { shifts }, '/godziny');
    const ania = page.getByRole('row', { name: /^Ania/ });
    await expect(ania).toContainText('38 h'); // 12 + 13 + 13
    await expect(ania.getByRole('cell').nth(1)).toHaveText('3');
    await expect(ania.getByRole('cell').nth(3)).toHaveText('2'); // piątek i sobota
    const basia = page.getByRole('row', { name: /^Basia/ });
    await expect(basia).toContainText('12 h');
    await expect(basia.getByRole('cell').nth(5)).toHaveText('1'); // urlop
    await expect(basia.getByRole('cell').nth(6)).toHaveText('1'); // L4
    await expect(page.getByRole('row', { name: /^Razem/ })).toContainText('50 h');
    await expect(
      page.getByRole('img', { name: /Obsada dzienna, maksymalnie 2 osób/ }),
    ).toBeVisible();
    // Celina bez zmian jest ukryta? — nie: aktywne osoby bez zmian są w raporcie z zerami
    await expect(page.getByRole('row', { name: /^Celina/ })).toBeVisible();
  });

  test('szczegóły osoby i zmiana okresu (rok, własny zakres, błąd dat)', async ({ page }) => {
    await start(page, { shifts }, '/godziny');
    await page
      .getByRole('row', { name: /^Ania/ })
      .getByRole('button', { name: 'Szczegóły' })
      .click();
    const dlg = page.getByRole('dialog', { name: /Szczegóły: Ania/ });
    await expect(dlg.getByRole('row')).toHaveCount(1 + 3);
    await expect(dlg).toContainText('10:00–23:00');
    await dlg.getByRole('button', { name: 'Zamknij' }).click();

    await page.getByRole('button', { name: 'Rok' }).click();
    await expect(page.getByRole('row', { name: /^Razem/ })).toContainText('50 h');
    await page.getByRole('button', { name: 'Własny zakres' }).click();
    await page.getByLabel('Od dnia').fill('2026-11-03');
    await page.getByLabel('Do dnia').fill('2026-11-06');
    await expect(page.getByRole('row', { name: /^Razem/ })).toContainText('13 h'); // tylko piątek 6.11 Ani
    await page.getByLabel('Do dnia').fill('2026-10-01');
    await expect(page.getByRole('alert')).toContainText('poprawny zakres dat');
  });

  test('eksport CSV raportu (BOM, średniki, polskie liczby)', async ({ page }) => {
    await start(page, { shifts }, '/godziny');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Eksport CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('Godziny_2026-11-01_2026-11-30.csv');
    const csv = await text(download);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Osoba;Dni pracy;Godziny;Pt/Sb;Wolne;Urlop;L4;Inne');
    expect(csv).toContain('Ania;3;38;2;0;0;0;0');
    expect(csv).toContain('Razem;');
  });
});

test.describe('Eksport', () => {
  test('podgląd PDF powstaje automatycznie; pobranie PDF i CSV z poprawną nazwą', async ({
    page,
  }) => {
    const problems = await clean(page);
    await start(
      page,
      { shifts: [shift('p0', nov(2)), shift('p1', nov(2)), shift('p1', nov(3))] },
      '/eksport',
    );
    await expect(page.getByRole('img', { name: /^Strona 1 z/ })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText('Grafik_2026-11.pdf')).toBeVisible();
    const [pdf] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Pobierz PDF' }).click(),
    ]);
    expect(pdf.suggestedFilename()).toBe('Grafik_2026-11.pdf');
    const head = (await readFile((await pdf.path())!)).subarray(0, 5).toString('latin1');
    expect(head).toBe('%PDF-');

    const [csv] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Pobierz CSV (siatka)' }).click(),
    ]);
    expect(csv.suggestedFilename()).toBe('Grafik_2026-11-01_2026-11-30.csv');
    expect(await text(csv)).toContain('Ania;');
    expect(problems.filter((p) => !/pdf|font/i.test(p))).toEqual([]);
  });

  test('układ „lista osoby”, wybrane osoby i okres bez zmian', async ({ page }) => {
    await start(page, { shifts: [shift('p0', nov(2)), shift('p1', nov(3))] }, '/eksport');
    await expect(page.getByRole('img', { name: /^Strona 1 z/ })).toBeVisible({ timeout: 45_000 });
    await page.getByRole('button', { name: 'Lista osoby (A4 pionowo)' }).click();
    await page.getByRole('button', { name: 'Wybrani' }).click();
    await expect(page.getByText('Nie wybrano żadnej osoby.')).toBeVisible();
    await page.getByRole('checkbox', { name: 'Basia' }).check();
    await expect(page.getByText(/Grafik_Basia_2026-11\.pdf/)).toBeVisible({ timeout: 45_000 });
    await page.getByRole('button', { name: 'Wszyscy' }).click();
    await page.getByLabel('Miesiąc').selectOption('12');
    await expect(page.getByText('Brak zmian w wybranym okresie.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pobierz PDF' })).toBeDisabled();
  });

  test('własny zakres dłuższy niż 31 dni pokazuje błąd', async ({ page }) => {
    await start(page, { shifts: [shift('p0', nov(2))] }, '/eksport');
    await page.getByRole('button', { name: 'Własny' }).click();
    await page.getByLabel('Od dnia').fill('2026-10-01');
    await page.getByLabel('Do dnia').fill('2026-12-31');
    await expect(page.getByRole('alert')).toContainText('maksymalnie 31 dni');
  });
});

test.describe('Dane i kopie', () => {
  test('kopia JSON bez klucza API; wczytanie „Zastąp” po wpisaniu potwierdzenia', async ({
    page,
  }) => {
    await start(
      page,
      {
        shifts: [shift('p0', nov(2))],
        settings: { geminiApiKey: 'AIzaTAJNY-KLUCZ-1234567890123456789012' },
      },
      '/dane',
    );
    await expect(page.getByRole('region', { name: 'Stan danych' })).toContainText('3');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Pobierz kopię JSON' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^Grafik_kopia_\d{4}-\d{2}-\d{2}\.json$/);
    const json = await text(download);
    expect(json).not.toContain('AIza');
    const backup = JSON.parse(json);
    expect(backup.app).toBe('grafik');
    expect(backup.persons).toHaveLength(3);
    expect(backup.shifts).toHaveLength(1);

    // wyczyść wszystko, potem wczytaj kopię
    await page.getByRole('button', { name: 'Usuń wszystkie dane…' }).click();
    const wipe = page.getByRole('dialog', { name: 'Usunąć wszystkie dane grafiku?' });
    await expect(wipe.getByRole('button', { name: 'Usuń wszystko' })).toBeDisabled();
    await wipe.getByRole('textbox', { name: 'Tekst potwierdzenia' }).fill('USUŃ');
    await wipe.getByRole('button', { name: 'Usuń wszystko' }).click();
    await expect.poll(async () => (await readStore(page, 'persons')).length).toBe(0);

    await page.getByTestId('backup-file').setInputFiles({
      name: 'kopia.json',
      mimeType: 'application/json',
      buffer: Buffer.from(json),
    });
    const ask = page.getByRole('dialog', { name: 'Wczytać kopię zapasową?' });
    await expect(ask).toContainText('3 osoby');
    await ask.getByRole('button', { name: 'Zastąp wszystko' }).click();
    const confirm = page.getByRole('dialog', { name: 'Zastąpić wszystkie dane kopią?' });
    await confirm.getByRole('textbox', { name: 'Tekst potwierdzenia' }).fill('ZASTĄP');
    await confirm.getByRole('button', { name: 'Zastąp dane' }).click();
    await expect.poll(async () => (await readStore(page, 'persons')).length).toBe(3);
    expect(await activeShifts(page)).toHaveLength(1);
    // lokalny klucz API przeżył zastąpienie danych
    expect((await readStore<any>(page, 'settings'))[0].geminiApiKey).toContain('AIzaTAJNY');
  });

  test('uszkodzony plik kopii: komunikat i dane bez zmian', async ({ page }) => {
    await start(page, { shifts: [shift('p0', nov(2))] }, '/dane');
    await page.getByTestId('backup-file').setInputFiles({
      name: 'x.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{nie json'),
    });
    await expect(toast(page, 'nieprawidłowy JSON')).toBeVisible();
    expect(await activeShifts(page)).toHaveLength(1);
  });

  test('kosz: usunięte zmiany można przywrócić lub usunąć na zawsze', async ({ page }) => {
    await start(
      page,
      {
        shifts: [
          shift('p0', nov(2), { deletedAt: Date.now() }),
          shift('p0', nov(3), { deletedAt: Date.now() }),
          shift('p1', nov(2)),
        ],
      },
      '/dane',
    );
    const trash = page.getByRole('region', { name: 'Kosz' });
    await expect(trash.getByRole('row')).toHaveCount(1 + 2);
    await trash.getByRole('checkbox', { name: 'Zaznacz: Ania Kowalska 2026-11-02' }).check();
    await trash.getByRole('button', { name: 'Przywróć zaznaczone' }).click();
    await expect.poll(async () => (await activeShifts(page)).length).toBe(2);
    await trash.getByRole('button', { name: 'Opróżnij kosz' }).click();
    await page
      .getByRole('dialog', { name: 'Usunąć na zawsze?' })
      .getByRole('button', { name: 'Usuń na zawsze' })
      .click();
    await expect(trash).toContainText('Kosz jest pusty');
    expect((await readStore(page, 'shifts')).length).toBe(2);
  });

  test('historia importów: wycofanie przywraca stan', async ({ page }) => {
    await start(
      page,
      { shifts: [shift('p0', nov(2), { source: 'ai', importBatchId: 'b1' })] },
      '/dane',
    );
    await page.evaluate(
      () =>
        new Promise<void>((res) => {
          const r = indexedDB.open('grafik');
          r.onsuccess = () => {
            const tx = r.result.transaction('importBatches', 'readwrite');
            tx.objectStore('importBatches').put({
              id: 'b1',
              createdAt: Date.now(),
              model: 'gemini-flash-latest',
              promptVersion: '1',
              shiftIds: ['p0-2026-11-02'],
              replacedShifts: [],
            });
            tx.oncomplete = () => {
              r.result.close();
              res();
            };
          };
        }),
    );
    const table = page.getByRole('table', { name: 'Importy AI' });
    await expect(table).toContainText('aktywny');
    await table.getByRole('button', { name: 'Wycofaj' }).click();
    await page
      .getByRole('dialog', { name: 'Wycofać ten import?' })
      .getByRole('button', { name: 'Wycofaj' })
      .click();
    await expect(table).toContainText('wycofany');
    expect(await activeShifts(page)).toHaveLength(0);
  });
});

test.describe('Ustawienia', () => {
  test('motyw, początek tygodnia i godziny domyślne (z aktualizacją przyszłych zmian)', async ({
    page,
  }) => {
    await start(
      page,
      {
        shifts: [
          shift('p0', nov(6)),
          shift('p0', nov(9), { start: '09:00', end: '17:00', usesDefaultHours: false }),
        ],
      },
      '/ustawienia',
    );
    await page.getByRole('button', { name: 'Ciemny' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Niedzieli' }).click();
    expect((await readStore<any>(page, 'settings'))[0].weekStartsOn).toBe(0);

    const end = page.getByRole('textbox', { name: 'Koniec: Piątek' });
    await end.fill('24:00');
    await expect(page.getByRole('button', { name: 'Zapisz godziny' })).toBeDisabled();
    await end.fill('21:00');
    await expect(page.getByRole('row', { name: /Piątek/ })).toContainText('11 h');
    await page.getByRole('button', { name: 'Zapisz godziny' }).click();
    await expect(toast(page, 'Zapisano godziny domyślne')).toBeVisible();
    const db = await activeShifts(page);
    expect(db.find((s) => s.date === nov(6))!.end).toBe('21:00'); // z flagą „domyślne” — zaktualizowana
    expect(db.find((s) => s.date === nov(9))!.end).toBe('17:00'); // własne godziny — bez zmian
    expect((await readStore<any>(page, 'settings'))[0].defaultHours[5].end).toBe('21:00');
  });

  test('klucz API: zapis, maskowanie, usunięcie; testowanie połączenia pokazuje błąd po polsku', async ({
    page,
  }) => {
    await start(page, {}, '/ustawienia');
    await page.route('https://generativelanguage.googleapis.com/**', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
        body: JSON.stringify({
          error: { code: 400, message: 'API key not valid', status: 'INVALID_ARGUMENT' },
        }),
      }),
    );
    await page.getByRole('textbox', { name: 'Klucz API Gemini' }).fill('AIzaSy-TESTOWY-KLUCZ-123');
    await page.getByRole('button', { name: 'Zapisz klucz' }).click();
    await expect(page.getByText(/zapisany \(/)).toBeVisible();
    await expect(page.getByText('AIzaSy-TESTOWY-KLUCZ-123')).toHaveCount(0);
    expect((await readStore<any>(page, 'settings'))[0].geminiApiKey).toBe(
      'AIzaSy-TESTOWY-KLUCZ-123',
    );
    await page.getByRole('button', { name: 'Testuj połączenie' }).click();
    await expect(page.getByText('Klucz API jest nieprawidłowy lub zablokowany')).toBeVisible();
    await page.getByRole('button', { name: 'Usuń klucz' }).click();
    await page
      .getByRole('dialog', { name: 'Usunąć klucz API?' })
      .getByRole('button', { name: 'Usuń klucz' })
      .click();
    await expect(page.getByText('brak klucza')).toBeVisible();
  });
});

test.describe('Powłoka', () => {
  test('paleta poleceń (Ctrl+K) i skróty Alt+cyfra', async ({ page }) => {
    await start(page);
    await openPalette(page);
    const dlg = page.getByRole('dialog', { name: 'Paleta poleceń' });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('combobox').fill('godz');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Godziny i raporty' })).toBeVisible();
    await page.keyboard.press('Alt+5');
    await expect(page.getByRole('heading', { name: 'Eksport', exact: true })).toBeVisible();
    await page.keyboard.press('Alt+1');
    await expect(page.getByRole('heading', { name: 'Listopad 2026' })).toBeVisible();

    await openPalette(page);
    await dlg.getByRole('combobox').fill('Basia');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Osoby', exact: true })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Szukaj osoby' })).toHaveValue('Basia');
  });

  test('„Dodaj osobę” z palety otwiera formularz', async ({ page }) => {
    await start(page);
    await openPalette(page);
    await page
      .getByRole('dialog', { name: 'Paleta poleceń' })
      .getByRole('combobox')
      .fill('dodaj osobę');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Nowa osoba' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Nowa osoba' })).toBeHidden();
  });

  test('nawigacja zaznacza bieżącą zakładkę, nieznana strona ma komunikat, link do wersji mobilnej', async ({
    page,
  }) => {
    await start(page);
    await expect(nav(page, /Grafik/)).toHaveAttribute('aria-current', 'page');
    await nav(page, /Osoby/).click();
    await expect(nav(page, /Osoby/)).toHaveAttribute('aria-current', 'page');
    await page.goto('/pc/#/nie-ma-takiej');
    await expect(page.getByRole('heading', { name: 'Nie znaleziono strony' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Wersja mobilna' })).toHaveAttribute('href', '../');
  });

  test('motyw ciemny zapisany w ustawieniach stosuje się po przeładowaniu', async ({ page }) => {
    await start(page, { settings: { theme: 'dark' } });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});
