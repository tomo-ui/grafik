import { expect, test, type Page } from '@playwright/test';

function watchConsole(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  return problems;
}

async function onboard(page: Page, name = 'Katarzyna') {
  await page.goto('/');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('textbox', { name: 'Imię' }).fill(name);
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('button', { name: 'Gotowe' }).click();
  await expect(page.getByRole('heading', { name: 'Mój grafik' })).toBeVisible();
}

async function openSettingsPeople(page: Page) {
  await page.getByRole('button', { name: 'Ustawienia' }).click();
  await page.getByRole('button', { name: /Osoby/ }).click();
  await expect(page.getByRole('heading', { name: 'Osoby' })).toBeVisible();
}

test('onboarding: 3 kroki, osoba „Ja”, dane przetrwają przeładowanie', async ({ page }) => {
  const problems = watchConsole(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Witaj w Grafiku' })).toBeVisible();

  await page.getByRole('button', { name: 'Dalej' }).click();
  await expect(page.getByRole('heading', { name: 'Jak masz na imię?' })).toBeVisible();
  const next = page.getByRole('button', { name: 'Dalej' });
  await expect(next).toBeDisabled(); // imię wymagane
  await page.getByRole('textbox', { name: 'Imię' }).fill('Katarzyna');
  await next.click();

  await expect(page.getByRole('heading', { name: 'Godziny domyślne' })).toBeVisible();
  // sekcja 1.1: piątek 10:00–23:00 (13 h), niedziela 10:00–22:00 (12 h)
  const fri = page.getByTestId('hours-5');
  await expect(fri.getByLabel('Piątek — koniec')).toHaveValue('23:00');
  await expect(fri).toContainText('13 h');
  await expect(page.getByTestId('hours-0')).toContainText('12 h');

  await page.getByRole('button', { name: 'Gotowe' }).click();
  await expect(page.getByRole('heading', { name: 'Mój grafik' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mój grafik' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Witaj w Grafiku' })).toHaveCount(0);

  await openSettingsPeople(page);
  await expect(page.getByText('Katarzyna')).toBeVisible();
  await expect(page.getByText('To ja')).toBeVisible();
  expect(problems).toEqual([]);
});

test('onboarding: podwójne tapnięcie „Gotowe” tworzy jedną osobę', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('textbox', { name: 'Imię' }).fill('Ola');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('button', { name: 'Gotowe' }).dblclick();
  await expect(page.getByRole('heading', { name: 'Mój grafik' })).toBeVisible();
  await openSettingsPeople(page);
  await expect(page.getByText('Ola', { exact: true })).toHaveCount(1);
});

