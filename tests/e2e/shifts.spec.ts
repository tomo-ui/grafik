import { expect, test, type Page } from '@playwright/test';

// Stały „dzisiaj” = środa 4.11.2026 (tydzień pn 2.11 – nd 8.11), żeby testy były deterministyczne
const NOW = new Date(2026, 10, 4, 10, 0);

interface Row {
  id: string;
  personId: string;
  date: string;
  kind: string;
  start?: string;
  end?: string;
  usesDefaultHours: boolean;
  note?: string;
  deletedAt?: number;
}

const readShifts = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<Row[]>((res) => {
        const open = indexedDB.open('grafik');
        open.onsuccess = () => {
          const all = open.result.transaction('shifts').objectStore('shifts').getAll();
          all.onsuccess = () => res(all.result as Row[]);
        };
      }),
  );
const active = async (page: Page) => (await readShifts(page)).filter((s) => !s.deletedAt);

async function start(page: Page, name = 'Ania') {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('textbox', { name: 'Imię' }).fill(name);
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('button', { name: 'Gotowe' }).click();
  await expect(page.getByRole('heading', { name: 'Mój grafik' })).toBeVisible();
}

async function addPerson(page: Page, name: string) {
  await page.getByRole('button', { name: 'Ustawienia' }).click();
  await page.getByRole('button', { name: /Osoby/ }).click();
  await page.getByRole('button', { name: 'Dodaj osobę' }).click();
  const dlg = page.getByRole('dialog', { name: 'Nowa osoba' });
  await dlg.getByRole('textbox', { name: 'Imię' }).fill(name);
  await dlg.getByRole('button', { name: 'Zapisz' }).click();
  await expect(dlg).toBeHidden();
  await page.getByRole('button', { name: 'Wróć' }).click();
  await page.getByRole('button', { name: 'Mój grafik' }).click();
}

/** „+” → „Dodaj zmianę” (2 tapnięcia) */
const fab = (page: Page) => ({
  click: async () => {
    await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Dodaj zmianę' }).click();
  },
});
const addSheet = (page: Page) => page.getByRole('dialog', { name: 'Dodaj zmianę' });
const day = (page: Page, label: string) => addSheet(page).getByRole('button', { name: label });
const toast = (page: Page, text: string | RegExp) =>
  page.getByRole('status').filter({ hasText: text });

const weekdayOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getDay();
};

test('akceptacja: 2 osoby × cały tydzień w ≤ 5 tapnięciach, Pt/Sb 10–23', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));

  await start(page, 'Ania');
  await addPerson(page, 'Basia');

  await fab(page).click(); // tapnięcia 1–2: „+” i „Dodaj zmianę”
  await expect(addSheet(page)).toBeVisible();
  await addSheet(page).getByRole('button', { name: 'Basia' }).click(); // tap 3 (Ania jest domyślnie)
  await addSheet(page).getByRole('button', { name: 'Cały tydzień' }).click(); // tap 4
  await expect(addSheet(page).getByText('Dni · 7')).toBeVisible();
  await addSheet(page).getByRole('button', { name: 'Dodaj 14 zmian' }).click(); // tap 5 — razem 5

  await expect(toast(page, 'Dodano 14 zmian')).toBeVisible();
  const rows = await active(page);
  expect(rows).toHaveLength(14);
  for (const r of rows) {
    const wd = weekdayOf(r.date);
    expect(r.kind).toBe('work');
    expect(r.start).toBe('10:00');
    expect(r.end, r.date).toBe(wd === 5 || wd === 6 ? '23:00' : '22:00');
    expect(r.usesDefaultHours).toBe(true);
  }
  expect(new Set(rows.map((r) => r.date)).size).toBe(7);
  expect(problems).toEqual([]);
});

