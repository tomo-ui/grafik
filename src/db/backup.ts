import { z } from 'zod';
import { db, type GrafikDB } from './db';
import { defaultSettings } from './repos';
import { isValidISODate } from '../domain/dates';
import { parseHHMM } from '../domain/hours';
import { slotKey } from '../domain/conflicts';
import type { Person, Settings, Shift } from '../domain/types';

export const BACKUP_SCHEMA_VERSION = 1;

const hhmm = z.string().refine((s) => parseHHMM(s) !== null, 'Niepoprawna godzina');
const isoDate = z.string().refine(isValidISODate, 'Niepoprawna data');

const personSchema = z.object({
  id: z.string().min(1),
  firstName: z.string(),
  lastName: z.string().optional(),
  color: z.string(),
  aliases: z.array(z.string()),
  isMe: z.boolean(),
  archived: z.boolean(),
  order: z.number(),
  createdAt: z.number(),
  deletedAt: z.number().optional(),
});

const shiftSchema = z.object({
  id: z.string().min(1),
  personId: z.string().min(1),
  date: isoDate,
  kind: z.enum(['work', 'off', 'vacation', 'sick', 'other']),
  start: hhmm.optional(),
  end: hhmm.optional(),
  usesDefaultHours: z.boolean(),
  note: z.string().optional(),
  source: z.enum(['manual', 'ai']),
  importBatchId: z.string().optional(),
  deletedAt: z.number().optional(),
  updatedAt: z.number(),
});

const hoursEntry = z.object({ start: hhmm, end: hhmm });
// P-19: w kopii nie ma geminiApiKey — pole jest tu celowo nieobecne i odrzucane (strip)
const settingsSchema = z.object({
  defaultHours: z.object({
    0: hoursEntry,
    1: hoursEntry,
    2: hoursEntry,
    3: hoursEntry,
    4: hoursEntry,
    5: hoursEntry,
    6: hoursEntry,
  }),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]),
  geminiModel: z.string(),
  aiPrivacyAcknowledged: z.boolean(),
  theme: z.enum(['system', 'light', 'dark']),
});

const backupSchema = z.object({
  app: z.literal('grafik'),
  schemaVersion: z.number().int(),
  exportedAt: z.string(),
  persons: z.array(personSchema),
  shifts: z.array(shiftSchema),
  settings: settingsSchema,
});

export type Backup = z.infer<typeof backupSchema>;

export class BackupError extends Error {}

/** Eksport aktywnych danych (bez soft-deleted i bez klucza API). */
export async function exportBackup(d: GrafikDB = db, now = new Date()): Promise<Backup> {
  const [persons, shifts, stored] = await Promise.all([
    d.persons.filter((p) => !p.deletedAt).toArray(),
    d.shifts.filter((s) => !s.deletedAt).toArray(),
    d.settings.get('app'),
  ]);
  const {
    id: _id,
    geminiApiKey: _key,
    onboardingDone: _ob,
    ...settings
  } = { ...defaultSettings(), ...stored };
  void _id;
  void _key;
  void _ob;
  return {
    app: 'grafik',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    // eslint-disable-next-line no-restricted-syntax -- znacznik czasu eksportu, nie data dnia
    exportedAt: now.toISOString(),
    persons: persons.sort((a, b) => a.order - b.order),
    shifts: shifts.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)),
    settings: settingsSchema.parse(settings),
  };
}

export function backupFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `Grafik_kopia_${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}

/** Walidacja pliku kopii. Rzuca BackupError z polskim komunikatem. */
export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('To nie jest poprawny plik kopii (nieprawidłowy JSON).');
  }
  const head = z.object({ app: z.string().optional(), schemaVersion: z.number().optional() });
  const h = head.safeParse(raw);
  if (!h.success || h.data.app !== 'grafik') {
    throw new BackupError('To nie jest plik kopii aplikacji Grafik.');
  }
  if ((h.data.schemaVersion ?? 0) > BACKUP_SCHEMA_VERSION) {
    throw new BackupError('Kopia pochodzi z nowszej wersji aplikacji. Zaktualizuj aplikację.');
  }
  // tu trafią migracje starszych wersji schematu (obecnie jest tylko v1)
  const r = backupSchema.safeParse(raw);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new BackupError(
      `Plik kopii jest uszkodzony (${first?.path.join('.') ?? '?'}: ${first?.message ?? 'błąd'}).`,
    );
  }
  const personIds = new Set(r.data.persons.map((p) => p.id));
  const orphan = r.data.shifts.find((s) => !personIds.has(s.personId));
  if (orphan) throw new BackupError('Plik kopii jest uszkodzony (zmiana bez przypisanej osoby).');
  const seen = new Set<string>();
  for (const s of r.data.shifts) {
    const k = slotKey(s);
    if (seen.has(k)) {
      throw new BackupError(`Plik kopii jest uszkodzony (duplikat zmiany w dniu ${s.date}).`);
    }
    seen.add(k);
  }
  return r.data;
}

export function previewBackup(b: Backup): { persons: number; shifts: number; exportedAt: string } {
  return { persons: b.persons.length, shifts: b.shifts.length, exportedAt: b.exportedAt };
}

export type ImportMode = 'replace' | 'merge';

/**
 * Import w jednej transakcji.
 * replace: czyści osoby/zmiany/partie importu/szkic i wgrywa kopię; lokalny klucz API zostaje.
 * merge: osoby i zmiany o tym samym id nadpisywane danymi z kopii; kolizja osoba+dzień
 *        z innym id → zostaje istniejąca zmiana (brak duplikatów).
 */
export async function importBackup(
  b: Backup,
  mode: ImportMode,
  d: GrafikDB = db,
): Promise<{ persons: number; shifts: number; skipped: number }> {
  return d.transaction(
    'rw',
    [d.persons, d.shifts, d.importBatches, d.scanDrafts, d.settings],
    async () => {
      const current = await d.settings.get('app');
      const keepKey = current?.geminiApiKey;
      let skipped = 0;

      if (mode === 'replace') {
        await Promise.all([
          d.persons.clear(),
          d.shifts.clear(),
          d.importBatches.clear(),
          d.scanDrafts.clear(),
        ]);
        await d.persons.bulkAdd(b.persons as Person[]);
        await d.shifts.bulkAdd(b.shifts as Shift[]);
        const settings: Settings = {
          ...b.settings,
          id: 'app',
          geminiApiKey: keepKey,
          onboardingDone: true,
        };
        await d.settings.put(settings);
        return { persons: b.persons.length, shifts: b.shifts.length, skipped };
      }

      await d.persons.bulkPut(b.persons as Person[]);
      const existing = await d.shifts.filter((s) => !s.deletedAt).toArray();
      const byKey = new Map(existing.map((s) => [slotKey(s), s]));
      const toPut: Shift[] = [];
      for (const s of b.shifts as Shift[]) {
        const hit = byKey.get(slotKey(s));
        if (hit && hit.id !== s.id) {
          skipped++;
          continue;
        }
        toPut.push(s);
        byKey.set(slotKey(s), s);
      }
      await d.shifts.bulkPut(toPut);
      return { persons: b.persons.length, shifts: toPut.length, skipped };
    },
  );
}
