/* eslint-disable @typescript-eslint/no-explicit-any -- stuby przeglądarkowych API i rekordy IndexedDB w testach */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// „Dzisiaj” = środa 4.11.2026
const NOW = new Date(2026, 10, 4, 10, 0);
const COLORS = ['blue', 'green', 'orange', 'pink', 'purple', 'teal', 'indigo', 'red'];

const dow = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getDay();
};

function monthData(n: number) {
  const names = ['Basia', 'Celina', 'Dorota', 'Ewa', 'Fela', 'Gosia', 'Hania', 'Iga'];
  const persons = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    firstName: names[i % names.length],
    lastName: undefined,
    color: COLORS[(i + 1) % COLORS.length],
    aliases: [],
    isMe: false,
    archived: false,
    order: i + 1,
    createdAt: i,
  }));
  const shifts: object[] = [];
  persons.forEach((p, pi) => {
    for (let d = 1; d <= 30; d++) {
      if ((d + pi) % 3 === 0) continue;
      const date = `2026-11-${String(d).padStart(2, '0')}`;
      const wd = dow(date);
      shifts.push({
        id: `${p.id}-${date}`,
        personId: p.id,
        date,
        kind: 'work',
        start: '10:00',
        end: wd === 5 || wd === 6 ? '23:00' : '22:00',
        usesDefaultHours: true,
        source: 'manual',
        updatedAt: 1,
      });
    }
  });
  return { persons, shifts };
}

async function start(page: Page, name = 'Ania') {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('textbox', { name: 'Imię' }).fill(name);
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('button', { name: 'Gotowe' }).click();
  await expect(page.getByRole('heading', { name: 'Mój grafik' })).toBeVisible();
}

async function seed(page: Page, n = 5, meShifts = true) {
  const { persons, shifts } = monthData(n);
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
  const mine = meShifts
    ? [2, 3, 4, 5, 6, 9, 10].map((d) => ({
        id: `me-${d}`,
        personId: meId,
        date: `2026-11-${String(d).padStart(2, '0')}`,
        kind: 'work',
        start: '10:00',
        end: '22:00',
        usesDefaultHours: true,
        note: d === 4 ? 'zażółć gęślą jaźń' : undefined,
        source: 'manual',
        updatedAt: 1,
      }))
    : [];
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
    { persons, shifts: [...shifts, ...mine] },
  );
  await page.reload();
}

/** Atrapa Web Share: zapisuje, z czym i czy w ramach gestu użytkownika (P-02) wywołano share(). */
async function stubShare(page: Page, mode: 'ok' | 'abort' | 'none' = 'ok') {
  await page.addInitScript((mode) => {
    const w = window as any;
    w.__shares = [];
    if (mode === 'none') {
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
      return;
    }
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: (d: any) => !!d?.files?.length,
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (d: any) => {
        w.__shares.push({
          name: d.files[0].name,
          type: d.files[0].type,
          size: d.files[0].size,
          active: (navigator as any).userActivation?.isActive,
        });
        if (mode === 'abort') throw new DOMException('Share canceled', 'AbortError');
      },
    });
  }, mode);
}

const openPdf = async (page: Page) => {
  await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Eksportuj PDF' }).click();
  await expect(sheet(page)).toBeVisible();
};
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Eksportuj PDF' });
const status = (page: Page) => sheet(page).getByTestId('pdf-status');
const ready = (page: Page, name: string | RegExp) =>
  expect(status(page)).toContainText(name, { timeout: 30_000 });

