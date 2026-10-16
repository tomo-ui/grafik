import { expect, test, type Page } from '@playwright/test';

// „Dzisiaj” = środa 4.11.2026 (tydzień pn 2.11 – nd 8.11)
const NOW = new Date(2026, 10, 4, 10, 0);

interface P {
  id: string;
  firstName: string;
  lastName?: string;
  color: string;
  aliases: string[];
  isMe: boolean;
  archived: boolean;
  order: number;
  createdAt: number;
}
interface S {
  id: string;
  personId: string;
  date: string;
  kind: string;
  start?: string;
  end?: string;
  usesDefaultHours: boolean;
  note?: string;
  source: string;
  updatedAt: number;
}

const COLORS = ['blue', 'green', 'orange', 'pink', 'purple', 'teal', 'indigo', 'red', 'yellow'];
const person = (i: number, firstName: string, extra: Partial<P> = {}): P => ({
  id: `p${i}`,
  firstName,
  color: COLORS[i % COLORS.length]!,
  aliases: [],
  isMe: false,
  archived: false,
  order: i,
  createdAt: i,
  ...extra,
});

const dow = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getDay();
};
const shift = (personId: string, date: string, extra: Partial<S> = {}): S => ({
  id: `${personId}-${date}`,
  personId,
  date,
  kind: 'work',
  start: '10:00',
  end: [5, 6].includes(dow(date)) ? '23:00' : '22:00',
  usesDefaultHours: true,
  source: 'manual',
  updatedAt: 1,
  ...extra,
});
const WEEK = [
  '2026-11-02',
  '2026-11-03',
  '2026-11-04',
  '2026-11-05',
  '2026-11-06',
  '2026-11-07',
  '2026-11-08',
];

async function start(page: Page, name = 'Ania') {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('textbox', { name: 'Imię' }).fill(name);
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('button', { name: 'Gotowe' }).click();
  await expect(page.getByRole('heading', { name: 'Mój grafik' })).toBeVisible();
}

/** Zapis wprost do IndexedDB (szybciej niż przez UI), potem przeładowanie. */
async function seed(page: Page, persons: P[], shifts: S[]) {
  await page.evaluate(
    ({ persons, shifts }) =>
      new Promise<void>((res, rej) => {
        const open = indexedDB.open('grafik');
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['persons', 'shifts'], 'readwrite');
          persons.forEach((p) => tx.objectStore('persons').put(p));
          shifts.forEach((s) => tx.objectStore('shifts').put(s));
          tx.oncomplete = () => {
            db.close();
            res();
          };
          tx.onerror = () => rej(tx.error);
        };
      }),
    { persons, shifts },
  );
  await page.reload();
}

const toTeam = async (page: Page) => {
  await page.getByRole('button', { name: 'Zespół' }).click();
  await expect(page.getByTestId('team-grid')).toBeVisible();
};

const eight = () =>
  ['Ania', 'Basia', 'Celina', 'Dorota', 'Ewa', 'Fela', 'Gosia', 'Hania']
    .map((n, i) => (i === 0 ? null : person(i, n)))
    .filter((p): p is P => p !== null);

/** Ania (isMe, p0 z onboardingu) + 7 osób = 8 w tygodniu z pełnym grafikiem */
async function seedEight(page: Page) {
  const people = eight();
  const ids = ['p0', ...people.map((p) => p.id)];
  // osoba z onboardingu ma losowe id — dołączamy jej zmiany przez odczyt
  const meId = await page.evaluate(
    () =>
      new Promise<string>((res) => {
        const open = indexedDB.open('grafik');
        open.onsuccess = () => {
          const all = open.result.transaction('persons').objectStore('persons').getAll();
          all.onsuccess = () => res((all.result[0] as { id: string }).id);
        };
      }),
  );
  ids[0] = meId;
  const shifts = ids.flatMap((id) => WEEK.map((d) => shift(id, d)));
  await seed(page, people, shifts);
  return meId;
}

