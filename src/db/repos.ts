import { db, uuid, type GrafikDB } from './db';
import { DEFAULT_HOURS } from '../domain/hours';
import { slotKey } from '../domain/conflicts';
import { shiftsUsingDefaults, withDefaultHours } from '../domain/hours';
import type {
  DefaultHours,
  ImportBatch,
  ISODate,
  Person,
  ScanDraft,
  Settings,
  Shift,
} from '../domain/types';

export const DEFAULT_MODEL = 'gemini-flash-latest';
const PURGE_AFTER_MS = 30 * 24 * 3600 * 1000;

export const defaultSettings = (): Settings => ({
  id: 'app',
  defaultHours: structuredClone(DEFAULT_HOURS),
  weekStartsOn: 1,
  geminiModel: DEFAULT_MODEL,
  aiPrivacyAcknowledged: false,
  theme: 'system',
});

/** Repozytoria przyjmują instancję bazy (domyślnie globalną) — ułatwia testy. */
export function createRepos(d: GrafikDB = db) {
  /* ---------------- Ustawienia ---------------- */
  const settings = {
    async get(): Promise<Settings> {
      const s = await d.settings.get('app');
      // dołóż brakujące pola po przyszłych migracjach
      return { ...defaultSettings(), ...s };
    },
    // odczyt+zapis w jednej transakcji: dwie szybkie zmiany nie nadpisują się nawzajem
    async update(patch: Partial<Omit<Settings, 'id'>>): Promise<Settings> {
      return d.transaction('rw', d.settings, async () => {
        const next = { ...(await settings.get()), ...patch, id: 'app' as const };
        await d.settings.put(next);
        return next;
      });
    },
  };

  /* ---------------- Osoby ---------------- */
  const persons = {
    list(opts: { includeArchived?: boolean } = {}): Promise<Person[]> {
      return d.persons
        .orderBy('order')
        .filter((p) => !p.deletedAt && (opts.includeArchived || !p.archived))
        .toArray();
    },
    async create(
      input: Pick<Person, 'firstName' | 'color'> & Partial<Omit<Person, 'id' | 'createdAt'>>,
    ): Promise<Person> {
      return d.transaction('rw', d.persons, async () => {
        const all = await d.persons.toArray();
        const person: Person = {
          lastName: undefined,
          aliases: [],
          isMe: false,
          archived: false,
          order: all.reduce((m, p) => Math.max(m, p.order), -1) + 1,
          ...input,
          id: uuid(),
          createdAt: Date.now(),
        };
        // tylko jedna osoba może być „Ja”
        if (person.isMe) await clearMe(d);
        await d.persons.add(person);
        return person;
      });
    },
    async update(id: string, patch: Partial<Omit<Person, 'id'>>): Promise<void> {
      await d.transaction('rw', d.persons, async () => {
        if (patch.isMe) await clearMe(d);
        await d.persons.update(id, patch);
      });
    },
    async addAlias(id: string, alias: string): Promise<void> {
      const p = await d.persons.get(id);
      const a = alias.trim();
      if (!p || !a || p.aliases.includes(a)) return;
      await d.persons.update(id, { aliases: [...p.aliases, a] });
    },
    async reorder(orderedIds: string[]): Promise<void> {
      await d.transaction('rw', d.persons, async () => {
        await Promise.all(orderedIds.map((id, i) => d.persons.update(id, { order: i })));
      });
    },
    /** Usunięcie osoby: soft-delete jej zmian w jednej transakcji. Zwraca znacznik do cofnięcia. */
    async remove(id: string): Promise<{ at: number; shiftIds: string[] }> {
      return d.transaction('rw', d.persons, d.shifts, async () => {
        const at = Date.now();
        const active = await d.shifts
          .where('personId')
          .equals(id)
          .filter((s) => !s.deletedAt)
          .toArray();
        await d.persons.update(id, { deletedAt: at });
        await Promise.all(active.map((s) => d.shifts.update(s.id, { deletedAt: at })));
        return { at, shiftIds: active.map((s) => s.id) };
      });
    },
    /** Cofnięcie usunięcia osoby wraz ze zmianami usuniętymi w tej samej operacji. */
    async restore(id: string, token: { at: number; shiftIds: string[] }): Promise<void> {
      await d.transaction('rw', d.persons, d.shifts, async () => {
        await d.persons.update(id, { deletedAt: undefined });
        await Promise.all(
          token.shiftIds.map((sid) => d.shifts.update(sid, { deletedAt: undefined })),
        );
      });
    },
  };

  /* ---------------- Zmiany ---------------- */
  type Policy = 'error' | 'replace' | 'skip';

  const shifts = {
    /** Aktywne zmiany w zakresie dat (włącznie). */
    range(from: string, to: string): Promise<Shift[]> {
      return d.shifts
        .where('date')
        .between(from, to, true, true)
        .filter((s) => !s.deletedAt)
        .toArray();
    },
    forPerson(personId: string): Promise<Shift[]> {
      return d.shifts
        .where('personId')
        .equals(personId)
        .filter((s) => !s.deletedAt)
        .toArray();
    },
    /**
     * Dodaje zmiany; unikalność osoba+dzień egzekwowana tu (transakcyjnie).
     * `replace` soft-deletuje istniejącą, `skip` pomija, `error` rzuca.
     */
    async addMany(
      items: Shift[],
      onConflict: Policy = 'error',
    ): Promise<{ added: Shift[]; skipped: Shift[]; replaced: Shift[] }> {
      return d.transaction('rw', d.shifts, async () => {
        const added: Shift[] = [];
        const skipped: Shift[] = [];
        const replaced: Shift[] = [];
        const seen = new Map<string, Shift>(); // także duplikaty wewnątrz wsadu
        const dates = items.map((s) => s.date).sort();
        const existing = dates.length
          ? await d.shifts
              .where('date')
              .between(dates[0]!, dates[dates.length - 1]!, true, true)
              .filter((s) => !s.deletedAt)
              .toArray()
          : [];
        for (const s of existing) seen.set(slotKey(s), s);

        for (const item of items) {
          const key = slotKey(item);
          const hit = seen.get(key);
          if (hit) {
            if (onConflict === 'error') {
              throw new Error(`Zmiana dla tej osoby w dniu ${item.date} już istnieje.`);
            }
            if (onConflict === 'skip') {
              skipped.push(item);
              continue;
            }
            const now = Date.now();
            await d.shifts.update(hit.id, { deletedAt: now });
            replaced.push(hit);
          }
          await d.shifts.add(item);
          seen.set(key, item);
          added.push(item);
        }
        return { added, skipped, replaced };
      });
    },
    /** Cofnięcie dodania: usuwa dodane i przywraca zastąpione (jedna transakcja). */
    async undoAdd(added: Shift[], replaced: Shift[]): Promise<void> {
      await d.transaction('rw', d.shifts, async () => {
        const at = Date.now();
        await Promise.all(added.map((s) => d.shifts.update(s.id, { deletedAt: at })));
        await Promise.all(replaced.map((s) => d.shifts.update(s.id, { deletedAt: undefined })));
      });
    },
    async update(id: string, patch: Partial<Omit<Shift, 'id'>>): Promise<void> {
      await d.transaction('rw', d.shifts, async () => {
        const cur = await d.shifts.get(id);
        if (!cur) throw new Error('Nie znaleziono zmiany.');
        const next = { ...cur, ...patch, updatedAt: Date.now() };
        if (next.personId !== cur.personId || next.date !== cur.date) {
          const clash = await d.shifts
            .where('[personId+date]')
            .equals([next.personId, next.date])
            .filter((s) => !s.deletedAt && s.id !== id)
            .first();
          if (clash) throw new Error(`Zmiana dla tej osoby w dniu ${next.date} już istnieje.`);
        }
        await d.shifts.put(next);
      });
    },
    async softDelete(ids: string[]): Promise<void> {
      const at = Date.now();
      await d.transaction('rw', d.shifts, () =>
        Promise.all(ids.map((id) => d.shifts.update(id, { deletedAt: at }))),
      );
    },
    /** „Cofnij”: zmiana wraca z tym samym id; odmawia, gdy w jej miejsce powstała nowa. */
    async restore(ids: string[]): Promise<void> {
      await d.transaction('rw', d.shifts, async () => {
        for (const id of ids) {
          const s = await d.shifts.get(id);
          if (!s) continue;
          const clash = await d.shifts
            .where('[personId+date]')
            .equals([s.personId, s.date])
            .filter((o) => !o.deletedAt && o.id !== id)
            .first();
          if (clash) throw new Error(`Nie można cofnąć: w dniu ${s.date} jest już inna zmiana.`);
          await d.shifts.update(id, { deletedAt: undefined });
        }
      });
    },
    /** Przyszłe zmiany z flagą „domyślne” (do pytania po zmianie ustawień). */
    async futureUsingDefaults(fromDate: ISODate): Promise<Shift[]> {
      const all = await d.shifts.where('date').aboveOrEqual(fromDate).toArray();
      return shiftsUsingDefaults(all, fromDate);
    },
    /** Nadpisuje godziny przyszłych zmian z flagą „domyślne” nowymi godzinami domyślnymi. */
    async applyDefaultHours(fromDate: ISODate, defaults: DefaultHours): Promise<number> {
      return d.transaction('rw', d.shifts, async () => {
        const list = await shifts.futureUsingDefaults(fromDate);
        const now = Date.now();
        await d.shifts.bulkPut(
          list.map((s) => ({ ...withDefaultHours(s, defaults), updatedAt: now })),
        );
        return list.length;
      });
    },
    /** Fizyczne usunięcie rekordów soft-deleted starszych niż 30 dni (przy starcie). */
    async purgeOld(now = Date.now()): Promise<number> {
      const cutoff = now - PURGE_AFTER_MS;
      return d.transaction('rw', d.shifts, d.persons, async () => {
        const old = await d.shifts
          .filter((s) => !!s.deletedAt && s.deletedAt < cutoff)
          .primaryKeys();
        await d.shifts.bulkDelete(old);
        const oldP = await d.persons
          .filter((p) => !!p.deletedAt && p.deletedAt < cutoff)
          .primaryKeys();
        await d.persons.bulkDelete(oldP);
        return old.length + oldP.length;
      });
    },
  };

  /* ---------------- Import AI: partie, wycofanie, szkic ---------------- */
  const imports = {
    list(): Promise<ImportBatch[]> {
      return d.importBatches.orderBy('createdAt').reverse().toArray();
    },
    /**
     * Zapis importu w jednej transakcji: nowe osoby, aliasy, zmiany (z polityką dla kolizji)
     * i rekord ImportBatch z kopiami zastąpionych zmian (pełne wycofanie).
     */
    async apply(input: {
      batch: Omit<ImportBatch, 'shiftIds' | 'replacedShifts'>;
      newPersons: Person[];
      aliasUpdates: { personId: string; alias: string }[];
      shifts: Shift[];
      choose: (incoming: Shift, existing: Shift) => 'replace' | 'skip';
    }): Promise<{ batch: ImportBatch; added: number; replaced: number; skipped: number }> {
      return d.transaction('rw', d.persons, d.shifts, d.importBatches, async () => {
        if (input.newPersons.length) await d.persons.bulkAdd(input.newPersons);
        for (const u of input.aliasUpdates) {
          const p = await d.persons.get(u.personId);
          if (p && !p.aliases.includes(u.alias)) {
            await d.persons.update(u.personId, { aliases: [...p.aliases, u.alias] });
          }
        }
        const dates = input.shifts.map((s) => s.date).sort();
        const existing = dates.length
          ? await d.shifts
              .where('date')
              .between(dates[0]!, dates[dates.length - 1]!, true, true)
              .filter((s) => !s.deletedAt)
              .toArray()
          : [];
        const bySlot = new Map(existing.map((s) => [slotKey(s), s]));
        const added: Shift[] = [];
        const replacedShifts: Shift[] = [];
        let skipped = 0;
        const now = Date.now();
        for (const s of input.shifts) {
          const hit = bySlot.get(slotKey(s));
          if (hit) {
            if (input.choose(s, hit) === 'skip') {
              skipped++;
              continue;
            }
            replacedShifts.push({ ...hit });
            await d.shifts.update(hit.id, { deletedAt: now });
          }
          await d.shifts.add(s);
          bySlot.set(slotKey(s), s);
          added.push(s);
        }
        const batch: ImportBatch = {
          ...input.batch,
          shiftIds: added.map((s) => s.id),
          replacedShifts,
        };
        await d.importBatches.add(batch);
        return { batch, added: added.length, replaced: replacedShifts.length, skipped };
      });
    },
    /** Wycofanie importu: usuwa zaimportowane zmiany i przywraca zastąpione (o ile miejsce wolne). */
    async revert(
      batchId: string,
    ): Promise<{ removed: number; restored: number; notRestored: number }> {
      return d.transaction('rw', d.shifts, d.importBatches, async () => {
        const batch = await d.importBatches.get(batchId);
        if (!batch) throw new Error('Nie znaleziono importu.');
        if (batch.revertedAt) return { removed: 0, restored: 0, notRestored: 0 };
        const now = Date.now();
        let removed = 0;
        for (const id of batch.shiftIds) {
          const s = await d.shifts.get(id);
          if (s && !s.deletedAt) {
            await d.shifts.update(id, { deletedAt: now });
            removed++;
          }
        }
        let restored = 0;
        let notRestored = 0;
        for (const old of batch.replacedShifts) {
          const clash = await d.shifts
            .where('[personId+date]')
            .equals([old.personId, old.date])
            .filter((x) => !x.deletedAt && x.id !== old.id)
            .first();
          if (clash) {
            notRestored++;
            continue;
          }
          await d.shifts.update(old.id, { deletedAt: undefined });
          restored++;
        }
        await d.importBatches.update(batchId, { revertedAt: now });
        return { removed, restored, notRestored };
      });
    },
    getDraft(): Promise<ScanDraft | undefined> {
      return d.scanDrafts.get('current');
    },
    saveDraft(draft: ScanDraft): Promise<unknown> {
      return d.scanDrafts.put(draft);
    },
    clearDraft(): Promise<void> {
      return d.scanDrafts.delete('current');
    },
  };

  return { settings, persons, shifts, imports };
}

async function clearMe(d: GrafikDB) {
  const mine = await d.persons.filter((p) => p.isMe).primaryKeys();
  await Promise.all(mine.map((id) => d.persons.update(id, { isMe: false })));
}

export const repos = createRepos();