test('osoby: dodanie z kolorem i aliasem, edycja, jedna zapisana przy dwukliku', async ({
  page,
}) => {
  await onboard(page);
  await openSettingsPeople(page);

  await page.getByRole('button', { name: 'Dodaj osobę' }).click();
  const dlg = page.getByRole('dialog', { name: 'Nowa osoba' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole('button', { name: 'Zapisz' })).toBeDisabled();
  await dlg.getByRole('textbox', { name: 'Imię' }).fill('Jan');
  await dlg.getByRole('textbox', { name: 'Nazwisko' }).fill('Kowalski');
  await dlg.getByRole('radio', { name: 'czerwony' }).click();
  await dlg.getByRole('textbox', { name: 'Nowy alias' }).fill('Janek');
  await dlg.getByRole('textbox', { name: 'Nowy alias' }).press('Enter');
  await expect(dlg.getByText('Janek')).toBeVisible();
  await dlg.getByRole('button', { name: 'Zapisz' }).dblclick();
  await expect(dlg).toBeHidden();
  await expect(page.getByText('Jan Kowalski')).toHaveCount(1);

  // edycja
  await page.getByText('Jan Kowalski').click();
  const edit = page.getByRole('dialog', { name: 'Edytuj osobę' });
  await expect(edit.getByRole('radio', { name: 'czerwony' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(edit.getByText('Janek')).toBeVisible();
  await edit.getByRole('textbox', { name: 'Imię' }).fill('Janusz');
  await edit.getByRole('button', { name: 'Zapisz' }).click();
  await expect(page.getByText('Janusz Kowalski')).toBeVisible();
});

test('osoby: „To ja” ma tylko jedna osoba', async ({ page }) => {
  await onboard(page, 'Ania');
  await openSettingsPeople(page);
  await page.getByRole('button', { name: 'Dodaj osobę' }).click();
  const dlg = page.getByRole('dialog', { name: 'Nowa osoba' });
  await dlg.getByRole('textbox', { name: 'Imię' }).fill('Basia');
  await dlg.getByRole('switch', { name: 'To ja' }).click();
  await dlg.getByRole('button', { name: 'Zapisz' }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByText('To ja')).toHaveCount(1);
  await expect(page.getByText('Basia').locator('xpath=..')).toContainText('To ja');
});

test('osoby: usunięcie z potwierdzeniem i Cofnij', async ({ page }) => {
  await onboard(page, 'Ania');
  await openSettingsPeople(page);
  await page.getByText('Ania').click();
  await page.getByRole('button', { name: 'Usuń osobę' }).click();
  const alert = page.getByRole('alertdialog');
  await expect(alert).toContainText('Usunąć: Ania?');
  await alert.getByRole('button', { name: 'Usuń' }).click();
  await expect(page.getByText('Ania', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cofnij' }).click();
  await expect(page.getByText('Ania', { exact: true })).toBeVisible();
});

test('osoby: zmiana kolejności przeciągnięciem zapisuje się', async ({ page }) => {
  await onboard(page, 'Ania');
  await openSettingsPeople(page);
  for (const n of ['Basia', 'Celina']) {
    await page.getByRole('button', { name: 'Dodaj osobę' }).click();
    const dlg = page.getByRole('dialog', { name: 'Nowa osoba' });
    await dlg.getByRole('textbox', { name: 'Imię' }).fill(n);
    await dlg.getByRole('button', { name: 'Zapisz' }).click();
    await expect(dlg).toBeHidden();
  }
  const names = () =>
    page
      .locator('[class*=reorderItem]')
      .evaluateAll((els) => els.map((e) => e.querySelector('[class*=title]')?.textContent));
  expect(await names()).toEqual(['Ania', 'Basia', 'Celina']);

  const grip = page.getByRole('img', { name: /zmienić kolejność: Celina/ });
  const target = page.getByRole('img', { name: /zmienić kolejność: Ania/ });
  const g = (await grip.boundingBox())!;
  const t = (await target.boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, g.y - 20, { steps: 5 });
  await page.mouse.move(t.x + t.width / 2, t.y - 60, { steps: 40 });
  await page.waitForTimeout(300);
  await page.mouse.up();
  await expect.poll(names).toEqual(['Celina', 'Ania', 'Basia']);
  // poczekaj na zatwierdzenie zapisu w IndexedDB, zanim przeładujemy stronę
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<string[]>((res) => {
            const open = indexedDB.open('grafik');
            open.onsuccess = () => {
              const all = open.result.transaction('persons').objectStore('persons').getAll();
              all.onsuccess = () =>
                res(
                  (all.result as { firstName: string; order: number }[])
                    .sort((a, b) => a.order - b.order)
                    .map((p) => p.firstName),
                );
            };
          }),
      ),
    )
    .toEqual(['Celina', 'Ania', 'Basia']);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Osoby' })).toBeVisible();
  await expect.poll(names).toEqual(['Celina', 'Ania', 'Basia']);
});

test('godziny domyślne: walidacja, zapis i trwałość', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Ustawienia' }).click();
  await page.getByRole('button', { name: /Godziny domyślne/ }).click();
  await expect(page.getByRole('heading', { name: 'Godziny domyślne' })).toBeVisible();

  const save = page.getByRole('button', { name: 'Zapisz' });
  await expect(save).toBeDisabled(); // brak zmian

  const mon = page.getByTestId('hours-1');
  await mon.getByLabel('Poniedziałek — koniec').fill('10:00'); // koniec = początek
  await expect(mon.getByRole('alert')).toContainText('nie mogą być takie same');
  await expect(save).toBeDisabled();

  await mon.getByLabel('Poniedziałek — początek').fill('18:00');
  await mon.getByLabel('Poniedziałek — koniec').fill('02:00');
  await expect(mon).toContainText('+1 dzień');
  await expect(mon).toContainText('8 h');

  await mon.getByLabel('Poniedziałek — początek').fill('09:00');
  await mon.getByLabel('Poniedziałek — koniec').fill('21:30');
  await expect(mon).toContainText('12,5 h');
  await save.click();
  await expect(page.getByRole('heading', { name: 'Ustawienia' })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: /Godziny domyślne/ }).click();
  await expect(page.getByTestId('hours-1').getByLabel('Poniedziałek — początek')).toHaveValue(
    '09:00',
  );
  await expect(page.getByTestId('hours-5').getByLabel('Piątek — koniec')).toHaveValue('23:00');
});

test('motyw i pierwszy dzień tygodnia zapisują się', async ({ page }) => {
  await onboard(page);
  await page.getByRole('button', { name: 'Ustawienia' }).click();

  await page.getByRole('radio', { name: 'Ciemny' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#tc-dark')).toHaveAttribute('content', '#000000');
  await page.getByRole('radio', { name: 'Nd' }).click();
  // stan segmentu pochodzi z bazy (liveQuery) — gdy jest zaznaczony, zapis jest zatwierdzony
  await expect(page.getByRole('radio', { name: 'Nd' })).toHaveAttribute('aria-checked', 'true');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('radio', { name: 'Nd' })).toHaveAttribute('aria-checked', 'true');

  await page.getByRole('radio', { name: 'Auto' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
  // przy tygodniu od niedzieli pierwszy w edytorze godzin jest Niedziela
  await page.getByRole('button', { name: /Godziny domyślne/ }).click();
  await expect(page.locator('[data-testid^=hours-]').first()).toHaveAttribute(
    'data-testid',
    'hours-0',
  );
});

test('kopia: eksport nie ma klucza, import odtwarza dane (zastąp)', async ({ page }) => {
  await onboard(page, 'Zofia');
  await page.getByRole('button', { name: 'Ustawienia' }).click();

  await page.getByRole('button', { name: 'Eksportuj kopię' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Kopia gotowa' })).toContainText('1 osoba');

  const backup = {
    app: 'grafik',
    schemaVersion: 1,
    exportedAt: '2026-11-03T10:00:00.000Z',
    persons: [
      {
        id: 'p1',
        firstName: 'Marta',
        color: 'green',
        aliases: [],
        isMe: true,
        archived: false,
        order: 0,
        createdAt: 1,
      },
      {
        id: 'p2',
        firstName: 'Łukasz',
        color: 'red',
        aliases: ['Lukasz'],
        isMe: false,
        archived: false,
        order: 1,
        createdAt: 2,
      },
    ],
    shifts: [],
    settings: {
      defaultHours: Object.fromEntries(
        [0, 1, 2, 3, 4, 5, 6].map((d) => [d, { start: '09:00', end: '20:00' }]),
      ),
      weekStartsOn: 0,
      geminiModel: 'gemini-flash-latest',
      aiPrivacyAcknowledged: false,
      theme: 'dark',
    },
  };
  await page.getByRole('button', { name: 'Zamknij' }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  await page.getByTestId('backup-file').setInputFiles({
    name: 'kopia.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByRole('alertdialog')).toContainText('2 osoby');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('button', { name: 'Zastąp wszystko' }).click();
  await expect(page.getByText(/Zaimportowano: 2 osoby/)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('button', { name: /Osoby/ }).click();
  await expect(page.getByText('Marta')).toBeVisible();
  await expect(page.getByText('Łukasz')).toBeVisible();
  await expect(page.getByText('Zofia')).toHaveCount(0);
});

test('kopia: uszkodzony plik pokazuje komunikat i nic nie zmienia', async ({ page }) => {
  await onboard(page, 'Zofia');
  await page.getByRole('button', { name: 'Ustawienia' }).click();
  await page.getByTestId('backup-file').setInputFiles({
    name: 'zly.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"nie":"kopia"}'),
  });
  await expect(page.getByText('To nie jest plik kopii aplikacji Grafik.')).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('brak poziomego przewijania na ekranach ustawień', async ({ page }) => {
  await onboard(page);
  for (const path of ['/settings', '/settings/people', '/settings/hours']) {
    await page.evaluate((p) => {
      history.pushState({}, '', p);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, path);
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow, path).toBe(false);
  }
});

for (const scheme of ['light', 'dark'] as const) {
  test(`zrzuty faza 4 — ${scheme}`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    const shot = (n: string) =>
      page.screenshot({ path: `docs/screens/faza4/${info.project.name}-${scheme}-${n}.png` });
    await page.getByRole('heading', { name: 'Witaj w Grafiku' }).waitFor();
    await shot('1-powitanie');
    await page.getByRole('button', { name: 'Dalej' }).click();
    await page.getByRole('textbox', { name: 'Imię' }).fill('Katarzyna');
    await shot('2-imie');
    await page.getByRole('button', { name: 'Dalej' }).click();
    await shot('3-godziny');
    await page.getByRole('button', { name: 'Gotowe' }).click();
    await page.getByRole('button', { name: 'Ustawienia' }).click();
    await page.waitForTimeout(400);
    await shot('4-ustawienia');
    await page.getByRole('button', { name: /Osoby/ }).click();
    await page.getByRole('button', { name: 'Dodaj osobę' }).click();
    await page.waitForTimeout(700);
    await shot('5-edytor-osoby');
  });
}
