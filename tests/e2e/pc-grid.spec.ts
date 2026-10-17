import { expect, test, type Page } from '@playwright/test';
import {
  activeShifts,
  cell,
  clean,
  nov,
  openPc,
  person,
  readStore,
  seedPc,
  shift,
  TEAM,
  type S,
} from './pc-helpers';

const rows = (page: Page) => page.getByRole('row');

async function withTeam(page: Page, shifts: S[] = []) {
  await openPc(page);
  await expect(page.getByRole('heading', { name: 'Nie ma jeszcze żadnej osoby' })).toBeVisible();
  await seedPc(page, { persons: TEAM, shifts });
  await expect(page.getByRole('heading', { name: 'Listopad 2026' })).toBeVisible();
}

test('pusty stan: bez osób prowadzi do zakładki Osoby', async ({ page }) => {
  await openPc(page);
  await expect(page.getByRole('heading', { name: 'Nie ma jeszcze żadnej osoby' })).toBeVisible();
  await page.getByRole('link', { name: 'Przejdź do osób' }).click();
  await expect(page.getByRole('heading', { name: 'Osoby', exact: true })).toBeVisible();
});

test('siatka miesiąca: osoby, dni, sumy godzin, obsada i bieżący dzień', async ({ page }) => {
  const problems = await clean(page);
  await withTeam(page, [
    shift('p0', nov(2)),
    shift('p0', nov(6)), // piątek 10–23
    shift('p1', nov(2)),
    shift('p1', nov(3), {
      kind: 'vacation',
      start: undefined,
      end: undefined,
      usesDefaultHours: false,
    }),
  ]);
  await expect(page.getByRole('grid', { name: 'Grafik: listopad 2026' })).toBeVisible();
  await expect(rows(page)).toHaveCount(1 + 3 + 1); // nagłówek + 3 osoby + obsada
  const ania = page.getByRole('row', { name: /^Ania/ });
  await expect(ania).toContainText('25 h'); // 12 + 13
  await expect(page.getByRole('row', { name: /^Basia/ })).toContainText('12 h');
  await expect(cell(page, 'Basia', 3)).toContainText('U');
  await expect(cell(page, 'Ania', 6)).toContainText('10–23');
  // obsada 2.11: Ania i Basia
  await expect(page.getByRole('row', { name: /^Obsada/ })).toContainText('2');
  await expect(page.getByRole('columnheader', { name: /^4/ })).toHaveClass(/today/);
  expect(problems).toEqual([]);
});

test('wpisanie godzin z klawiatury, cofnij i ponów (Ctrl+Z / Ctrl+Shift+Z)', async ({ page }) => {
  await withTeam(page);
  await cell(page, 'Ania', 5).click();
  await page.keyboard.type('10-18');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'Ania', 5)).toContainText('10–18');
  let rowsDb = await activeShifts(page);
  expect(rowsDb).toHaveLength(1);
  expect(rowsDb[0]).toMatchObject({
    personId: 'p0',
    date: nov(5),
    start: '10:00',
    end: '18:00',
    usesDefaultHours: false,
    source: 'manual',
  });
  const id = rowsDb[0]!.id;

  await page.keyboard.press('Control+z');
  await expect(cell(page, 'Ania', 5)).not.toContainText('10–18');
  expect(await activeShifts(page)).toHaveLength(0);

  await page.keyboard.press('Control+Shift+z');
  await expect(cell(page, 'Ania', 5)).toContainText('10–18');
  rowsDb = await activeShifts(page);
  expect(rowsDb.map((s) => s.id)).toEqual([id]); // to samo id — przywrócone, nie utworzone od nowa
});

test('kody: x = godziny domyślne wg dnia, u = urlop, nierozpoznany zapis nic nie zmienia', async ({
  page,
}) => {
  await withTeam(page);
  await cell(page, 'Basia', 6).click(); // piątek
  await page.keyboard.type('x');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'Basia', 6)).toContainText('10–23');

  await cell(page, 'Basia', 7).click();
  await page.keyboard.type('u');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'Basia', 7)).toContainText('U');

  await cell(page, 'Basia', 9).click();
  await page.keyboard.type('abc');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Nierozpoznany zapis' })).toBeVisible();
  await page.keyboard.press('Escape');
  const db = await activeShifts(page);
  expect(db.map((s) => s.date).sort()).toEqual([nov(6), nov(7)]);
  expect(db.find((s) => s.date === nov(6))).toMatchObject({ end: '23:00', usesDefaultHours: true });
});

