/* eslint-disable @typescript-eslint/no-explicit-any -- rekordy IndexedDB w testach */
import { expect, type Page } from '@playwright/test';

/** „Dzisiaj” = środa 4.11.2026 (listopad 2026: 30 dni, 1.11 to niedziela). */
export const NOW = new Date(2026, 10, 4, 10, 0);

export interface P {
  id: string;
  firstName: string;
  lastName?: string;
  color: string;
  aliases: string[];
  isMe: boolean;
  archived: boolean;
  order: number;
  createdAt: number;
  deletedAt?: number;
}
export interface S {
  id: string;
  personId: string;
  date: string;
  kind: string;
  start?: string;
  end?: string;
  usesDefaultHours: boolean;
  note?: string;
  source: string;
  importBatchId?: string;
  updatedAt: number;
  deletedAt?: number;
}

const COLORS = ['blue', 'green', 'orange', 'pink', 'purple', 'teal', 'indigo', 'red'];
export const person = (i: number, firstName: string, extra: Partial<P> = {}): P => ({
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
export const nov = (d: number) => `2026-11-${String(d).padStart(2, '0')}`;
export const shift = (personId: string, date: string, extra: Partial<S> = {}): S => ({
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

/** Strona konsoli; czeka, aż Dexie otworzy bazę (renderuje się stan pusty lub siatka). */
export async function openPc(page: Page, hash = '') {
  await page.clock.setFixedTime(NOW);
  await page.goto(`/pc/${hash ? `#${hash}` : ''}`);
  await expect(page.getByRole('navigation', { name: 'Główna nawigacja' })).toBeVisible();
  // baza istnieje, gdy pierwsze zapytania się wykonały
  await page.waitForFunction(
    () =>
      new Promise<boolean>((res) => {
        const r = indexedDB.open('grafik');
        r.onsuccess = () => {
          const names = [...r.result.objectStoreNames];
          r.result.close();
          res(names.includes('shifts'));
        };
        r.onerror = () => res(false);
      }),
  );
}

/** Zapis wprost do IndexedDB, potem przeładowanie. */
export async function seedPc(
  page: Page,
  data: { persons?: P[]; shifts?: S[]; settings?: Record<string, unknown> },
) {
  await page.evaluate(
    ({ persons = [], shifts = [], settings }) =>
      new Promise<void>((res, rej) => {
        const open = indexedDB.open('grafik');
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(['persons', 'shifts', 'settings'], 'readwrite');
          persons.forEach((p) => tx.objectStore('persons').put(p));
          shifts.forEach((s) => tx.objectStore('shifts').put(s));
          if (settings) tx.objectStore('settings').put({ id: 'app', ...settings });
          tx.oncomplete = () => {
            db.close();
            res();
          };
          tx.onerror = () => rej(tx.error);
        };
        open.onerror = () => rej(open.error);
      }),
    data,
  );
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Główna nawigacja' })).toBeVisible();
}

export async function readStore<T = any>(
  page: Page,
  store: 'persons' | 'shifts' | 'settings' | 'importBatches' | 'scanDrafts',
): Promise<T[]> {
  return page.evaluate(
    (name) =>
      new Promise<any[]>((res, rej) => {
        const open = indexedDB.open('grafik');
        open.onsuccess = () => {
          const req = open.result.transaction(name).objectStore(name).getAll();
          req.onsuccess = () => {
            open.result.close();
            res(req.result);
          };
          req.onerror = () => rej(req.error);
        };
      }),
    store,
  );
}

export const activeShifts = async (page: Page): Promise<S[]> =>
  (await readStore<S>(page, 'shifts')).filter((s) => !s.deletedAt);

export const TEAM = [
  person(0, 'Ania', { lastName: 'Kowalska', isMe: true, aliases: ['Anka'] }),
  person(1, 'Basia', { lastName: 'Nowak' }),
  person(2, 'Celina', { lastName: 'Lis' }),
];

/** Komórka siatki: osoba + dzień listopada. */
export const cell = (page: Page, name: string, day: number) =>
  page.getByRole('gridcell', { name: new RegExp(`^${name}, [^,]+, ${day} listopada`) });

export const clean = async (page: Page) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    // blokada Service Workera to artefakt testów, w których przechwytujemy żądania (page.route)
    if (/Service Worker registration blocked/.test(m.text())) return;
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  return problems;
};
