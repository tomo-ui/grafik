/* eslint-disable @typescript-eslint/no-explicit-any -- ciała zapytań i rekordy IndexedDB w testach są dowolnym JSON-em */
import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import sharp from 'sharp';

// „Dzisiaj” = środa 4.11.2026
const NOW = new Date(2026, 10, 4, 10, 0);

// page.route() nie przechwytuje żądań obsługiwanych przez Service Worker — blokujemy SW w tych testach
test.use({ serviceWorkers: 'block' });
const KEY = 'AIzaSy-TESTOWY-KLUCZ-123';

const api = (name: string) =>
  readFileSync(`tests/fixtures/gemini-responses/api-${name}.json`, 'utf8');

const png = (width = 800, height = 600) =>
  sharp({ create: { width, height, channels: 3, background: { r: 245, g: 245, b: 245 } } })
    .png()
    .toBuffer();

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};

interface Call {
  url: string;
  method: string;
  key: string | undefined;
  body: any;
}

/** Mock Gemini: kolejne odpowiedzi z kolejki; ostatnia powtarza się. Preflight CORS obsłużony. */
async function mockGemini(page: Page, responses: ((r: Route) => Promise<void> | void)[] | string) {
  const calls: Call[] = [];
  const queue = typeof responses === 'string' ? [okResponse(responses)] : [...responses];
  await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    calls.push({
      url: req.url(),
      method: req.method(),
      key: req.headers()['x-goog-api-key'],
      body: req.postData() ? JSON.parse(req.postData()!) : undefined,
    });
    const handler = queue.length > 1 ? queue.shift()! : queue[0]!;
    await handler(route);
  });
  return calls;
}

const okResponse = (name: string) => (route: Route) =>
  route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: api(name) });
const failResponse = (status: number, body: unknown) => (route: Route) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: CORS,
    body: JSON.stringify(body),
  });

async function start(page: Page) {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('textbox', { name: 'Imię' }).fill('Ania');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('button', { name: 'Gotowe' }).click();
  await expect(page.getByRole('heading', { name: 'Mój grafik' })).toBeVisible();
}

/** Zapis wprost do IndexedDB + przeładowanie. */
async function seed(
  page: Page,
  o: { settings?: Record<string, unknown>; persons?: object[]; shifts?: object[] } = {},
) {
  await page.evaluate(
    (o) =>
      new Promise<void>((res, rej) => {
        const open = indexedDB.open('grafik');
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['persons', 'shifts', 'settings'], 'readwrite');
          (o.persons ?? []).forEach((p) => tx.objectStore('persons').put(p));
          (o.shifts ?? []).forEach((s) => tx.objectStore('shifts').put(s));
          if (o.settings) {
            const store = tx.objectStore('settings');
            const g = store.get('app');
            g.onsuccess = () => store.put({ ...g.result, ...o.settings, id: 'app' });
          }
          tx.oncomplete = () => {
            db.close();
            res();
          };
          tx.onerror = () => rej(tx.error);
        };
      }),
    o,
  );
  await page.reload();
}

const person = (
  id: string,
  firstName: string,
  lastName: string,
  aliases: string[],
  order: number,
) => ({
  id,
  firstName,
  lastName,
  color: 'blue',
  aliases,
  isMe: false,
  archived: false,
  order,
  createdAt: order,
});
const PEOPLE = [
  person('k', 'Katarzyna', 'Nowak', ['Kasia'], 1),
  person('b', 'Barbara', 'Wiśniewska', ['Basia'], 2),
];

const readAll = (page: Page, store: 'shifts' | 'persons' | 'importBatches' | 'scanDrafts') =>
  page.evaluate(
    (store) =>
      new Promise<any[]>((res) => {
        const open = indexedDB.open('grafik');
        open.onsuccess = () => {
          const all = open.result.transaction(store).objectStore(store).getAll();
          all.onsuccess = () => res(all.result);
        };
      }),
    store,
  );
const activeShifts = async (page: Page) =>
  (await readAll(page, 'shifts')).filter((s: { deletedAt?: number }) => !s.deletedAt);

const sheet = (page: Page) => page.getByRole('dialog', { name: 'Skanuj grafik' });
const review = (page: Page) => page.getByRole('dialog', { name: 'Weryfikacja importu' });
const toast = (page: Page, text: string | RegExp) =>
  page.getByRole('status').filter({ hasText: text });

async function openScan(page: Page) {
  await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Skanuj grafik' }).click();
  await expect(sheet(page)).toBeVisible();
}

async function pickFile(page: Page, buffer?: Buffer, name = 'grafik.png', mimeType = 'image/png') {
  await page.getByTestId('input-library').setInputFiles({
    name,
    mimeType,
    buffer: buffer ?? (await png()),
  });
}