test('zaznaczenie zakresu: przeciągnięcie, Shift+strzałki, Delete czyści, Cofnij przywraca te same rekordy', async ({
  page,
}) => {
  await withTeam(page, [
    shift('p0', nov(2)),
    shift('p0', nov(3)),
    shift('p1', nov(2)),
    shift('p1', nov(3)),
  ]);
  const before = (await activeShifts(page)).map((s) => s.id).sort();
  await cell(page, 'Ania', 2).click();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.getByRole('complementary', { name: 'Panel zaznaczenia' })).toContainText(
    '2 os. × 2 dni = 4 komórek',
  );
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await activeShifts(page)).length).toBe(0);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await activeShifts(page)).map((s) => s.id).sort()).toEqual(before);
});

test('kopiowanie i wklejanie TSV między komórkami oraz wklejenie z arkusza', async ({ page }) => {
  await withTeam(page, [
    shift('p0', nov(2)),
    shift('p0', nov(3), {
      kind: 'vacation',
      start: undefined,
      end: undefined,
      usesDefaultHours: false,
    }),
  ]);
  await cell(page, 'Ania', 2).click();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Control+c');
  await cell(page, 'Basia', 9).click();
  await page.evaluate(() => {
    // Ctrl+V odczytuje schowek systemowy — w teście wysyłamy to samo zdarzenie z tekstem TSV
    const dt = new DataTransfer();
    dt.setData('text/plain', '10:00-22:00\tU');
    document
      .querySelector('[role=application]')!
      .dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
  });
  await expect(cell(page, 'Basia', 9)).toContainText('10–22');
  await expect(cell(page, 'Basia', 10)).toContainText('U');

  // wklejenie z Excela: dwa wiersze, pusta komórka czyści, „12-20” to własne godziny
  await cell(page, 'Celina', 2).click();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '12-20\tw\r\n\tl4\r\n');
    document
      .querySelector('[role=application]')!
      .dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
  });
  await expect(cell(page, 'Celina', 2)).toContainText('12–20');
  await expect(cell(page, 'Celina', 3)).toContainText('W');
  // drugi wiersz wypadłby poza ostatnią osobę — jest przycięty, nic nie trafia do kolumny „4”
  await expect(cell(page, 'Celina', 4)).not.toContainText('L4');
  expect((await activeShifts(page)).filter((s) => s.kind === 'sick')).toHaveLength(0);
});

test('wypełnianie w dół (Ctrl+D) i w prawo (Ctrl+R)', async ({ page }) => {
  await withTeam(page, [
    shift('p0', nov(2), {
      kind: 'sick',
      start: undefined,
      end: undefined,
      usesDefaultHours: false,
    }),
  ]);
  await cell(page, 'Ania', 2).click();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Control+d');
  await expect(cell(page, 'Basia', 2)).toContainText('L4');
  await expect(cell(page, 'Celina', 2)).toContainText('L4');
  await cell(page, 'Ania', 2).click();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Control+r');
  await expect(cell(page, 'Ania', 3)).toContainText('L4');
  await expect(cell(page, 'Ania', 4)).toContainText('L4');
});

test('menu kontekstowe: Urlop dla zaznaczenia; Wyczyść', async ({ page }) => {
  await withTeam(page, [shift('p1', nov(9))]);
  await cell(page, 'Basia', 9).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Urlop/ }).click();
  await expect(cell(page, 'Basia', 9)).toContainText('U');
  await cell(page, 'Basia', 9).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /^Wyczyść/ }).click();
  await expect.poll(async () => (await activeShifts(page)).length).toBe(0);
});

