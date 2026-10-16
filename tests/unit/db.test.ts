import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { GrafikDB, uuid } from '../../src/db/db';
import { createRepos } from '../../src/db/repos';
import {
  BackupError,
  exportBackup,
  importBackup,
  parseBackup,
  previewBackup,
} from '../../src/db/backup';
import type { Shift } from '../../src/domain/types';

let db: GrafikDB;
let repos: ReturnType<typeof createRepos>;

beforeEach(() => {
  db = new GrafikDB(`test-${uuid()}`);
  repos = createRepos(db);
});

const mk = (personId: string, date: string, p: Partial<Shift> = {}): Shift => ({
  id: uuid(),
  personId,
  date,
  kind: 'work',
  start: '10:00',
  end: '22:00',
  usesDefaultHours: true,
  source: 'manual',
  updatedAt: Date.now(),
  ...p,
});

const person = (firstName: string, extra = {}) =>
  repos.persons.create({ firstName, color: 'blue', ...extra });

describe('ustawienia', () => {
  it('zwraca domyślne i scala aktualizacje', async () => {
    const s = await repos.settings.get();
    expect(s.defaultHours[5]).toEqual({ start: '10:00', end: '23:00' });
    expect(s.weekStartsOn).toBe(1);
    await repos.settings.update({ theme: 'dark' });
    expect((await repos.settings.get()).theme).toBe('dark');
  });
});