/** Cały przepływ do ekranu weryfikacji. */
async function scanToReview(page: Page, privacy = false) {
  await openScan(page);
  await pickFile(page);
  await expect(page.getByRole('img', { name: 'Podgląd zdjęcia grafiku' })).toBeVisible();
  await sheet(page).getByRole('button', { name: 'Analizuj' }).click();
  if (privacy) {
    await page
      .getByRole('alertdialog', { name: 'Prywatność darmowego API' })
      .getByRole('button', { name: 'Rozumiem, kontynuuj' })
      .click();
  }
  await expect(review(page)).toBeVisible();
}

test.describe('skanowanie AI', () => {
  test('pełny przepływ: aparat/biblioteka → Analizuj → weryfikacja → import → Cofnij', async ({
    page,
  }) => {
    const problems: string[] = [];
    page.on('console', (m) => {
      // blokada SW to artefakt testu (żądania Gemini muszą dać się przechwycić)
      if (/Service Worker registration blocked/.test(m.text())) return;
      if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
    });
    page.on('pageerror', (e) => problems.push(e.message));

    const calls = await mockGemini(page, 'standard');
    await start(page);
    await seed(page, {
      persons: PEOPLE,
      settings: { geminiApiKey: KEY, aiPrivacyAcknowledged: false },
    });

    // źródła zdjęcia: aparat z capture, biblioteka wielokrotna
    await openScan(page);
    await expect(page.getByTestId('input-camera')).toHaveAttribute('capture', 'environment');
    await expect(page.getByTestId('input-library')).toHaveAttribute('multiple', '');
    await pickFile(page);
    await expect(page.getByRole('img', { name: 'Podgląd zdjęcia grafiku' })).toBeVisible();
    await sheet(page).getByRole('button', { name: 'Analizuj' }).click();

    // jednorazowa informacja o prywatności przed pierwszym skanem
    const privacy = page.getByRole('alertdialog', { name: 'Prywatność darmowego API' });
    await expect(privacy).toContainText('ulepszania modeli');
    await privacy.getByRole('button', { name: 'Rozumiem, kontynuuj' }).click();
    await expect(review(page)).toBeVisible();

    // zapytanie: klucz w nagłówku, nie w URL/body; obraz i prompt z kontekstem
    expect(calls).toHaveLength(1);
    expect(calls[0]!.key).toBe(KEY);
    expect(calls[0]!.url).not.toContain(KEY);
    expect(JSON.stringify(calls[0]!.body)).not.toContain(KEY);
    expect(calls[0]!.url).toContain('/models/gemini-flash-latest:generateContent');
    const parts = calls[0]!.body.contents[0].parts;
    expect(parts[0].text).toContain('Today is 2026-11-04');
    expect(parts[0].text).toContain('Katarzyna Nowak: Kasia');
    expect(parts[1].inline_data.mime_type).toBe('image/jpeg');
    expect(calls[0]!.body.generationConfig.temperature).toBe(0);

    // osoby: Kasia i Basia dopasowane przez aliasy, Łukasz nierozpoznany → blokuje import
    await expect(page.getByTestId('person-r0')).toContainText('→ Katarzyna Nowak ✓');
    await expect(page.getByTestId('person-r1')).toContainText('→ Barbara Wiśniewska ✓');
    await expect(page.getByTestId('person-r2')).toContainText('Nie rozpoznano');
    const importBtn = review(page).getByRole('button', { name: /^Importuj|Brak zmian/ });
    await expect(importBtn).toBeDisabled();
    await expect(review(page)).toContainText('Rozstrzygnij osoby: Łukasz');

    // wybór: nowa osoba
    await page.getByTestId('person-r2').click();
    await page
      .getByRole('dialog', { name: /Kto to/ })
      .getByText('Nowa osoba')
      .click();
    await expect(page.getByTestId('person-r2')).toContainText('Nowa osoba: Łukasz');
    await expect(importBtn).toHaveText('Importuj 13 zmian');
    await expect(importBtn).toBeEnabled();

    // dni: piątek 10–23 domyślnie
    const kasiaDays = page.getByTestId('days-r0').getByTestId('day-cell');
    await expect(kasiaDays).toHaveCount(5);
    await expect(kasiaDays.nth(4)).toContainText('10–23');
    await expect(kasiaDays.nth(0)).toContainText('10–22');

    // poprawka komórki: poniedziałek Kasi na 12:00–18:00
    await kasiaDays.nth(0).click();
    const edit = page.getByRole('dialog', { name: 'Popraw wpis' });
    await edit.getByRole('switch', { name: 'Domyślne wg dnia' }).click();
    await edit.getByLabel('Początek zmiany').fill('12:00');
    await edit.getByLabel('Koniec zmiany').fill('18:00');
    await edit.getByRole('button', { name: 'Gotowe' }).click();
    await expect(kasiaDays.nth(0)).toContainText('12–18');

    await importBtn.dblclick(); // podwójne tapnięcie = jeden import
    await expect(toast(page, 'Zaimportowano 13 zmian')).toBeVisible();
    await expect(review(page)).toBeHidden();

    const shifts = await activeShifts(page);
    expect(shifts).toHaveLength(13);
    expect(shifts.every((s) => s.source === 'ai' && s.importBatchId)).toBe(true);
    const mon = shifts.find((s) => s.personId === 'k' && s.date === '2026-11-02')!;
    expect([mon.start, mon.end, mon.usesDefaultHours]).toEqual(['12:00', '18:00', false]);
    const fri = shifts.find((s) => s.personId === 'k' && s.date === '2026-11-06')!;
    expect([fri.start, fri.end, fri.usesDefaultHours]).toEqual(['10:00', '23:00', true]);
    expect((await readAll(page, 'persons')).some((p) => p.firstName === 'Łukasz')).toBe(true);
    expect(await readAll(page, 'scanDrafts')).toHaveLength(0);
    const batches = await readAll(page, 'importBatches');
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ model: 'gemini-flash-latest', promptVersion: '1' });

    // po imporcie widok Zespół na zaimportowanym okresie
    await expect(page.getByRole('heading', { name: 'Zespół' })).toBeVisible();
    await expect(page.getByTestId('period-label')).toHaveText('listopad 2026');

    // Cofnij import z toastu
    await toast(page, 'Zaimportowano').getByRole('button', { name: 'Cofnij' }).click();
    await expect.poll(async () => (await activeShifts(page)).length).toBe(0);
    expect(problems).toEqual([]);
  });

  test('bez klucza: instrukcja konfiguracji zamiast analizy (E-17)', async ({ page }) => {
    await start(page);
    await openScan(page);
    await expect(sheet(page)).toContainText('Skonfiguruj skanowanie AI');
    await pickFile(page);
    await expect(sheet(page).getByRole('button', { name: 'Analizuj' })).toBeDisabled();
    await sheet(page).getByRole('button', { name: 'Przejdź do ustawień' }).click();
    await expect(page.getByRole('heading', { name: 'Skanowanie AI', exact: true })).toBeVisible();
  });

  test('obrót i kadr trafiają do wysyłanego obrazu; dłuższy bok ≤ 2048', async ({ page }) => {
    const calls = await mockGemini(page, 'standard');
    await start(page);
    await seed(page, {
      persons: PEOPLE,
      settings: { geminiApiKey: KEY, aiPrivacyAcknowledged: true },
    });
    await openScan(page);
    await pickFile(page, await png(3000, 1500)); // 2:1, większy niż 2048
    await sheet(page).getByRole('button', { name: 'Obróć' }).click(); // → 1500×3000
    await sheet(page).getByRole('button', { name: 'Kadruj' }).click();
    const box = (await page.getByTestId('preview-box').boundingBox())!;
    const br = page.getByTestId('crop-br');
    const b = (await br.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 8 });
    await page.mouse.up();
    await sheet(page).getByRole('button', { name: 'Analizuj' }).click();
    await expect(review(page)).toBeVisible();

    const data = Buffer.from(calls[0]!.body.contents[0].parts[1].inline_data.data, 'base64');
    const meta = await sharp(data).metadata();
    // po obrocie 1500×3000, kadr ~50% × ~50% → ok. 750×1500; dłuższy bok < 2048
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(2048);
    expect(meta.height!).toBeGreaterThan(meta.width!); // pion po obrocie
    expect(meta.width!).toBeLessThan(1000); // kadr zmniejszył szerokość
    expect(meta.format).toBe('jpeg');
  });

  test('duże zdjęcie PNG (P-21) i limit 40 MP; zły format; limit 4 stron', async ({ page }) => {
    await start(page);
    await seed(page, { settings: { geminiApiKey: KEY } });
    await openScan(page);

    // > 40 MP → komunikat
    await pickFile(page, await png(9000, 5000));
    await expect(sheet(page)).toContainText('40 megapikseli');

    // plik nie-graficzny
    await sheet(page)
      .getByTestId('input-library')
      .setInputFiles({
        name: 'a.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('tekst'),
      });
    await expect(sheet(page)).toContainText('To nie jest zdjęcie');

    // „HEIC” bez możliwości dekodowania (P-22)
    await pickFile(page, Buffer.from('nie-obraz'), 'IMG_1.heic', 'image/heic');
    await expect(sheet(page)).toContainText('zapisz jako JPG');

    // duży, ale dozwolony PNG (35 MP) — dekodowany ze skalowaniem, bez zawieszenia
    await pickFile(page, await png(7000, 5000));
    await expect(page.getByRole('img', { name: 'Podgląd zdjęcia grafiku' })).toBeVisible({
      timeout: 20_000,
    });

    // limit 4 stron
    for (let i = 0; i < 3; i++) {
      await sheet(page).getByRole('button', { name: 'Dodaj kolejną stronę' }).first().click();
      await expect(sheet(page)).toContainText('Dodajesz kolejną stronę');
      await pickFile(page, await png(400, 300));
      await expect(sheet(page).getByRole('tab')).toHaveCount(i + 2);
    }
    await expect(
      sheet(page).getByRole('button', { name: 'Dodaj kolejną stronę', exact: true }),
    ).toHaveCount(0);
  });

  test('schowek: obraz, tekst zamiast zdjęcia, odmowa (E-14, E-15); pole „przytrzymaj i wklej”', async ({
    page,
  }) => {
    await start(page);
    await seed(page, { settings: { geminiApiKey: KEY } });
    const ua = await page.evaluate(() => navigator.userAgent);
    const ios = /iPhone|iPad/.test(ua);
    const bytes = [...(await png(300, 200))];

    // stub navigator.clipboard.read — tryb sterowany z testu
    await page.evaluate((bytes) => {
      const w = window as unknown as { __clip: string };
      w.__clip = 'image';
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          read: async () => {
            if (w.__clip === 'denied') throw new DOMException('denied', 'NotAllowedError');
            if (w.__clip === 'text')
              return [{ types: ['text/plain'], getType: async () => new Blob(['https://x']) }];
            return [
              {
                types: ['text/plain', 'image/png'],
                getType: async () => new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
              },
            ];
          },
        },
      });
    }, bytes);

    await openScan(page);
    const paste = sheet(page).getByRole('button', { name: 'Wklej ze schowka' });

    await page.evaluate(() => ((window as unknown as { __clip: string }).__clip = 'text'));
    await paste.click();
    await expect(sheet(page)).toContainText('W schowku nie ma zdjęcia');

    await page.evaluate(() => ((window as unknown as { __clip: string }).__clip = 'denied'));
    await paste.click();
    if (ios) {
      // iOS: zignorowany dymek „Wklej” — bez komunikatu błędu
      await expect(sheet(page)).not.toContainText('Brak zgody');
    } else {
      await expect(sheet(page)).toContainText('Brak zgody na odczyt schowka');
    }
    await expect(sheet(page)).not.toContainText('Skanowanie nie powiodło się');

    // pole zapasowe: zdarzenie paste z plikiem
    await page.evaluate((bytes) => {
      const zone = document.querySelector('[data-paste-zone]')!;
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], 'schowek.png', { type: 'image/png' }));
      const ev = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'clipboardData', { value: dt });
      zone.dispatchEvent(ev);
    }, bytes);
    await expect(page.getByRole('img', { name: 'Podgląd zdjęcia grafiku' })).toBeVisible();
    await expect(sheet(page).getByRole('tab')).toHaveCount(1);

    // przycisk — obraz w schowku (stan obrazu przywrócony)
    await sheet(page).getByRole('button', { name: 'Usuń stronę 1' }).click();
    await page.evaluate(() => ((window as unknown as { __clip: string }).__clip = 'image'));
    await sheet(page).getByRole('button', { name: 'Wklej ze schowka' }).click();
    await expect(page.getByRole('img', { name: 'Podgląd zdjęcia grafiku' })).toBeVisible();
  });

  test('globalne wklejanie (Ctrl/Cmd+V) otwiera podgląd; wklejanie w polu tekstowym nie jest przechwytywane', async ({
    page,
  }) => {
    await start(page);
    const bytes = [...(await png(300, 200))];
    const fire = (target: string) =>
      page.evaluate(
        ({ bytes, target }) => {
          const el = target === 'body' ? document.body : document.querySelector(target)!;
          const dt = new DataTransfer();
          dt.items.add(new File([new Uint8Array(bytes)], 'v.png', { type: 'image/png' }));
          const ev = new Event('paste', { bubbles: true, cancelable: true });
          Object.defineProperty(ev, 'clipboardData', { value: dt });
          el.dispatchEvent(ev);
        },
        { bytes, target },
      );

    // w polu tekstowym (Ustawienia → Osoby → Dodaj) — ignorujemy
    await page.getByRole('button', { name: 'Ustawienia' }).click();
    await page.getByRole('button', { name: /Osoby/ }).click();
    await page.getByRole('button', { name: 'Dodaj osobę' }).click();
    await expect(page.getByRole('dialog', { name: 'Nowa osoba' })).toBeVisible();
    await fire('input[type=text]');
    await expect(sheet(page)).toHaveCount(0);
    await page.getByTestId('sheet-scrim').click({ position: { x: 10, y: 10 } });
    await page.getByRole('button', { name: 'Wróć' }).click();
    await page.getByRole('button', { name: 'Mój grafik' }).click();

    // na ekranie głównym — otwiera arkusz z podglądem
    await fire('body');
    await expect(sheet(page)).toBeVisible();
    await expect(page.getByRole('img', { name: 'Podgląd zdjęcia grafiku' })).toBeVisible();
  });

  test('błędy API mają polskie komunikaty; zdjęcie zostaje do ponowienia (P-25)', async ({
    page,
  }) => {
    await start(page);
    await seed(page, {
      persons: PEOPLE,
      settings: { geminiApiKey: KEY, aiPrivacyAcknowledged: true },
    });
    await mockGemini(page, [
      failResponse(401, { error: { message: 'API key not valid' } }),
      failResponse(404, { error: { message: 'model not found' } }),
      failResponse(500, { error: { message: 'boom' } }),
      (r) => r.abort('failed'), // brak sieci
      (r) =>
        r.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS,
          body: JSON.stringify({ candidates: [] }),
        }),
      (r) =>
        r.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: CORS,
          body: JSON.stringify({ candidates: [{ content: { parts: [{ text: 'nie json' }] } }] }),
        }),
      okResponse('standard'),
    ]);

    await openScan(page);
    await pickFile(page);
    const analyze = () => sheet(page).getByRole('button', { name: /Analizuj|Ponów analizę/ });
    const alertText = (t: string | RegExp) =>
      expect(sheet(page).getByRole('alert')).toContainText(t);

    await analyze().click();
    await alertText('Klucz API jest nieprawidłowy');
    await expect(sheet(page).getByRole('button', { name: 'Otwórz ustawienia' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Podgląd zdjęcia grafiku' })).toBeVisible(); // zdjęcie zostaje

    await analyze().click();
    await alertText('Wybrany model nie istnieje');
    await analyze().click();
    await alertText('Usługa Gemini jest chwilowo niedostępna');
    await analyze().click();
    await alertText('Brak połączenia z internetem');
    await analyze().click();
    await alertText('wyraźniejszego zdjęcia');
    await analyze().click();
    await alertText('Odpowiedź AI była uszkodzona');
    await expect(sheet(page).getByRole('tab')).toHaveCount(1);

    await analyze().click(); // wreszcie sukces — bez ponownego wyboru zdjęcia
    await expect(review(page)).toBeVisible();
  });

  test('429 z retryDelay: odliczanie i automatyczne ponowienie (E-18)', async ({ page }) => {
    await start(page);
    await seed(page, {
      persons: PEOPLE,
      settings: { geminiApiKey: KEY, aiPrivacyAcknowledged: true },
    });
    const calls = await mockGemini(page, [
      failResponse(429, {
        error: {
          status: 'RESOURCE_EXHAUSTED',
          details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '2s' }],
        },
      }),
      okResponse('standard'),
    ]);
    await openScan(page);
    await pickFile(page);
    await sheet(page).getByRole('button', { name: 'Analizuj' }).click();
    await expect(sheet(page)).toContainText('Limit darmowego API — ponawiam za');
    await expect(review(page)).toBeVisible({ timeout: 15_000 });
    expect(calls).toHaveLength(2);
  });

  test('anulowanie analizy wraca do podglądu', async ({ page }) => {
    await start(page);
    await seed(page, {
      persons: PEOPLE,
      settings: { geminiApiKey: KEY, aiPrivacyAcknowledged: true },
    });
    await mockGemini(page, [() => new Promise<void>(() => {})]); // zapytanie wisi
    await openScan(page);
    await pickFile(page);
    await sheet(page).getByRole('button', { name: 'Analizuj' }).click();
    await expect(sheet(page)).toContainText('Analizuję zdjęcie');
    await sheet(page).getByRole('button', { name: 'Anuluj' }).click();
    await expect(page.getByRole('img', { name: 'Podgląd zdjęcia grafiku' })).toBeVisible();
    await expect(sheet(page).getByRole('button', { name: 'Analizuj' })).toBeEnabled();
  });

  test('offline: analiza zablokowana z komunikatem „Brak połączenia” (S-20)', async ({
    page,
    context,
  }) => {
    await start(page);
    await seed(page, { settings: { geminiApiKey: KEY } });
    await openScan(page);
    await pickFile(page);
    await context.setOffline(true);
    await expect(sheet(page)).toContainText('Brak połączenia');
    await expect(sheet(page).getByRole('button', { name: 'Analizuj' })).toBeDisabled();
    await context.setOffline(false);
    await expect(sheet(page).getByRole('button', { name: 'Analizuj' })).toBeEnabled();
  });

  test('weryfikacja: niska pewność, ostrzeżenia, sprzeczne strony wymagają wyboru', async ({
    page,
  }) => {
    await start(page);
    await seed(page, {
      persons: PEOPLE,
      settings: { geminiApiKey: KEY, aiPrivacyAcknowledged: true },
    });

    // 1) przekreślenia: niska pewność żółta + ostrzeżenie modelu
    await mockGemini(page, 'strike');
    await scanToReview(page);
    const cells = page.getByTestId('days-r0').getByTestId('day-cell');
    await expect(cells.nth(0)).not.toHaveClass(/dayLow/);
    await expect(cells.nth(1)).toHaveClass(/dayLow/);
    await expect(cells.nth(2)).toHaveClass(/dayLow/);
    await expect(cells.nth(1)).toHaveAttribute('aria-label', /niska pewność/);
    await expect(page.getByTestId('warnings')).toContainText('była przekreślona');
    // tap w komórkę → edycja; usunięcie wpisu zmniejsza liczbę importowanych zmian
    const importBtn = review(page).getByRole('button', { name: /^Importuj/ });
    await expect(importBtn).toHaveText('Importuj 3 zmiany');
    await cells.nth(1).click();
    await page
      .getByRole('dialog', { name: 'Popraw wpis' })
      .getByRole('button', { name: 'Usuń wpis' })
      .click();
    await expect(importBtn).toHaveText('Importuj 2 zmiany');
    await review(page).getByRole('button', { name: 'Anuluj' }).click();
    await page
      .getByRole('alertdialog', { name: 'Odrzucić wynik skanowania?' })
      .getByRole('button', { name: 'Odrzuć' })
      .click();
    await expect(review(page)).toBeHidden();
    expect(await readAll(page, 'scanDrafts')).toHaveLength(0);

    // 2) dwie strony: sprzeczny dzień blokuje import do wyboru strony
    await page.unroute('https://generativelanguage.googleapis.com/**');
    await mockGemini(page, 'twoPages');
    await scanToReview(page);
    await expect(page.getByTestId('entry-conflict')).toContainText('sprzeczne wpisy');
    const imp = review(page).getByRole('button', { name: /^Importuj/ });
    await expect(imp).toBeDisabled();
    await expect(review(page)).toContainText('Wybierz właściwy wpis');
    await review(page).getByRole('radio', { name: 'Strona 2' }).click();
    await expect(imp).toBeEnabled();
    await expect(imp).toHaveText('Importuj 3 zmiany');
  });

  test('podpowiedź rozmyta wymaga potwierdzenia; aliasy zapamiętane dla kolejnych importów', async ({
    page,
  }) => {
    await start(page);
    await seed(page, {
      persons: PEOPLE,
      settings: { geminiApiKey: KEY, aiPrivacyAcknowledged: true },
    });
    const parsed = {
      period: { month: 11, year: 2026 },
      legend: [],
      warnings: [],
      people: [
        {
          nameAsWritten: 'Kazia',
          entries: [
            { date: '2026-11-02', weekday: 'Pn', rawCell: 'X', kind: 'work', confidence: 0.9 },
          ],
        },
      ],
    };
    const body = JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(parsed) }] } }],
    });
    await mockGemini(page, [
      (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body }),
    ]);
    await scanToReview(page);

    const imp = review(page).getByRole('button', { name: /^Importuj/ });
    await expect(page.getByTestId('person-r0')).toContainText('Czy to Katarzyna Nowak?');
    await expect(imp).toBeDisabled();
    await review(page)
      .getByRole('button', { name: /Potwierdź: Katarzyna Nowak/ })
      .click();
    await expect(imp).toBeEnabled();
    await imp.click();
    await expect(toast(page, 'Zaimportowano 1 zmiana')).toBeVisible();

    const k = (await readAll(page, 'persons')).find((p) => p.id === 'k');
    expect(k.aliases).toEqual(['Kasia', 'Kazia']); // alias zapisany po wyborze istniejącej osoby

    // kolejny import tego samego zapisu → dopasowanie automatyczne
    await scanToReview(page);
    await expect(page.getByTestId('person-r0')).toContainText('→ Katarzyna Nowak ✓');
  });

  test('kolizje z istniejącymi zmianami: tryby Zastąp/Pomiń/Pytaj, wycofanie przywraca zastąpione (E-24)', async ({
    page,
  }) => {
    await start(page);
    const old = (date: string) => ({
      id: `old-${date}`,
      personId: 'k',
      date,
      kind: 'work',
      start: '08:00',
      end: '14:00',
      usesDefaultHours: false,
      source: 'manual',
      updatedAt: 1,
    });
    await seed(page, {
      persons: PEOPLE,
      shifts: [old('2026-11-02'), old('2026-11-03')],
      settings: { geminiApiKey: KEY, aiPrivacyAcknowledged: true },
    });
    await mockGemini(page, 'standard');
    await scanToReview(page);
    // Łukasz → pomiń
    await page.getByTestId('person-r2').click();
    await page
      .getByRole('dialog', { name: /Kto to/ })
      .getByText('Pomiń tę osobę')
      .click();

    await expect(review(page)).toContainText('2 kolizje');
    const seg = review(page).getByRole('radiogroup', { name: 'Rozwiązywanie kolizji' });
    await seg.getByRole('radio', { name: 'Pytaj' }).click();
    const rows = page.getByTestId('conflict-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('jest 08:00–14:00');
    // domyślnie „Pomiń”; pierwszą kolizję zastępujemy
    await rows.first().getByRole('radio', { name: 'Zastąp' }).click();
    const imp = review(page).getByRole('button', { name: /^Importuj/ });
    await expect(imp).toHaveText('Importuj 8 zmian'); // 9 − 1 pominięta
    await imp.click();
    await expect(toast(page, /Zaimportowano 8 zmian, pominięto 1/)).toBeVisible();

    let shifts = await activeShifts(page);
    expect(shifts.find((s) => s.id === 'old-2026-11-03')).toBeTruthy(); // pominięta zostaje
    expect(shifts.find((s) => s.id === 'old-2026-11-02')).toBeUndefined(); // zastąpiona
    expect(shifts).toHaveLength(1 + 8); // stara pominięta + 8 nowych (jedna zastąpiła starą)

    // historia importów → Wycofaj → stan sprzed
    await page.getByRole('button', { name: 'Ustawienia' }).click();
    await page.getByRole('button', { name: /Historia importów/ }).click();
    await page.getByRole('button', { name: /Wycofaj import/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Wycofaj' }).click();
    await expect(toast(page, /Wycofano import: usunięto 8 zmian, przywrócono 1/)).toBeVisible();
    shifts = await activeShifts(page);
    expect(shifts.map((s) => s.id).sort()).toEqual(['old-2026-11-02', 'old-2026-11-03']);
    await expect(page.getByText('Wycofany')).toBeVisible();
  });

  test('zmiana okresu na ekranie weryfikacji przesuwa daty', async ({ page }) => {
    await start(page);
    await seed(page, {
      persons: PEOPLE,
      settings: { geminiApiKey: KEY, aiPrivacyAcknowledged: true },
    });
    await mockGemini(page, 'legend');
    await scanToReview(page);
    await review(page).getByLabel('Miesiąc grafiku').selectOption('12');
    const cells = page.getByTestId('days-r0').getByTestId('day-cell');
    await expect(cells.first()).toHaveAttribute('aria-label', /2 grudnia/);
    await page.getByTestId('person-r0').click();
    await page
      .getByRole('dialog', { name: /Kto to/ })
      .getByText('Katarzyna Nowak')
      .click();
    await review(page)
      .getByRole('button', { name: /^Importuj/ })
      .click();
    await expect(toast(page, 'Zaimportowano 3 zmiany')).toBeVisible();
    const dates = (await activeShifts(page)).map((s) => s.date).sort();
    expect(dates).toEqual(['2026-12-02', '2026-12-03', '2026-12-04']);
  });

  test('szkic weryfikacji wraca po ubiciu aplikacji (P-12, E-25)', async ({ page }) => {
    await start(page);
    await seed(page, {
      persons: PEOPLE,
      settings: { geminiApiKey: KEY, aiPrivacyAcknowledged: true },
    });
    await mockGemini(page, 'standard');
    await scanToReview(page);
    await page.getByTestId('person-r2').click();
    await page
      .getByRole('dialog', { name: /Kto to/ })
      .getByText('Nowa osoba')
      .click();
    const kasiaDays = page.getByTestId('days-r0').getByTestId('day-cell');
    await kasiaDays.nth(0).click();
    await page
      .getByRole('dialog', { name: 'Popraw wpis' })
      .getByRole('button', { name: 'Usuń wpis' })
      .click();
    await expect(review(page).getByRole('button', { name: /^Importuj/ })).toHaveText(
      'Importuj 12 zmian',
    );

    // symulacja: aplikacja w tle → visibilitychange(hidden), potem ubicie i start od nowa
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(async () => (await readAll(page, 'scanDrafts')).length).toBe(1);
    await page.reload();

    await expect(review(page)).toBeVisible();
    await expect(page.getByTestId('person-r2')).toContainText('Nowa osoba: Łukasz');
    await expect(review(page).getByRole('button', { name: /^Importuj/ })).toHaveText(
      'Importuj 12 zmian',
    );
    await expect(
      review(page).getByRole('img', { name: 'Miniatura zdjęcia grafiku' }),
    ).toBeVisible();

    // „wstecz” (Android) pyta o odrzucenie zamiast wychodzić z aplikacji; „Zostań” zachowuje wynik
    await page.goBack();
    const ask = page.getByRole('alertdialog', { name: 'Odrzucić wynik skanowania?' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Zostań' }).click();
    await expect(review(page)).toBeVisible();
    expect(await readAll(page, 'scanDrafts')).toHaveLength(1);
  });

  test('podgląd zdjęcia pełnoekranowy z powiększaniem', async ({ page }) => {
    await start(page);
    await seed(page, {
      persons: PEOPLE,
      settings: { geminiApiKey: KEY, aiPrivacyAcknowledged: true },
    });
    await mockGemini(page, 'standard');
    await scanToReview(page);
    await review(page).getByRole('button', { name: 'Powiększ zdjęcie' }).click();
    const viewer = page.getByTestId('image-viewer');
    await expect(viewer).toBeVisible();
    const img = viewer.getByRole('img');
    const w0 = (await img.boundingBox())!.width;
    await viewer.getByRole('button', { name: 'Powiększ' }).click();
    await viewer.getByRole('button', { name: 'Powiększ' }).click();
    const w1 = (await img.boundingBox())!.width;
    expect(w1).toBeGreaterThan(w0 * 1.9);
    await viewer.getByRole('button', { name: 'Zamknij podgląd' }).click();
    await expect(viewer).toBeHidden();
    await expect(review(page)).toBeVisible();
  });
});

test.describe('ustawienia skanowania AI', () => {
  test('klucz maskowany, model, lista modeli i test połączenia; klucz nie trafia do kopii', async ({
    page,
  }) => {
    await start(page);
    const calls = await mockGemini(page, 'standard');
    await page.unroute('https://generativelanguage.googleapis.com/**');
    await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      calls.push({
        url: req.url(),
        method: req.method(),
        key: req.headers()['x-goog-api-key'],
        body: undefined,
      });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: CORS,
        body: JSON.stringify({
          models: [
            { name: 'models/gemini-3-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
          ],
        }),
      });
    });

    await page.getByRole('button', { name: 'Ustawienia' }).click();
    await page.getByRole('button', { name: /Skanowanie AI/ }).click();
    await expect(page.getByRole('heading', { name: 'Skanowanie AI', exact: true })).toBeVisible();
    await expect(page.getByText('Brak klucza')).toBeVisible();

    const input = page.getByRole('textbox', { name: 'Klucz API' }).or(page.getByLabel('Klucz API'));
    await expect(page.getByLabel('Klucz API')).toHaveAttribute('type', 'password');
    await page.getByLabel('Klucz API').fill(KEY);
    await page.getByRole('button', { name: 'Pokaż klucz' }).click();
    await expect(page.getByLabel('Klucz API')).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Zapisz klucz' }).click();
    await expect(page.getByText('Zapisany (****123)')).toBeVisible();
    await expect(page.getByText(KEY)).toHaveCount(0); // pełny klucz nigdzie na ekranie
    void input;

    await page.getByRole('button', { name: 'Testuj połączenie' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Połączenie działa' })).toBeVisible();
    const get = calls.find((c) => c.method === 'GET')!;
    expect(get.key).toBe(KEY);
    expect(get.url).not.toContain(KEY);

    await page.getByLabel('Model').fill('gemini-3-flash');
    await page.getByLabel('Model').blur();
    await page.getByRole('button', { name: 'Pobierz listę modeli' }).click();
    await expect(page.getByText('Znaleziono modeli: 1.')).toBeVisible();

    // kopia zapasowa nie zawiera klucza (P-19): pobieramy plik i czytamy jego treść
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
    });
    await page.getByRole('button', { name: 'Wróć' }).click();
    await page.getByRole('button', { name: 'Eksportuj kopię' }).click();
    const dlg = page.getByRole('alertdialog', { name: 'Kopia gotowa' });
    await expect(dlg).toContainText('Klucz API nie jest zapisywany w kopii');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dlg.getByRole('button', { name: 'Zapisz / udostępnij' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^Grafik_kopia_\d{4}-\d{2}-\d{2}\.json$/);
    const path = await download.path();
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('"app": "grafik"');
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('geminiApiKey');
    // lokalnie klucz jest w bazie
    const local = await readAll(page, 'persons');
    expect(local.length).toBeGreaterThan(0);
  });

  test('zły klucz w „Testuj połączenie” → komunikat po polsku', async ({ page }) => {
    await start(page);
    await seed(page, { settings: { geminiApiKey: KEY } });
    await page.route('https://generativelanguage.googleapis.com/**', async (route) => {
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({ status: 204, headers: CORS });
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        headers: CORS,
        body: JSON.stringify({ error: { message: 'denied' } }),
      });
    });
    await page.getByRole('button', { name: 'Ustawienia' }).click();
    await page.getByRole('button', { name: /Skanowanie AI/ }).click();
    await page.getByRole('button', { name: 'Testuj połączenie' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Klucz API jest nieprawidłowy' }),
    ).toBeVisible();
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`zrzuty faza 7 — ${scheme}`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await mockGemini(page, 'standard');
    await start(page);
    await seed(page, {
      persons: PEOPLE,
      settings: { geminiApiKey: KEY, aiPrivacyAcknowledged: true },
    });
    const shot = (n: string) =>
      page.screenshot({ path: `docs/screens/faza7/${info.project.name}-${scheme}-${n}.png` });
    await openScan(page);
    await expect(sheet(page)).toBeVisible(); // arkusz nie może się zamknąć sam
    // czekamy, aż sprężyna dojedzie do detentu „large” (WebKit bez GPU animuje wolniej)
    await expect
      .poll(async () => (await sheet(page).boundingBox())?.y ?? 999, { timeout: 15_000 })
      .toBeLessThan(60);
    await expect(sheet(page).getByRole('button', { name: 'Zrób zdjęcie' })).toBeInViewport();
    await shot('1-zrodla');
    await pickFile(page);
    await expect(page.getByRole('img', { name: 'Podgląd zdjęcia grafiku' })).toBeVisible();
    await page.waitForTimeout(300);
    await shot('2-podglad');
    await sheet(page).getByRole('button', { name: 'Analizuj' }).click();
    await expect(review(page)).toBeVisible();
    await expect(sheet(page)).toBeHidden(); // animacja zamknięcia arkusza skończona
    await page.waitForTimeout(400);
    await shot('3-weryfikacja');
    await review(page).getByTestId('person-r2').scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await shot('4-weryfikacja-osoby');
  });
}