test('kalendarz: tap, przeciągnięcie zakresu, odznaczanie, Wyczyść', async ({ page }) => {
  await start(page);
  await fab(page).click();
  await day(page, 'wtorek, 3 listopada').click();
  await day(page, 'czwartek, 5 listopada').click();
  await expect(addSheet(page).getByText('Dni · 2')).toBeVisible();
  await day(page, 'wtorek, 3 listopada').click();
  await expect(addSheet(page).getByText('Dni · 1')).toBeVisible();

  // przeciągnięcie od pon. 9 do czw. 12 listopada zaznacza zakres (4 dni)
  const from = (await day(page, 'poniedziałek, 9 listopada').boundingBox())!;
  const to = (await day(page, 'czwartek, 12 listopada').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(addSheet(page).getByText('Dni · 5')).toBeVisible();
  for (const l of ['poniedziałek, 9 listopada', 'wtorek, 10 listopada', 'czwartek, 12 listopada']) {
    await expect(day(page, l)).toHaveAttribute('aria-pressed', 'true');
  }

  // nawigacja po miesiącach zachowuje zaznaczenie
  await addSheet(page).getByRole('button', { name: 'Następny miesiąc' }).click();
  await expect(addSheet(page).getByText('grudzień 2026')).toBeVisible();
  await addSheet(page).getByRole('button', { name: 'Poprzedni miesiąc' }).click();
  await expect(day(page, 'wtorek, 10 listopada')).toHaveAttribute('aria-pressed', 'true');

  await addSheet(page).getByRole('button', { name: 'Wyczyść' }).click();
  await expect(addSheet(page).getByText('Dni · 0')).toBeVisible();
});

test('szybkie zaznaczenia: Pn–Pt, Weekendy, powtarzanie co tydzień', async ({ page }) => {
  await start(page);
  await fab(page).click();
  await addSheet(page).getByRole('button', { name: 'Pn–Pt' }).click();
  await expect(addSheet(page).getByText('Dni · 5')).toBeVisible();
  await addSheet(page).getByRole('button', { name: 'Weekendy' }).click();
  await expect(addSheet(page).getByText('Dni · 7')).toBeVisible();

  await addSheet(page).getByRole('button', { name: 'Wyczyść' }).click();
  await day(page, 'środa, 4 listopada').click();
  await addSheet(page).getByRole('button', { name: 'Powtórz co tydzień do…' }).click();
  await addSheet(page).getByLabel('Powtarzaj do').fill('2026-11-25');
  await expect(addSheet(page).getByText('Dni · 4')).toBeVisible(); // 4, 11, 18, 25
});

test('typ Urlop: bez godzin; własne godziny i walidacja', async ({ page }) => {
  await start(page);
  await fab(page).click();
  await day(page, 'środa, 4 listopada').click();

  // własne godziny: równe = błąd, +1 dzień = ostrzeżenie
  await addSheet(page).getByRole('switch', { name: 'Domyślne wg dnia' }).click();
  const start_ = addSheet(page).getByLabel('Początek zmiany');
  const end_ = addSheet(page).getByLabel('Koniec zmiany');
  await end_.fill('10:00');
  await expect(addSheet(page).getByText(/nie mogą być takie same/)).toBeVisible();
  await expect(addSheet(page).getByRole('button', { name: 'Dodaj zmiany' })).toBeDisabled();
  await start_.fill('18:00');
  await end_.fill('02:00');
  await expect(addSheet(page).getByText(/\+1 dzień/)).toBeVisible();
  await end_.fill('20:00');
  await start_.fill('12:00');

  // Urlop chowa sekcję godzin
  await addSheet(page).getByRole('radio', { name: 'Urlop' }).click();
  await expect(addSheet(page).getByText('Godziny', { exact: true })).toHaveCount(0);
  await addSheet(page).getByRole('textbox', { name: 'Notatka' }).fill('Wakacje');
  await addSheet(page).getByRole('button', { name: 'Dodaj 1 zmiana' }).click();

  await expect(toast(page, 'Dodano 1 zmiana')).toBeVisible();
  const rows = await active(page);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ kind: 'vacation', note: 'Wakacje', usesDefaultHours: false });
  expect(rows[0]?.start).toBeUndefined();
});