test('akceptacja: tydzień 8 osób bez przewijania w poziomie, sumy i obsada', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));

  await start(page);
  await seedEight(page);
  await toTeam(page);

  const grid = page.getByTestId('team-grid');
  const { sw, cw } = await grid.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(sw).toBeLessThanOrEqual(cw); // bez przewijania w poziomie

  // 8 wierszy × 7 dni, godziny widoczne w obrębie ekranu
  await expect(
    page.getByRole('button', { name: /Basia, wtorek 3|Basia, wtorek, 3 listopada/ }),
  ).toBeVisible();
  const vw = page.viewportSize()!.width;
  const cells = page.getByRole('button', { name: /Basia, .*10:00–2[23]:00/ });
  expect(await cells.count()).toBe(7);
  for (const box of await cells.evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, w: r.width };
    }),
  )) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.w).toBeLessThanOrEqual(vw + 0.5);
    expect(box.w).toBeGreaterThanOrEqual(44 - 1); // obszar dotyku ≈ 44 pt
  }

  // suma: 5 × 12 h + 2 × 13 h = 86 h; obsada 8 os. w nagłówku
  await expect(grid.getByText('86 h').first()).toBeVisible();
  await expect(grid.getByText('8 os.').first()).toBeVisible();
  // dzisiejszy dzień wyróżniony
  await expect(grid.locator('[class*=todayNum]')).toHaveText('4');
  expect(problems).toEqual([]);
});

test('tydzień: nawigacja strzałkami, Dziś i przesunięcie palcem; miesiąc: bez swipe (P-07)', async ({
  page,
}) => {
  await start(page);
  await toTeam(page);
  const label = page.getByTestId('period-label');
  await expect(label).toHaveText('2–8 listopada');

  await page.getByRole('button', { name: 'Następny tydzień' }).click();
  await expect(label).toHaveText('9–15 listopada');
  await page.getByRole('button', { name: 'Dziś' }).click();
  await expect(label).toHaveText('2–8 listopada');

  // przesunięcie w lewo → następny tydzień
  const grid = page.getByTestId('team-grid');
  const box = (await grid.boundingBox())!;
  const y = box.y + 120;
  await page.mouse.move(box.x + box.width - 40, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 100, y, { steps: 6 });
  await page.mouse.move(box.x + 100, y, { steps: 6 });
  await page.mouse.up();
  await expect(label).toHaveText('9–15 listopada');
  // w prawo → poprzedni
  await page.mouse.move(box.x + 100, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, y, { steps: 6 });
  await page.mouse.move(box.x + box.width - 60, y, { steps: 6 });
  await page.mouse.up();
  await expect(label).toHaveText('2–8 listopada');

  // tryb miesiąca: ten sam gest NIE zmienia okresu
  await page.getByRole('radio', { name: 'Miesiąc' }).click();
  await expect(label).toHaveText('listopad 2026');
  await page.mouse.move(box.x + box.width - 40, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, y, { steps: 10 });
  await page.mouse.up();
  await expect(label).toHaveText('listopad 2026');
});

test('miesiąc: poziome przewijanie, sticky kolumna imion i nagłówek dni (P-24)', async ({
  page,
}) => {
  await start(page);
  await seedEight(page);
  await toTeam(page);
  await page.getByRole('radio', { name: 'Miesiąc' }).click();
  const grid = page.getByTestId('team-grid');
  await expect(grid).toBeVisible();

  const dims = await grid.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(dims.sw).toBeGreaterThan(dims.cw); // 30 kolumn przewija się w poziomie

  const nameCell = page.locator('[class*=nameCell]').nth(1);
  const head = page.locator('[class*=head]').first();
  const before = { n: await nameCell.boundingBox(), h: await head.boundingBox() };

  await grid.evaluate((el) => {
    el.scrollLeft = 300;
    el.scrollTop = 40;
  });
  await page.waitForTimeout(200);
  const after = { n: await nameCell.boundingBox(), h: await head.boundingBox() };
  const gridBox = (await grid.boundingBox())!;

  // imiona zostają przy lewej krawędzi kontenera
  expect(Math.abs(after.n!.x - gridBox.x)).toBeLessThan(1.5);
  expect(Math.abs(before.n!.x - gridBox.x)).toBeLessThan(1.5);
  // nagłówek zostaje u góry mimo przewinięcia w pionie
  expect(Math.abs(after.h!.y - gridBox.y)).toBeLessThan(1.5);
});