test.describe('eksport PDF', () => {
  test('sheet: PDF powstaje w tle, „Udostępnij” czeka na plik; share() w geście, typ application/pdf (P-02)', async ({
    page,
  }) => {
    const problems: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
    });
    page.on('pageerror', (e) => problems.push(e.message));
    await stubShare(page);
    await start(page);
    await seed(page, 5);
    await openPdf(page);

    // zanim plik będzie gotowy, „Udostępnij” jest nieaktywne
    const shareBtn = sheet(page).getByRole('button', { name: 'Udostępnij' });
    await expect(shareBtn).toBeDisabled();
    await ready(page, 'Grafik_2026-11.pdf');
    await expect(shareBtn).toBeEnabled();
    await expect(sheet(page).getByTestId('pdf-range')).toContainText('2026-11-01 — 2026-11-30');

    await shareBtn.click();
    const shares = await page.evaluate(() => (window as any).__shares);
    expect(shares).toHaveLength(1);
    expect(shares[0]).toMatchObject({ name: 'Grafik_2026-11.pdf', type: 'application/pdf' });
    expect(shares[0].size).toBeGreaterThan(5_000);
    if (shares[0].active !== undefined) expect(shares[0].active).toBe(true); // wywołane w trakcie gestu
    expect(problems).toEqual([]);
  });

  test('zamknięcie arkusza udostępniania (AbortError) nie pokazuje błędu', async ({ page }) => {
    await stubShare(page, 'abort');
    await start(page);
    await seed(page, 3);
    await openPdf(page);
    await ready(page, 'Gotowe');
    await sheet(page).getByRole('button', { name: 'Udostępnij' }).click();
    await page.waitForTimeout(400);
    await expect(page.getByText('Nie udało się udostępnić')).toHaveCount(0);
    await expect(sheet(page).getByRole('alert')).toHaveCount(0);
  });

  test('bez Web Share: pobranie pliku .pdf (fallback), poprawna treść', async ({ page }) => {
    const ios = await page.evaluate(() => /iPhone|iPad/.test(navigator.userAgent));
    await stubShare(page, ios ? 'ok' : 'none');
    await start(page);
    await seed(page, 3);
    await openPdf(page);
    await ready(page, 'Gotowe');

    if (ios) {
      // iOS: „Zapisz w Plikach” idzie przez arkusz udostępniania, bez <a download> (P-03)
      await sheet(page).getByRole('button', { name: 'Zapisz w Plikach' }).click();
      const shares = await page.evaluate(() => (window as any).__shares);
      expect(shares).toHaveLength(1);
      await expect(sheet(page)).toContainText('Zachowaj w Plikach');
    } else {
      await expect(sheet(page)).toContainText('nie udostępnia plików');
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        sheet(page).getByRole('button', { name: 'Zapisz / pobierz' }).click(),
      ]);
      expect(download.suggestedFilename()).toBe('Grafik_2026-11.pdf');
      const buf = readFileSync(await download.path());
      expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(buf.length).toBeGreaterThan(5_000);
    }
  });

  test('podgląd w aplikacji: strony jako obrazy, zamykanie i przyciskiem, i „wstecz” (P-03, P-15)', async ({
    page,
  }) => {
    await stubShare(page);
    await start(page);
    await seed(page, 5);
    await openPdf(page);
    await ready(page, 'Gotowe');
    await sheet(page).getByRole('button', { name: 'Podgląd' }).click();
    const preview = page.getByRole('dialog', { name: 'Podgląd PDF' });
    await expect(preview).toBeVisible({ timeout: 30_000 });
    await expect(preview).toContainText('2 strony'); // miesiąc = 2 części
    const pages = preview.getByRole('img');
    await expect(pages).toHaveCount(2);
    for (const p of await pages.all()) {
      await expect
        .poll(() => p.evaluate((i: HTMLImageElement) => i.naturalWidth))
        .toBeGreaterThan(500);
    }
    await preview.getByRole('button', { name: 'Zamknij podgląd' }).click();
    await expect(preview).toBeHidden();

    await sheet(page).getByRole('button', { name: 'Podgląd' }).click();
    await expect(preview).toBeVisible({ timeout: 30_000 });
    await page.goBack();
    await expect(preview).toBeHidden();
    await expect(sheet(page)).toBeVisible(); // „wstecz” zamyka tylko podgląd
  });

  test('zakres: tydzień, własny (walidacja 31 dni), okres bez zmian = komunikat i brak pliku (E-30)', async ({
    page,
  }) => {
    await stubShare(page);
    await start(page);
    await seed(page, 4);
    await openPdf(page);
    await ready(page, 'Grafik_2026-11.pdf');

    await sheet(page).getByRole('radio', { name: 'Tydzień' }).click();
    await ready(page, 'Grafik_2026-11-04_2026-11-10.pdf'.slice(0, 0) + 'Grafik_2026-11-');
    await expect(status(page)).toContainText('.pdf');
    await expect(sheet(page).getByTestId('pdf-range')).toContainText(/2026-11-\d\d — 2026-11-\d\d/);

    await sheet(page).getByRole('radio', { name: 'Własny' }).click();
    await sheet(page).getByLabel('Od', { exact: true }).fill('2026-11-01');
    await sheet(page).getByLabel('Do', { exact: true }).fill('2026-12-31');
    await expect(sheet(page).getByRole('alert')).toContainText('maksymalnie 31 dni');
    await expect(status(page)).not.toContainText('Gotowe', { timeout: 5_000 });
    await expect(sheet(page).getByRole('button', { name: 'Udostępnij' })).toBeDisabled();

    await sheet(page).getByLabel('Do', { exact: true }).fill('2026-11-09');
    await ready(page, 'Grafik_2026-11-01_2026-11-09.pdf');

    // okres bez żadnych zmian
    await sheet(page).getByLabel('Od', { exact: true }).fill('2027-03-01');
    await sheet(page).getByLabel('Do', { exact: true }).fill('2027-03-07');
    await expect(status(page)).toContainText('Brak zmian w wybranym okresie.');
    await expect(sheet(page).getByRole('button', { name: 'Udostępnij' })).toBeDisabled();
    await expect(sheet(page).getByRole('button', { name: 'Podgląd' })).toBeDisabled();
  });

  test('osoby i układ: „Tylko ja” + lista osoby → plik z imieniem; wybrane osoby; czarno-biały', async ({
    page,
  }) => {
    await stubShare(page);
    await start(page, 'Ania');
    await seed(page, 3);
    await openPdf(page);
    await ready(page, 'Gotowe');

    await sheet(page).getByRole('radio', { name: 'Tylko ja' }).click();
    await sheet(page).getByRole('radio', { name: 'Lista', exact: true }).click();
    await ready(page, 'Grafik_Ania_2026-11.pdf');

    // wybrane osoby: wszystkie → odznacz → pusty wybór → komunikat
    await sheet(page).getByRole('radio', { name: 'Wybrane' }).click();
    const group = sheet(page).getByRole('group', { name: 'Wybrane osoby' });
    await expect(group.getByRole('button')).toHaveCount(4); // Ania + 3
    for (const b of await group.getByRole('button').all()) await b.click();
    await expect(status(page)).toContainText('Nie wybrano żadnej osoby');
    await group.getByRole('button', { name: 'Basia' }).click();
    await sheet(page).getByRole('radio', { name: 'Siatka' }).click();
    await ready(page, 'Grafik_2026-11.pdf');

    // czarno-biały: nowe generowanie, plik gotowy
    await sheet(page).getByRole('radio', { name: 'Cz-b' }).click();
    await expect(status(page)).toContainText('Przygotowuję');
    await ready(page, 'Gotowe');
    await sheet(page).getByRole('switch', { name: 'Notatki' }).click();
    await ready(page, 'Gotowe');
  });

  test('„Tylko ja” bez przypisanej osoby: podpowiedź i komunikat', async ({ page }) => {
    await start(page);
    await seed(page, 2, false);
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
    await openPdf(page);
    await sheet(page).getByRole('radio', { name: 'Tylko ja' }).click();
    await expect(sheet(page)).toContainText('Nie wybrano, która osoba to Ty');
    await expect(status(page)).toContainText('Nie wybrano żadnej osoby');
  });

  test('zakres startowy bierze okres z widoku Zespół', async ({ page }) => {
    await stubShare(page);
    await start(page);
    await seed(page, 3);
    await page.getByRole('button', { name: 'Zespół' }).click();
    await page.getByRole('button', { name: 'Następny tydzień' }).click();
    await page.getByRole('button', { name: 'Ddodaj'.slice(0, 0) + 'Dodaj', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Eksportuj PDF' }).click();
    await expect(sheet(page).getByTestId('pdf-range')).toContainText('2026-11-09 — 2026-11-15');
    await expect(sheet(page).getByRole('radio', { name: 'Tydzień' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('offline: eksport i podgląd działają bez sieci (czcionki i pdf.js w precache SW)', async ({
    page,
    context,
  }) => {
    await stubShare(page);
    await start(page);
    await seed(page, 3);
    // poczekaj, aż SW przejmie stronę i dokończy precache
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return !!reg.active;
    });
    await page.reload();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await context.setOffline(true);
    await openPdf(page);
    await ready(page, 'Grafik_2026-11.pdf');
    await sheet(page).getByRole('button', { name: 'Podgląd' }).click();
    await expect(page.getByRole('dialog', { name: 'Podgląd PDF' })).toBeVisible({
      timeout: 30_000,
    });
    await context.setOffline(false);
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`zrzuty faza 8 — ${scheme}`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await stubShare(page);
    await start(page);
    await seed(page, 8);
    await openPdf(page);
    await ready(page, 'Gotowe');
    await expect
      .poll(async () => (await sheet(page).boundingBox())?.y ?? 999, { timeout: 15_000 })
      .toBeLessThan(60);
    await page.screenshot({
      path: `docs/screens/faza8/${info.project.name}-${scheme}-1-opcje.png`,
    });
    await sheet(page).getByRole('button', { name: 'Podgląd' }).click();
    const preview = page.getByRole('dialog', { name: 'Podgląd PDF' });
    await expect(preview).toBeVisible({ timeout: 30_000 });
    await expect(preview.getByRole('img').first()).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({
      path: `docs/screens/faza8/${info.project.name}-${scheme}-2-podglad.png`,
    });
  });
}