test('własne godziny zapisują się z flagą usesDefaultHours=false', async ({ page }) => {
  await start(page);
  await fab(page).click();
  await day(page, 'środa, 4 listopada').click();
  await addSheet(page).getByRole('switch', { name: 'Domyślne wg dnia' }).click();
  await addSheet(page).getByLabel('Początek zmiany').fill('12:00');
  await addSheet(page).getByLabel('Koniec zmiany').fill('18:00');
  await addSheet(page).getByRole('button', { name: 'Dodaj 1 zmiana' }).click();
  await expect(toast(page, 'Dodano')).toBeVisible();
  expect((await active(page))[0]).toMatchObject({
    start: '12:00',
    end: '18:00',
    usesDefaultHours: false,
  });
});

test('Cofnij po dodaniu usuwa dodane zmiany', async ({ page }) => {
  await start(page);
  await fab(page).click();
  await addSheet(page).getByRole('button', { name: 'Pn–Pt' }).click();
  await addSheet(page).getByRole('button', { name: 'Dodaj 5 zmian' }).click();
  await expect(toast(page, 'Dodano 5 zmian')).toBeVisible();
  expect(await active(page)).toHaveLength(5);
  await toast(page, 'Dodano 5 zmian').getByRole('button', { name: 'Cofnij' }).click();
  await expect.poll(async () => (await active(page)).length).toBe(0);
});

test('podwójne tapnięcie „Dodaj” zapisuje raz', async ({ page }) => {
  await start(page);
  await fab(page).click();
  await addSheet(page).getByRole('button', { name: 'Cały tydzień' }).click();
  await addSheet(page).getByRole('button', { name: 'Dodaj 7 zmian' }).dblclick();
  await expect(toast(page, 'Dodano 7 zmian')).toBeVisible();
  expect(await active(page)).toHaveLength(7);
});