describe('osoby', () => {
  it('kolejność rośnie, tylko jedna osoba jest „Ja”', async () => {
    const a = await person('Ania', { isMe: true });
    const b = await person('Basia', { isMe: true });
    const list = await repos.persons.list();
    expect(list.map((p) => p.firstName)).toEqual(['Ania', 'Basia']);
    expect(list.find((p) => p.id === a.id)?.isMe).toBe(false);
    expect(list.find((p) => p.id === b.id)?.isMe).toBe(true);
  });

  it('archiwizacja ukrywa osobę, ale nie usuwa', async () => {
    const a = await person('Ania');
    await repos.persons.update(a.id, { archived: true });
    expect(await repos.persons.list()).toHaveLength(0);
    expect(await repos.persons.list({ includeArchived: true })).toHaveLength(1);
  });

  it('aliasy bez duplikatów', async () => {
    const a = await person('Katarzyna');
    await repos.persons.addAlias(a.id, 'Kasia');
    await repos.persons.addAlias(a.id, 'Kasia');
    await repos.persons.addAlias(a.id, '  ');
    expect((await db.persons.get(a.id))?.aliases).toEqual(['Kasia']);
  });

  it('usunięcie osoby z 40 zmianami kaskadowo i Cofnij przywraca wszystko (E-08)', async () => {
    const a = await person('Ania');
    const items = Array.from({ length: 40 }, (_, i) =>
      mk(a.id, `2026-11-${String(i + 1).padStart(2, '0')}`.replace('-3', '-0').slice(0, 10)),
    );
    // 40 różnych dat: listopad + grudzień
    const dates = [
      ...Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`),
      ...Array.from({ length: 10 }, (_, i) => `2026-12-${String(i + 1).padStart(2, '0')}`),
    ];
    items.forEach((s, i) => (s.date = dates[i]!));
    await repos.shifts.addMany(items);
    const token = await repos.persons.remove(a.id);
    expect(token.shiftIds).toHaveLength(40);
    expect(await repos.persons.list()).toHaveLength(0);
    expect(await repos.shifts.range('2026-01-01', '2026-12-31')).toHaveLength(0);

    await repos.persons.restore(a.id, token);
    expect(await repos.persons.list()).toHaveLength(1);
    expect(await repos.shifts.range('2026-01-01', '2026-12-31')).toHaveLength(40);
  });
});

describe('zmiany: unikalność osoba+dzień', () => {
  it('error rzuca przy duplikacie, nic nie zapisuje (transakcja)', async () => {
    const a = await person('Ania');
    await repos.shifts.addMany([mk(a.id, '2026-11-02')]);
    await expect(
      repos.shifts.addMany([mk(a.id, '2026-11-03'), mk(a.id, '2026-11-02')]),
    ).rejects.toThrow(/już istnieje/);
    expect(await repos.shifts.range('2026-11-01', '2026-11-30')).toHaveLength(1);
  });

  it('duplikat wewnątrz jednego wsadu też jest wykrywany', async () => {
    const a = await person('Ania');
    await expect(
      repos.shifts.addMany([mk(a.id, '2026-11-02'), mk(a.id, '2026-11-02')]),
    ).rejects.toThrow();
    const r = await repos.shifts.addMany([mk(a.id, '2026-11-02'), mk(a.id, '2026-11-02')], 'skip');
    expect(r.added).toHaveLength(1);
    expect(r.skipped).toHaveLength(1);
  });

  it('skip pomija, replace zastępuje (stara soft-deleted)', async () => {
    const a = await person('Ania');
    const first = mk(a.id, '2026-11-02');
    await repos.shifts.addMany([first]);
    const skip = await repos.shifts.addMany([mk(a.id, '2026-11-02')], 'skip');
    expect(skip.added).toHaveLength(0);

    const next = mk(a.id, '2026-11-02', { start: '12:00', end: '20:00', usesDefaultHours: false });
    const rep = await repos.shifts.addMany([next], 'replace');
    expect(rep.replaced.map((s) => s.id)).toEqual([first.id]);
    const active = await repos.shifts.range('2026-11-01', '2026-11-30');
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe(next.id);
    expect((await db.shifts.get(first.id))?.deletedAt).toBeTruthy();
  });

  it('soft-delete + Cofnij: wraca z tym samym id (E-07)', async () => {
    const a = await person('Ania');
    const s = mk(a.id, '2026-11-02');
    await repos.shifts.addMany([s]);
    await repos.shifts.softDelete([s.id]);
    expect(await repos.shifts.range('2026-11-01', '2026-11-30')).toHaveLength(0);
    await repos.shifts.restore([s.id]);
    const back = await repos.shifts.range('2026-11-01', '2026-11-30');
    expect(back.map((x) => x.id)).toEqual([s.id]);
  });

  it('Cofnij odmawia, gdy w to miejsce dodano inną zmianę (brak duplikatów po cofnięciu)', async () => {
    const a = await person('Ania');
    const s = mk(a.id, '2026-11-02');
    await repos.shifts.addMany([s]);
    await repos.shifts.softDelete([s.id]);
    await repos.shifts.addMany([mk(a.id, '2026-11-02')]);
    await expect(repos.shifts.restore([s.id])).rejects.toThrow(/Nie można cofnąć/);
  });

  it('update wykrywa kolizję przy zmianie daty', async () => {
    const a = await person('Ania');
    const s1 = mk(a.id, '2026-11-02');
    const s2 = mk(a.id, '2026-11-03');
    await repos.shifts.addMany([s1, s2]);
    await expect(repos.shifts.update(s2.id, { date: '2026-11-02' })).rejects.toThrow();
    await repos.shifts.update(s2.id, { start: '11:00', usesDefaultHours: false });
    expect((await db.shifts.get(s2.id))?.start).toBe('11:00');
  });

  it('purgeOld usuwa tylko rekordy soft-deleted starsze niż 30 dni', async () => {
    const a = await person('Ania');
    const old = mk(a.id, '2026-11-02', { deletedAt: 1000 });
    const fresh = mk(a.id, '2026-11-03', { deletedAt: Date.now() });
    const live = mk(a.id, '2026-11-04');
    await db.shifts.bulkAdd([old, fresh, live]);
    const n = await repos.shifts.purgeOld(Date.now());
    expect(n).toBe(1);
    expect(await db.shifts.count()).toBe(2);
  });
});

describe('kopia zapasowa', () => {
  async function seed() {
    const a = await person('Ania', { isMe: true, aliases: ['Anka'] });
    const b = await person('Łukasz', { lastName: 'Żółć' });
    await repos.shifts.addMany([
      mk(a.id, '2026-11-02'),
      mk(a.id, '2026-11-03', { kind: 'vacation', start: undefined, end: undefined }),
      mk(b.id, '2026-11-02', { note: 'zażółć gęślą jaźń', usesDefaultHours: false }),
    ]);
    await repos.settings.update({
      theme: 'dark',
      weekStartsOn: 0,
      geminiApiKey: 'SEKRET-KLUCZ-123',
    });
  }

  it('eksport NIE zawiera klucza API (P-19) ani usuniętych rekordów', async () => {
    await seed();
    const del = mk((await db.persons.toCollection().first())!.id, '2026-11-09');
    await db.shifts.add({ ...del, deletedAt: 5 });
    const b = await exportBackup(db);
    const text = JSON.stringify(b);
    expect(text).not.toContain('SEKRET-KLUCZ-123');
    expect(text).not.toContain('geminiApiKey');
    expect(b.shifts).toHaveLength(3);
    expect(b.settings.theme).toBe('dark');
  });

  it('round-trip: eksport → wyczyszczenie → import daje identyczny stan', async () => {
    await seed();
    const before = await exportBackup(db);
    const text = JSON.stringify(before);

    await Promise.all([db.persons.clear(), db.shifts.clear(), db.settings.clear()]);
    expect((await exportBackup(db)).shifts).toHaveLength(0);

    const res = await importBackup(parseBackup(text), 'replace', db);
    expect(res).toEqual({ persons: 2, shifts: 3, skipped: 0 });
    const after = await exportBackup(db);
    expect({ ...after, exportedAt: '' }).toEqual({ ...before, exportedAt: '' });
  });

  it('replace zachowuje lokalny klucz API', async () => {
    await seed();
    const b = await exportBackup(db);
    await importBackup(b, 'replace', db);
    expect((await db.settings.get('app'))?.geminiApiKey).toBe('SEKRET-KLUCZ-123');
  });

  it('merge nie tworzy duplikatów osoba+dzień', async () => {
    await seed();
    const b = await exportBackup(db);
    // lokalnie ta sama osoba i dzień, ale inne id zmiany
    const ania = b.persons[0]!;
    const local = await db.shifts.where('[personId+date]').equals([ania.id, '2026-11-02']).first();
    await db.shifts.delete(local!.id);
    await db.shifts.add(mk(ania.id, '2026-11-02', { start: '11:00', usesDefaultHours: false }));

    const r = await importBackup(b, 'merge', db);
    expect(r.skipped).toBe(1);
    const active = await db.shifts.filter((s) => !s.deletedAt).toArray();
    const keys = active.map((s) => `${s.personId}|${s.date}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(active.find((s) => s.personId === ania.id && s.date === '2026-11-02')?.start).toBe(
      '11:00',
    );
  });

  it('podgląd liczby rekordów', async () => {
    await seed();
    const p = previewBackup(await exportBackup(db));
    expect(p.persons).toBe(2);
    expect(p.shifts).toBe(3);
  });

  describe('walidacja pliku', () => {
    it('odrzuca nie-JSON, obcy plik, nowszą wersję i uszkodzone dane', async () => {
      expect(() => parseBackup('{{{')).toThrow(BackupError);
      expect(() => parseBackup('{"foo":1}')).toThrow(/Grafik/);
      expect(() => parseBackup('{"app":"grafik","schemaVersion":99}')).toThrow(/nowszej/);

      await seed();
      const good = await exportBackup(db);
      const badDate = structuredClone(good);
      badDate.shifts[0]!.date = '2026-11-31';
      expect(() => parseBackup(JSON.stringify(badDate))).toThrow(BackupError);

      const orphan = structuredClone(good);
      orphan.shifts[0]!.personId = 'nie-ma';
      expect(() => parseBackup(JSON.stringify(orphan))).toThrow(/bez przypisanej osoby/);

      const dup = structuredClone(good);
      dup.shifts.push({ ...dup.shifts[0]!, id: 'inny' });
      expect(() => parseBackup(JSON.stringify(dup))).toThrow(/duplikat/);
    });
  });
});
