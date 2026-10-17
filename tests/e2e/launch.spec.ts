/* eslint-disable @typescript-eslint/no-explicit-any -- rekordy IndexedDB w testach */
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

const NOW = new Date(2026, 10, 4, 10, 0);

async function start(page: Page) {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('textbox', { name: 'Imię' }).fill('Ania');
  await page.getByRole('button', { name: 'Dalej' }).click();
  await page.getByRole('button', { name: 'Gotowe' }).click();
  await expect(page.getByRole('heading', { name: 'Mój grafik' })).toBeVisible();
}

test('manifest: skróty (Skanuj, Dodaj, PDF), share_target i ikony maskable', async ({
  request,
}) => {
  const res = await request.get('/manifest.webmanifest');
  const m = await res.json();
  expect(m.shortcuts.map((s: any) => s.url)).toEqual([
    '/?action=scan',
    '/?action=add',
    '/?action=pdf',
  ]);
  expect(m.shortcuts.map((s: any) => s.name)).toContain('Skanuj grafik');
  expect(m.share_target).toMatchObject({
    action: '/share-target',
    method: 'POST',
    enctype: 'multipart/form-data',
  });
  expect(m.share_target.params.files[0]).toMatchObject({ name: 'image' });
  expect(m.share_target.params.files[0].accept).toContain('image/*');
  expect(m.icons.map((i: any) => i.purpose ?? 'any').sort()).toEqual(['any', 'any', 'maskable']);
  expect(m.start_url).toBe('/');
  expect(m.display).toBe('standalone');
});

test('splash screeny i ikony są serwowane', async ({ request, page }) => {
  await page.goto('/');
  const hrefs = await page
    .locator('link[rel="apple-touch-startup-image"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('href')!));
  expect(hrefs.length).toBe(16);
  for (const h of hrefs) {
    const r = await request.get(h);
    expect(r.ok(), h).toBe(true);
    expect(r.headers()['content-type']).toContain('image/png');
  }
  for (const i of [
    '/icons/apple-touch-icon.png',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/maskable-512.png',
  ]) {
    expect((await request.get(i)).ok(), i).toBe(true);
  }
});

test('skróty: ?action=scan / add / pdf otwierają właściwy ekran, a adres jest czyszczony', async ({
  page,
}) => {
  await start(page);
  await page.goto('/?action=scan');
  await expect(page.getByRole('dialog', { name: 'Skanuj grafik' })).toBeVisible();
  expect(new URL(page.url()).search).toBe('');

  await page.goto('/?action=add');
  await expect(page.getByRole('dialog', { name: 'Dodaj zmianę' })).toBeVisible();
  expect(new URL(page.url()).search).toBe('');

  await page.goto('/?action=pdf');
  await expect(page.getByRole('dialog', { name: 'Eksportuj PDF' })).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
});

test('share_target: zdjęcie wysłane POST-em trafia do skanowania (service worker → Cache API → podgląd)', async ({
  page,
}) => {
  await start(page);
  // poczekaj, aż SW przejmie stronę (POST musi przejść przez niego)
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  const buffer = await sharp({
    create: { width: 640, height: 480, channels: 3, background: '#eee' },
  })
    .png()
    .toBuffer();
  const status = await page.evaluate(
    async (bytes) => {
      const fd = new FormData();
      fd.append('image', new File([new Uint8Array(bytes)], 'z-galerii.png', { type: 'image/png' }));
      const res = await fetch('/share-target', { method: 'POST', body: fd, redirect: 'manual' });
      return { type: res.type, status: res.status };
    },
    [...buffer],
  );
  // redirect: 'manual' → nieprzejrzysta odpowiedź przekierowania (303 obsłużone przez SW)
  expect(status.type).toBe('opaqueredirect');

  await page.goto('/?action=shared');
  await expect(page.getByRole('dialog', { name: 'Skanuj grafik' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Podgląd zdjęcia grafiku' })).toBeVisible();
  expect(new URL(page.url()).search).toBe('');

  // plik został zużyty — kolejne wejście nie powiela zdjęcia
  await page.getByRole('button', { name: 'Usuń stronę 1' }).click();
  await page.keyboard.press('Escape');
  const left = await page.evaluate(async () => {
    const c = await caches.open('grafik-share');
    return (await c.keys()).length;
  });
  expect(left).toBe(0);
});

test('?action=shared bez zdjęcia otwiera po prostu skanowanie', async ({ page }) => {
  await start(page);
  await page.goto('/?action=shared');
  await expect(page.getByRole('dialog', { name: 'Skanuj grafik' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Podgląd zdjęcia grafiku' })).toHaveCount(0);
});