test('kolizje: Pomiń, Zastąp i Cofnij przywraca zastąpione (E-03)', async ({ page }) => {
  await start(page);
  // istniejące: pn–pt własne godziny 12–18
  await fab(page).click();
  await addSheet(page).getByRole('button', { name: 'Pn–Pt' }).click();
  await addSheet(page).getByRole('switch', { name: 'Domyślne wg dnia' }).click();
  await addSheet(page).getByLabel('Początek zmiany').fill('12:00');
  await addSheet(page).getByLabel('Koniec zmiany').fill('18:00');
  await addSheet(page).getByRole('button', { name: 'Dodaj 5 zmian' }).click();
  await expect(toast(page, 'Dodano 5 zmian')).toBeVisible();
  await expect(addSheet(page)).toBeHidden();

  // cały tydzień domyślnymi: 5 kolizji
  await fab(page).click();
  await addSheet(page).getByRole('button', { name: 'Cały tydzień' }).click();
  await addSheet(page).getByRole('button', { name: 'Dodaj 7 zmian' }).click();
  const alert = page.getByRole('alertdialog');
  await expect(alert).toContainText('5 kolizji');

  await alert.getByRole('button', { name: 'Pomiń kolidujące' }).click();
  await expect(toast(page, 'Dodano 2 zmiany, pominięto 5')).toBeVisible();
  let rows = await active(page);
  expect(rows).toHaveLength(7);
  expect(rows.filter((r) => r.start === '12:00')).toHaveLength(5); // pierwotne zostały

  // Cofnij pominięcia → znów 5
  await toast(page, 'Dodano 2 zmiany').getByRole('button', { name: 'Cofnij' }).click();
  await expect.poll(async () => (await active(page)).length).toBe(5);

  // Zastąp
  await fab(page).click();
  await addSheet(page).getByRole('button', { name: 'Cały tydzień' }).click();
  await addSheet(page).getByRole('button', { name: 'Dodaj 7 zmian' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Zastąp' }).click();
  await expect(toast(page, 'Dodano 7 zmian')).toBeVisible();
  rows = await active(page);
  expect(rows).toHaveLength(7);
  expect(rows.every((r) => r.start === '10:00')).toBe(true);

  // Cofnij zastąpienie → wracają oryginały 12–18
  await toast(page, 'Dodano 7 zmian').getByRole('button', { name: 'Cofnij' }).click();
  await expect
    .poll(async () => (await active(page)).filter((r) => r.start === '12:00').length)
    .toBe(5);
  expect(await active(page)).toHaveLength(5);
});

async function seedWeek(page: Page) {
  await fab(page).click();
  await addSheet(page).getByRole('button', { name: 'Pn–Pt' }).click();
  await addSheet(page).getByRole('button', { name: 'Dodaj 5 zmian' }).click();
  await expect(toast(page, 'Dodano 5 zmian')).toBeVisible();
  await page.getByRole('button', { name: 'Zespół' }).click();
  // te testy sprawdzają widok „Lista dni” (swipe, zaznaczanie); siatka ma osobne testy w views.spec.ts
  await page.getByRole('button', { name: 'Przełącz na listę dni' }).click();
  await expect(page.getByRole('heading', { name: 'Zespół' })).toBeVisible();
}

test('lista dni: edycja godzin i typu przez sheet', async ({ page }) => {
  await start(page);
  await seedWeek(page);
  await expect(page.getByText('środa, 4 listopada · dziś')).toBeVisible();

  await page.getByRole('button', { name: /Ania/ }).nth(2).click(); // środa
  const edit = page.getByRole('dialog', { name: 'Edytuj zmianę' });
  await expect(edit).toBeVisible();
  await edit.getByRole('switch', { name: 'Domyślne wg dnia' }).click();
  await edit.getByLabel('Początek zmiany').fill('12:00');
  await edit.getByLabel('Koniec zmiany').fill('18:00');
  await edit.getByRole('button', { name: 'Zapisz' }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText('12:00–18:00')).toBeVisible();

  await page.getByRole('button', { name: /12:00–18:00/ }).click();
  await edit.getByRole('radio', { name: 'Wolne' }).click();
  await edit.getByRole('button', { name: 'Zapisz' }).click();
  await expect(page.getByText('Wolne')).toBeVisible();
  const wed = (await active(page)).find((r) => r.date === '2026-11-04')!;
  expect(wed.kind).toBe('off');
  expect(wed.start).toBeUndefined();
});

test('lista dni: usuwanie w sheecie z potwierdzeniem i Cofnij', async ({ page }) => {
  await start(page);
  await seedWeek(page);
  await page.getByRole('button', { name: /Ania/ }).first().click();
  const edit = page.getByRole('dialog', { name: 'Edytuj zmianę' });
  await edit.getByRole('button', { name: 'Usuń zmianę' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Usuń' }).click();
  await expect(toast(page, 'Usunięto zmianę')).toBeVisible();
  expect(await active(page)).toHaveLength(4);
  await toast(page, 'Usunięto zmianę').getByRole('button', { name: 'Cofnij' }).click();
  await expect.poll(async () => (await active(page)).length).toBe(5);
});

test('lista dni: swipe → Usuń → Cofnij (E-07, to samo id)', async ({ page }) => {
  await start(page);
  await seedWeek(page);
  const before = (await active(page)).map((r) => r.id).sort();
  const row = page.getByText('poniedziałek, 2 listopada').locator('xpath=..').getByText('Ania');
  await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const box = (await row.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 200, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, y, { steps: 5 });
  await page.mouse.move(box.x + 105, y, { steps: 5 });
  await page.mouse.up();
  await page.locator('[class*=swipeBtn]', { hasText: 'Usuń' }).first().click();
  await expect(toast(page, 'Usunięto 1 zmiana')).toBeVisible();
  expect(await active(page)).toHaveLength(4);
  await toast(page, 'Usunięto 1 zmiana').getByRole('button', { name: 'Cofnij' }).click();
  await expect.poll(async () => (await active(page)).length).toBe(5);
  expect((await active(page)).map((r) => r.id).sort()).toEqual(before);
});

test('lista dni: tryb zaznaczania i usuwanie zbiorcze z Cofnij', async ({ page }) => {
  await start(page);
  await seedWeek(page);
  await page.getByRole('button', { name: 'Wybierz' }).click();
  const rows = page.getByRole('checkbox');
  await expect(rows).toHaveCount(5);
  await rows.nth(0).click();
  await rows.nth(1).click();
  await expect(page.getByRole('toolbar')).toContainText('2 zmiany');
  await page.getByRole('button', { name: 'Usuń zaznaczone' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Usuń' }).click();
  await expect(toast(page, 'Usunięto 2 zmiany')).toBeVisible();
  expect(await active(page)).toHaveLength(3);
  await toast(page, 'Usunięto 2 zmiany').getByRole('button', { name: 'Cofnij' }).click();
  await expect.poll(async () => (await active(page)).length).toBe(5);
});

test('lista dni: pusty stan i nawigacja po okresach', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Zespół' }).click();
  await page.getByRole('button', { name: 'Przełącz na listę dni' }).click();
  await expect(page.getByText('Brak zmian w tym okresie.')).toBeVisible();
  await page.getByRole('radio', { name: 'Miesiąc' }).click();
  await expect(page.getByTestId('period-label')).toHaveText('listopad 2026');
  await page.getByRole('button', { name: 'Następny miesiąc' }).click();
  await expect(page.getByTestId('period-label')).toHaveText('grudzień 2026');
  await page.getByRole('button', { name: 'Dziś' }).click();
  await expect(page.getByTestId('period-label')).toHaveText('listopad 2026');
  await page.getByText('Dodaj zmianę', { exact: true }).click();
  await expect(addSheet(page)).toBeVisible();
  await expect(day(page, 'środa, 4 listopada')).toHaveAttribute('aria-pressed', 'true');
});

test('szkic formularza przetrwa ukrycie aplikacji (P-12)', async ({ page }) => {
  await start(page);
  await fab(page).click();
  await day(page, 'piątek, 6 listopada').click();
  await day(page, 'sobota, 7 listopada').click();
  await addSheet(page).getByRole('textbox', { name: 'Notatka' }).fill('Szkic');

  // symulacja ubicia aplikacji w tle: visibilitychange → hidden, potem przeładowanie
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mój grafik' })).toBeVisible();
  await fab(page).click();
  await expect(addSheet(page).getByText('Dni · 2')).toBeVisible();
  await expect(addSheet(page).getByRole('textbox', { name: 'Notatka' })).toHaveValue('Szkic');

  // świadome zamknięcie czyści szkic
  await page.getByTestId('sheet-scrim').click({ position: { x: 10, y: 10 } });
  await expect(addSheet(page)).toBeHidden();
  await fab(page).click();
  await expect(addSheet(page).getByText('Dni · 0')).toBeVisible();
});

test('brak poziomego przewijania w sheecie dodawania i liście dni', async ({ page }) => {
  await start(page);
  await seedWeek(page);
  await fab(page).click();
  const overflow = () =>
    page.evaluate(() => {
      const d = document.querySelector('[role=dialog]') as HTMLElement;
      return (
        document.documentElement.scrollWidth > document.documentElement.clientWidth ||
        d.scrollWidth > d.clientWidth
      );
    });
  expect(await overflow()).toBe(false);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`zrzuty faza 5 — ${scheme}`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await start(page);
    const shot = (n: string) =>
      page.screenshot({ path: `docs/screens/faza5/${info.project.name}-${scheme}-${n}.png` });
    await fab(page).click();
    await addSheet(page).getByRole('button', { name: 'Pn–Pt' }).click();
    await page.waitForTimeout(600);
    await shot('1-dodawanie');
    await addSheet(page).getByRole('button', { name: 'Dodaj 5 zmian' }).click();
    await expect(toast(page, 'Dodano 5 zmian')).toBeVisible();
    await page.getByRole('button', { name: 'Zespół' }).click();
    await page.getByRole('button', { name: 'Przełącz na listę dni' }).click();
    await page.waitForTimeout(400);
    await shot('2-lista-dni');
    await page.getByRole('button', { name: 'Wybierz' }).click();
    await page.getByRole('checkbox').first().click();
    await shot('3-zaznaczanie');
  });
}