test('panel zaznaczenia: własne godziny dla zakresu i notatka', async ({ page }) => {
  await withTeam(page);
  await cell(page, 'Ania', 10).click();
  await page.keyboard.press('Shift+ArrowRight');
  const panel = page.getByRole('complementary', { name: 'Panel zaznaczenia' });
  await panel.getByRole('radio', { name: 'Praca — własne godziny' }).check();
  await panel.getByRole('textbox', { name: 'Początek zmiany' }).fill('12:00');
  await panel.getByRole('textbox', { name: 'Koniec zmiany' }).fill('20:00');
  await panel.getByRole('textbox', { name: 'Notatka' }).fill('szkolenie');
  await panel.getByRole('button', { name: 'Zastosuj' }).click();
  await expect(cell(page, 'Ania', 10)).toContainText('12–20');
  await expect(cell(page, 'Ania', 11)).toContainText('12–20');
  const db = await activeShifts(page);
  expect(db).toHaveLength(2);
  expect(
    db.every(
      (s) =>
        s.note === 'szkolenie' && s.start === '12:00' && s.end === '20:00' && !s.usesDefaultHours,
    ),
  ).toBe(true);

  // błędne godziny w panelu
  await panel.getByRole('textbox', { name: 'Koniec zmiany' }).fill('12:00');
  await panel.getByRole('button', { name: 'Zastosuj' }).click();
  await expect(panel.getByRole('alert')).toContainText('poprawne, różne godziny');
});

test('okres: strzałki, tydzień, „Dziś”, wybór miesiąca i filtr osób', async ({ page }) => {
  await withTeam(page, [shift('p0', nov(2))]);
  await page.getByRole('button', { name: 'Następny okres' }).click();
  await expect(page.getByRole('heading', { name: 'Grudzień 2026' })).toBeVisible();
  await page.getByRole('button', { name: 'Dziś' }).click();
  await expect(page.getByRole('heading', { name: 'Listopad 2026' })).toBeVisible();
  await page.getByRole('button', { name: 'Tydzień' }).click();
  await expect(page.getByRole('columnheader')).toHaveCount(1 + 7 + 1);
  await page.getByRole('button', { name: 'Miesiąc', exact: true }).click();
  await page.getByLabel('Rok').selectOption('2027');
  await expect(page.getByRole('heading', { name: 'Listopad 2027' })).toBeVisible();
  await page.getByLabel('Rok').selectOption('2026');

  await page.getByRole('searchbox', { name: 'Szukaj osoby' }).fill('basia');
  await expect(page.getByRole('row', { name: /^Basia/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /^Ania/ })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Szukaj osoby' }).fill('');
  await page.getByLabel('Ukryj bez zmian').check();
  await expect(page.getByRole('row', { name: /^Ania/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /^Basia/ })).toHaveCount(0);
});

test('nawigacja klawiaturą po siatce i edycja Enterem; Escape anuluje', async ({ page }) => {
  await withTeam(page, [
    shift('p0', nov(1), { start: '09:00', end: '17:00', usesDefaultHours: false }),
  ]);
  await cell(page, 'Ania', 1).click();
  await page.keyboard.press('Enter');
  const editor = page.getByRole('textbox', { name: 'Zawartość komórki' });
  await expect(editor).toHaveValue('09:00-17:00');
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await expect(cell(page, 'Basia', 2)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+a');
  await expect(page.getByRole('complementary', { name: 'Panel zaznaczenia' })).toContainText(
    '3 os. × 30 dni = 90 komórek',
  );
  await page.keyboard.press('PageDown');
  await expect(page.getByRole('heading', { name: 'Grudzień 2026' })).toBeVisible();
});

test('eksport CSV siatki i zarchiwizowane osoby tylko na życzenie', async ({ page }) => {
  await openPc(page);
  await seedPc(page, {
    persons: [...TEAM, person(3, 'Dawid', { archived: true })],
    shifts: [shift('p0', nov(2)), shift('p0', nov(6))],
  });
  await expect(page.getByRole('row', { name: /^Dawid/ })).toHaveCount(0);
  await page.getByLabel('Zarchiwizowane').check();
  await expect(page.getByRole('row', { name: /^Dawid/ })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Grafik_2026-11-01_2026-11-30.csv');
  const text = await (await import('node:fs/promises')).readFile((await download.path())!, 'utf8');
  expect(text.charCodeAt(0)).toBe(0xfeff); // BOM — Excel czyta polskie znaki
  expect(text).toContain('Osoba;01.11 nd;02.11 pn');
  expect(text).toMatch(/Ania;;10:00-22:00;/);
  expect((await readStore(page, 'shifts')).length).toBe(2);
});