test('filtry osób i „Ukryj bez zmian”; zarchiwizowana tylko ze zmianami', async ({ page }) => {
  await start(page);
  const people = [
    person(1, 'Basia'),
    person(2, 'Celina'),
    person(3, 'Dorota', { archived: true }),
    person(4, 'Ewa', { archived: true }),
  ];
  await seed(page, people, [shift('p1', '2026-11-03'), shift('p3', '2026-11-04')]);
  await toTeam(page);

  const rows = () => page.locator('[class*=nameCell]');
  // widoczne: Ania, Basia, Celina + Dorota (archiwalna, ale ma zmianę); Ewa ukryta
  await expect(rows()).toHaveCount(4);
  await expect(page.locator('[class*=nameCell]', { hasText: 'Ewa' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Ukryj bez zmian' }).click();
  await expect(rows()).toHaveCount(2); // Basia i Dorota
  await page.getByRole('button', { name: 'Ukryj bez zmian' }).click();

  await page
    .getByRole('group', { name: 'Filtr osób' })
    .getByRole('button', { name: 'Celina' })
    .click();
  await expect(rows()).toHaveCount(1);
  await page.getByRole('button', { name: 'Wszyscy' }).click();
  await expect(rows()).toHaveCount(4);
});

test('tap w pustą komórkę dodaje zmianę z preselekcją; tap w zmianę edytuje', async ({ page }) => {
  await start(page);
  await toTeam(page);
  await page.getByRole('button', { name: /Ania, środa, 4 listopada, brak zmiany/ }).click();
  const add = page.getByRole('dialog', { name: 'Dodaj zmianę' });
  await expect(add).toBeVisible();
  await expect(add.getByRole('button', { name: 'Ania' })).toHaveAttribute('aria-pressed', 'true');
  await expect(add.getByText('Dni · 1')).toBeVisible();
  await add.getByRole('button', { name: 'Dodaj 1 zmiana' }).click();

  const cell = page.getByRole('button', { name: /Ania, środa, 4 listopada, 10:00–22:00/ });
  await expect(cell).toBeVisible();
  await expect(cell).toContainText('10:00');
  await expect(cell).toContainText('22:00');

  await cell.click();
  const edit = page.getByRole('dialog', { name: 'Edytuj zmianę' });
  await expect(edit).toBeVisible();
  await expect(edit.getByText('środa, 4 listopada')).toBeVisible();
});

test('long-press: menu Edytuj / Duplikuj na… / Usuń', async ({ page }) => {
  await start(page);
  await toTeam(page);
  // własne godziny 12:00–18:00 w czwartek
  await page.getByRole('button', { name: /Ania, czwartek, 5 listopada, brak zmiany/ }).click();
  const add = page.getByRole('dialog', { name: 'Dodaj zmianę' });
  await add.getByRole('switch', { name: 'Domyślne wg dnia' }).click();
  await add.getByLabel('Początek zmiany').fill('12:00');
  await add.getByLabel('Koniec zmiany').fill('18:00');
  await add.getByRole('button', { name: 'Dodaj 1 zmiana' }).click();
  await expect(add).toBeHidden();

  const cell = page.getByRole('button', { name: /Ania, czwartek, 5 listopada, 12:00–18:00/ });
  const box = (await cell.boundingBox())!;
  const press = async () => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
  };

  await press();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText(['Edytuj', 'Duplikuj na…', 'Usuń']);

  // Duplikuj: sheet dodawania z godzinami 12:00–18:00 (własne), bez dni
  await menu.getByRole('menuitem', { name: 'Duplikuj na…' }).click();
  const dup = page.getByRole('dialog', { name: 'Dodaj zmianę' });
  await expect(dup).toBeVisible();
  await expect(dup.getByText('Dni · 0')).toBeVisible();
  await expect(dup.getByLabel('Początek zmiany')).toHaveValue('12:00');
  await expect(dup.getByLabel('Koniec zmiany')).toHaveValue('18:00');
  await page.getByTestId('sheet-scrim').click({ position: { x: 10, y: 10 } });
  await expect(dup).toBeHidden();

  // Usuń z menu + Cofnij
  await press();
  await page.getByRole('menuitem', { name: 'Usuń' }).click();
  await expect(cell).toHaveCount(0);
  await page
    .getByRole('status')
    .filter({ hasText: 'Usunięto' })
    .getByRole('button', { name: 'Cofnij' })
    .click();
  await expect(cell).toBeVisible();
});

test('zaznaczanie w siatce i usuwanie zbiorcze; przełącznik widoku grid ↔ lista', async ({
  page,
}) => {
  await start(page);
  await seedEight(page);
  await toTeam(page);

  await page.getByRole('button', { name: 'Wybierz' }).click();
  await page.getByRole('button', { name: /Basia, poniedziałek, 2 listopada/ }).click();
  await page.getByRole('button', { name: /Basia, wtorek, 3 listopada/ }).click();
  await expect(page.getByRole('toolbar')).toContainText('2 zmiany');
  await page.getByRole('button', { name: 'Usuń zaznaczone' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Usuń' }).click();
  await expect(
    page.getByRole('button', { name: /Basia, poniedziałek, 2 listopada, brak zmiany/ }),
  ).toBeVisible();
  await page.getByRole('status').getByRole('button', { name: 'Cofnij' }).click();
  await expect(
    page.getByRole('button', { name: /Basia, poniedziałek, 2 listopada, 10:00–22:00/ }),
  ).toBeVisible();

  // lista dni i powrót do siatki; wybór zapamiętany po przeładowaniu
  await page.getByRole('button', { name: 'Przełącz na listę dni' }).click();
  await expect(page.getByText('poniedziałek, 2 listopada')).toBeVisible();
  await page.reload();
  await expect(page.getByText('poniedziałek, 2 listopada')).toBeVisible();
  await page.getByRole('button', { name: 'Przełącz na siatkę' }).click();
  await expect(page.getByTestId('team-grid')).toBeVisible();
});

test('tryb i okres zapamiętane po przeładowaniu (Zustand persist)', async ({ page }) => {
  await start(page);
  await toTeam(page);
  await page.getByRole('radio', { name: 'Miesiąc' }).click();
  await page.getByRole('button', { name: 'Następny miesiąc' }).click();
  await expect(page.getByTestId('period-label')).toHaveText('grudzień 2026');
  await page.reload();
  await page.getByRole('button', { name: 'Zespół' }).click();
  await expect(page.getByTestId('period-label')).toHaveText('grudzień 2026');
  await expect(page.getByRole('radio', { name: 'Miesiąc' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('większy tekst systemowy przełącza siatkę na listę dni', async ({ page }) => {
  await start(page);
  await toTeam(page);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '24px';
    window.dispatchEvent(new Event('resize'));
  });
  await expect(page.getByTestId('team-grid')).toHaveCount(0);
  await expect(page.getByText('Brak zmian w tym okresie.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Przełącz na/ })).toHaveCount(0);
});

test('E-28 / E-29: długie imię z wielokropkiem, takie same imiona z inicjałem', async ({
  page,
}) => {
  await start(page);
  const long = 'Bartłomiej-Maksymilian Wojciechowski';
  await seed(
    page,
    [
      person(1, long.slice(0, 30), { lastName: 'W' }),
      person(2, 'Anna', { lastName: 'Kowalska' }),
      person(3, 'Anna', { lastName: 'Nowak' }),
    ],
    [shift('p1', '2026-11-03'), shift('p2', '2026-11-03'), shift('p3', '2026-11-04')],
  );
  await toTeam(page);
  const grid = page.getByTestId('team-grid');
  const { sw, cw } = await grid.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(sw).toBeLessThanOrEqual(cw); // długie imię nie rozpycha siatki
  await expect(page.locator('[class*=nameCell]', { hasText: 'Anna K.' })).toHaveCount(1);
  await expect(page.locator('[class*=nameCell]', { hasText: 'Anna N.' })).toHaveCount(1);
  const nameEl = page
    .locator('[class*=nameCell]', { hasText: 'Bartłomiej' })
    .locator('[class*=_name_]');
  const clipped = await nameEl.evaluate((e) => e.scrollWidth > e.clientWidth);
  expect(clipped).toBe(true); // wielokropek (text-overflow)
});

test('Mój grafik: najbliższa zmiana, podsumowanie miesiąca, grupy tygodni', async ({ page }) => {
  await start(page);
  const meId = await page.evaluate(
    () =>
      new Promise<string>((res) => {
        const open = indexedDB.open('grafik');
        open.onsuccess = () => {
          const all = open.result.transaction('persons').objectStore('persons').getAll();
          all.onsuccess = () => res((all.result[0] as { id: string }).id);
        };
      }),
  );
  await seed(
    page,
    [person(1, 'Basia'), person(2, 'Celina')],
    [
      shift(meId, '2026-11-02'), // przeszłość w miesiącu
      shift(meId, '2026-11-04'), // dziś 10–22
      shift(meId, '2026-11-06'), // pt 10–23
      shift(meId, '2026-11-07', { kind: 'off', start: undefined, end: undefined }),
      shift(meId, '2026-11-10', { start: '12:00', end: '18:30', usesDefaultHours: false }),
      shift(meId, '2026-11-25'),
      shift('p1', '2026-11-04'),
      shift('p2', '2026-11-04'),
    ],
  );

  const card = page.getByTestId('next-shift');
  await expect(card).toContainText('środa, 4 listopada');
  await expect(card).toContainText('10:00–22:00');
  await expect(card).toContainText('dziś');
  await expect(card).toContainText('z Tobą: Basia, Celina');

  // 5 zmian pracy w listopadzie: 2.11, 4.11, 6.11 (12+12+13) + 10.11 (6,5) + 25.11 (12) = 55,5 h; 1 wolne
  const sum = page.getByTestId('month-summary');
  await expect(sum).toContainText('5');
  await expect(sum).toContainText('55,5 h');
  await expect(sum).toContainText('wolne');

  // lista nadchodzących: grupy tygodni; zmiana z przeszłości (2.11) nie występuje
  await expect(page.getByRole('heading', { name: 'Ten tydzień' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Następny tydzień' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '23–29 listopada' })).toBeVisible();
  await expect(page.getByText('poniedziałek, 2 listopada')).toHaveCount(0);
  await expect(page.getByText('12:00–18:30')).toBeVisible();

  // tap otwiera edycję
  await page.getByRole('button', { name: /wtorek, 10 listopada/ }).click();
  await expect(page.getByRole('dialog', { name: 'Edytuj zmianę' })).toBeVisible();
});

test('Mój grafik: bez „Ja” pusty stan z przejściem do osób', async ({ page }) => {
  await start(page);
  await page.evaluate(
    () =>
      new Promise<void>((res) => {
        const open = indexedDB.open('grafik');
        open.onsuccess = () => {
          const tx = open.result.transaction('persons', 'readwrite');
          const store = tx.objectStore('persons');
          const all = store.getAll();
          all.onsuccess = () =>
            (all.result as { isMe: boolean }[]).forEach((p) => store.put({ ...p, isMe: false }));
          tx.oncomplete = () => res();
        };
      }),
  );
  await page.reload();
  await expect(page.getByText('Nie wybrano, która osoba to Ty.')).toBeVisible();
  await page.getByRole('button', { name: 'Wybierz siebie z listy osób' }).click();
  await expect(page.getByRole('heading', { name: 'Osoby' })).toBeVisible();
});

test('Mój grafik: brak zmian — karta zachęca do dodania', async ({ page }) => {
  await start(page);
  await expect(page.getByTestId('next-shift')).toContainText('Brak zaplanowanych zmian');
  await page.getByTestId('next-shift').getByRole('button', { name: 'Dodaj zmianę' }).click();
  await expect(page.getByRole('dialog', { name: 'Dodaj zmianę' })).toBeVisible();
});

test('Kalendarz: kropki (max 4 + reszta), lista „Kto pracuje”, dodanie w dniu', async ({
  page,
}) => {
  await start(page);
  const people = [1, 2, 3, 4, 5].map((i) => person(i, `Osoba${i}`));
  await seed(page, people, [
    ...people.map((p) => shift(p.id, '2026-11-04')), // 5 osób + Ania nie ma zmiany = 5
    shift('p1', '2026-11-05'),
  ]);
  await page.getByRole('button', { name: 'Kalendarz' }).click();
  const cal = page.getByTestId('calendar');
  await expect(cal).toBeVisible();

  const day4 = cal.getByRole('button', { name: /środa, 4 listopada/ });
  await expect(day4).toHaveAttribute('aria-label', /w pracy: 5/);
  expect(await day4.locator('i').count()).toBe(4);
  await expect(day4).toContainText('+1');
  await expect(cal.getByRole('button', { name: /czwartek, 5 listopada/ }).locator('i')).toHaveCount(
    1,
  );

  await day4.click();
  await expect(
    page.getByRole('heading', { name: /Kto pracuje · środa, 4 listopada/ }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Osoba3/ })).toBeVisible();

  await page.getByRole('button', { name: 'Dodaj zmianę w tym dniu' }).click();
  const add = page.getByRole('dialog', { name: 'Dodaj zmianę' });
  await expect(add.getByRole('button', { name: 'środa, 4 listopada' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByTestId('sheet-scrim').click({ position: { x: 10, y: 10 } });
  await expect(add).toBeHidden();

  await page.getByRole('button', { name: 'Następny miesiąc' }).click();
  await expect(page.getByRole('button', { name: /listopad|grudzień 2026/ }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /Kto pracuje/ })).toHaveCount(0);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`zrzuty faza 6 — ${scheme}`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await start(page);
    const meId = await seedEight(page);
    const shot = (n: string) =>
      page.screenshot({ path: `docs/screens/faza6/${info.project.name}-${scheme}-${n}.png` });
    await expect(page.getByTestId('next-shift')).toContainText('dziś');
    await shot('1-moj-grafik');
    await page.getByRole('button', { name: 'Zespół' }).click();
    await expect(page.getByTestId('team-grid')).toBeVisible();
    await page.waitForTimeout(300);
    await shot('2-siatka-tydzien');
    await page.getByRole('radio', { name: 'Miesiąc' }).click();
    await page.waitForTimeout(300);
    await shot('3-siatka-miesiac');
    await page.getByRole('button', { name: 'Przełącz na listę dni' }).click();
    await page.waitForTimeout(300);
    await shot('4-lista-dni');
    await page.getByRole('button', { name: 'Kalendarz' }).click();
    await page.getByRole('button', { name: /środa, 4 listopada/ }).click();
    await expect(page.getByRole('heading', { name: /Kto pracuje/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Basia/ })).toBeVisible();
    await shot('5-kalendarz');
    expect(meId).toBeTruthy();
  });
}
