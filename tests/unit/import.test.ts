import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeSchedule } from '../../src/ai/normalize';
import { parsedScheduleSchema } from '../../src/ai/schema';
import {
  blockers,
  buildImportPlan,
  conflictPolicy,
  hasBlockers,
  initialDecisions,
  resolveEntries,
  type ImportDecisions,
} from '../../src/ai/importPlan';
import { GrafikDB, uuid } from '../../src/db/db';
import { createRepos } from '../../src/db/repos';
import { nextColor } from '../../src/domain/people';
import type { Person, Shift } from '../../src/domain/types';

const fixture = (name: string) =>
  parsedScheduleSchema.parse(
    JSON.parse(readFileSync(`tests/fixtures/gemini-responses/schedule-${name}.json`, 'utf8')),
  );

async function setup() {
  const db = new GrafikDB(`t-${uuid()}`);
  const repos = createRepos(db);
  const kasia = await repos.persons.create({
    firstName: 'Katarzyna',
    lastName: 'Nowak',
    color: 'blue',
    aliases: ['Kasia'],
  });
  const basia = await repos.persons.create({
    firstName: 'Barbara',
    lastName: 'Wiśniewska',
    color: 'green',
    aliases: ['Basia'],
  });
  const persons = await repos.persons.list();
  const ctx = (existing: Shift[] = [], batchId = 'b1') => ({
    persons,
    existing,
    newId: () => uuid(),
    now: 1000,
    batchId,
    pickColor: nextColor,
  });
  return { db, repos, kasia, basia, persons, ctx };
}

const norm = (name: string, persons: Person[]) =>
  normalizeSchedule(fixture(name), { today: '2026-11-04', people: persons });

describe('decyzje i blokady (4.7)', () => {
  it('pewne dopasowania gotowe; nieznana osoba blokuje import', async () => {
    const { persons } = await setup();
    const n = norm('transposed', persons); // Anna K. (brak w bazie → nierozstrzygnięta) + Jan
    const d = initialDecisions(n);
    expect(Object.values(d.persons)).toHaveLength(0); // nikt nie pasuje
    expect(blockers(n, d).unresolved).toEqual(['r0', 'r1']);

    const std = norm('standard', persons);
    const ds = initialDecisions(std);
    expect(ds.persons.r0).toMatchObject({ mode: 'existing', confirmed: true });
    // Łukasz nie istnieje w tej bazie → nierozstrzygnięty
    expect(blockers(std, ds).unresolved).toEqual(['r2']);
    ds.persons.r2 = { mode: 'skip' };
    expect(hasBlockers(blockers(std, ds))).toBe(false);
  });

  it('podpowiedź (rozmyte) wymaga potwierdzenia', async () => {
    const { persons } = await setup();
    const parsed = parsedScheduleSchema.parse({
      period: { month: 11, year: 2026 },
      people: [
        {
          nameAsWritten: 'Kazia',
          entries: [{ date: '2026-11-02', rawCell: 'X', kind: 'work', confidence: 1 }],
        },
      ],
    });
    const n = normalizeSchedule(parsed, { today: '2026-11-04', people: persons });
    expect(n.persons[0]!.status).toBe('suggested');
    const d = initialDecisions(n);
    expect(d.persons.r0).toMatchObject({ confirmed: false });
    expect(blockers(n, d).unresolved).toEqual(['r0']);
    d.persons.r0 = { ...d.persons.r0!, confirmed: true } as typeof d.persons.r0;
    expect(hasBlockers(blockers(n, d))).toBe(false);
  });

  it('dwie nazwy → ta sama osoba blokują import, dopóki jedna nie zostanie zmieniona (E-21)', async () => {
    const { persons, kasia } = await setup();
    const parsed = parsedScheduleSchema.parse({
      period: { month: 11, year: 2026 },
      people: [
        {
          nameAsWritten: 'Kasia',
          entries: [{ date: '2026-11-02', rawCell: 'X', kind: 'work', confidence: 1 }],
        },
        {
          nameAsWritten: 'Katarzyna N.',
          entries: [{ date: '2026-11-03', rawCell: 'X', kind: 'work', confidence: 1 }],
        },
      ],
    });
    const n = normalizeSchedule(parsed, { today: '2026-11-04', people: persons });
    const d = initialDecisions(n);
    expect(blockers(n, d).duplicate.sort()).toEqual(['r0', 'r1']);
    d.persons.r1 = { mode: 'new', firstName: 'Katarzyna', lastName: 'N.' };
    expect(blockers(n, d).duplicate).toEqual([]);
    expect(kasia.id).toBeTruthy();
  });

  it('sprzeczne wpisy (dwie strony) wymagają wyboru; wybór zmienia wynik', async () => {
    const { persons } = await setup();
    const n = norm('twoPages', persons);
    const d = initialDecisions(n);
    expect(blockers(n, d).entryConflicts).toEqual(['r0']);
    d.entryChoice['r0|2026-11-03'] = 'second';
    expect(blockers(n, d).entryConflicts).toEqual([]);
    const e = resolveEntries(n.persons[0]!, d).find((x) => x.date === '2026-11-03')!;
    expect([e.start, e.end]).toEqual(['12:00', '20:00']);
    d.entryChoice['r0|2026-11-03'] = 'first';
    const e2 = resolveEntries(n.persons[0]!, d).find((x) => x.date === '2026-11-03')!;
    expect(e2.start).toBe('10:00');
  });

  it('niepoprawne godziny (początek = koniec) blokują, edycja odblokowuje', async () => {
    const { persons } = await setup();
    const n = norm('standard', persons);
    const d = initialDecisions(n);
    d.persons.r2 = { mode: 'skip' };
    const id = n.persons[0]!.entries[0]!.id;
    d.entryEdits[id] = { start: '10:00', end: '10:00' };
    expect(blockers(n, d).invalid).toEqual(['r0']);
    d.entryEdits[id] = { start: '10:00', end: '16:00', usesDefaultHours: false };
    expect(blockers(n, d).invalid).toEqual([]);
  });

  it('edycja i usunięcie wpisu, zmiana typu czyści godziny, przesunięcie okresu', async () => {
    const { persons } = await setup();
    const n = norm('standard', persons);
    const d = initialDecisions(n);
    const p = n.persons[0]!;
    d.entryEdits[p.entries[0]!.id] = { removed: true };
    d.entryEdits[p.entries[1]!.id] = { kind: 'off' };
    d.periodShift = { years: 0, months: 1 };
    const r = resolveEntries(p, d);
    expect(r).toHaveLength(4);
    expect(r[0]!.date).toBe('2026-12-03'); // 3.11 + 1 miesiąc
    expect(r[0]).toMatchObject({
      kind: 'off',
      start: undefined,
      end: undefined,
      usesDefaultHours: false,
    });
  });
});

describe('plan importu', () => {
  it('buduje zmiany source=ai z batchId, aliasy i nowe osoby', async () => {
    const { persons, ctx } = await setup();
    const n = norm('standard', persons);
    const d = initialDecisions(n);
    d.persons.r2 = { mode: 'new', firstName: 'Łukasz', lastName: 'Kowalski' };
    const plan = buildImportPlan(n, d, ctx());
    expect(plan.newPersons).toHaveLength(1);
    expect(plan.newPersons[0]).toMatchObject({
      firstName: 'Łukasz',
      lastName: 'Kowalski',
      color: 'orange',
    });
    expect(plan.shifts).toHaveLength(5 + 4 + 4);
    expect(plan.shifts.every((s) => s.source === 'ai' && s.importBatchId === 'b1')).toBe(true);
    // alias „Kasia” i „Basia” już znane → bez zmian
    expect(plan.aliasUpdates).toEqual([]);
    const fri = plan.shifts.find((s) => s.date === '2026-11-06')!;
    expect([fri.start, fri.end, fri.usesDefaultHours]).toEqual(['10:00', '23:00', true]);
    const off = plan.shifts.find((s) => s.kind === 'off')!;
    expect(off.start).toBeUndefined();
  });

  it('pominięta osoba nie trafia do importu; nieznany zapis → nowy alias', async () => {
    const { persons, kasia, ctx } = await setup();
    const parsed = parsedScheduleSchema.parse({
      period: { month: 11, year: 2026 },
      people: [
        {
          nameAsWritten: 'Kasieńka',
          entries: [{ date: '2026-11-02', rawCell: 'X', kind: 'work', confidence: 1 }],
        },
        {
          nameAsWritten: 'Ktoś',
          entries: [{ date: '2026-11-02', rawCell: 'X', kind: 'work', confidence: 1 }],
        },
      ],
    });
    const n = normalizeSchedule(parsed, { today: '2026-11-04', people: persons });
    const d = initialDecisions(n);
    d.persons.r0 = { mode: 'existing', personId: kasia.id, confirmed: true };
    d.persons.r1 = { mode: 'skip' };
    const plan = buildImportPlan(n, d, ctx());
    expect(plan.aliasUpdates).toEqual([{ personId: kasia.id, alias: 'Kasieńka' }]);
    expect(plan.shifts).toHaveLength(1);
    expect(plan.skippedPeople).toEqual(['Ktoś']);
  });

  it('polityka kolizji: zastąp / pomiń / pytaj dla każdej', () => {
    const base = {
      persons: {},
      entryEdits: {},
      entryChoice: {},
      periodShift: { years: 0, months: 0 },
    };
    const s = { personId: 'a', date: '2026-11-02' } as Shift;
    const mk = (
      conflictMode: ImportDecisions['conflictMode'],
      perConflict = {},
    ): ImportDecisions => ({ ...base, conflictMode, perConflict });
    expect(conflictPolicy(mk('replace'))(s)).toBe('replace');
    expect(conflictPolicy(mk('skip'))(s)).toBe('skip');
    expect(conflictPolicy(mk('ask'))(s)).toBe('skip');
    expect(conflictPolicy(mk('ask', { 'a|2026-11-02': 'replace' }))(s)).toBe('replace');
  });
});

describe('zapis importu i wycofanie (E-24)', () => {
  const batchMeta = (id: string) => ({
    id,
    createdAt: 1,
    model: 'gemini-flash-latest',
    promptVersion: '1',
    imageThumb: 'data:x',
  });

  it('import → wycofanie przywraca stan sprzed 1:1, także zastąpione zmiany', async () => {
    const { db, repos, kasia, persons, ctx } = await setup();
    // stan sprzed: Kasia ma 2.11 własne godziny 12–18
    const before: Shift = {
      id: uuid(),
      personId: kasia.id,
      date: '2026-11-02',
      kind: 'work',
      start: '12:00',
      end: '18:00',
      usesDefaultHours: false,
      source: 'manual',
      updatedAt: 1,
    };
    await repos.shifts.addMany([before]);
    const snapshot = JSON.stringify(
      (await db.shifts.toArray()).sort((a, b) => a.id.localeCompare(b.id)),
    );

    const n = norm('standard', persons);
    const d = initialDecisions(n);
    d.persons.r2 = { mode: 'skip' };
    d.conflictMode = 'replace';
    const existing = await repos.shifts.range('2026-11-01', '2026-11-30');
    const plan = buildImportPlan(n, d, ctx(existing, 'b1'));
    expect(plan.conflicts).toHaveLength(1);

    const res = await repos.imports.apply({
      batch: batchMeta('b1'),
      newPersons: plan.newPersons,
      aliasUpdates: plan.aliasUpdates,
      shifts: plan.shifts,
      choose: conflictPolicy(d),
    });
    expect(res).toMatchObject({ added: 9, replaced: 1, skipped: 0 });
    const active = await repos.shifts.range('2026-11-01', '2026-11-30');
    expect(active).toHaveLength(9);
    expect(active.find((s) => s.personId === kasia.id && s.date === '2026-11-02')!.start).toBe(
      '10:00',
    );

    const rev = await repos.imports.revert('b1');
    expect(rev).toEqual({ removed: 9, restored: 1, notRestored: 0 });
    const after = (await repos.shifts.range('2026-11-01', '2026-11-30')).sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(before.id);
    expect(after[0]!.start).toBe('12:00');
    expect(snapshot).toContain(before.id);
    // drugie wycofanie nic nie robi
    expect(await repos.imports.revert('b1')).toEqual({ removed: 0, restored: 0, notRestored: 0 });
    expect((await repos.imports.list())[0]!.revertedAt).toBeTruthy();
  });

  it('tryb „pomiń”: kolidujące zostają, reszta dochodzi', async () => {
    const { repos, kasia, persons, ctx } = await setup();
    await repos.shifts.addMany([
      {
        id: uuid(),
        personId: kasia.id,
        date: '2026-11-03',
        kind: 'work',
        start: '12:00',
        end: '18:00',
        usesDefaultHours: false,
        source: 'manual',
        updatedAt: 1,
      },
    ]);
    const n = norm('standard', persons);
    const d = initialDecisions(n);
    d.persons.r2 = { mode: 'skip' };
    d.conflictMode = 'skip';
    const plan = buildImportPlan(n, d, ctx(await repos.shifts.range('2026-11-01', '2026-11-30')));
    const res = await repos.imports.apply({
      batch: batchMeta('b2'),
      ...plan,
      choose: conflictPolicy(d),
    });
    expect(res).toMatchObject({ added: 8, skipped: 1, replaced: 0 });
    const kept = (await repos.shifts.range('2026-11-03', '2026-11-03')).find(
      (s) => s.personId === kasia.id,
    )!;
    expect(kept.start).toBe('12:00');
  });

  it('nowe osoby i aliasy zapisują się w tej samej transakcji; przy kolejnym imporcie dopasowanie jest automatyczne', async () => {
    const { repos, kasia } = await setup();
    const persons = await repos.persons.list();
    const parsed = parsedScheduleSchema.parse({
      period: { month: 11, year: 2026 },
      people: [
        {
          nameAsWritten: 'Kasieńka',
          entries: [{ date: '2026-11-02', rawCell: 'X', kind: 'work', confidence: 1 }],
        },
        {
          nameAsWritten: 'Zdzisia',
          entries: [{ date: '2026-11-02', rawCell: 'X', kind: 'work', confidence: 1 }],
        },
      ],
    });
    const n = normalizeSchedule(parsed, { today: '2026-11-04', people: persons });
    const d = initialDecisions(n);
    d.persons.r0 = { mode: 'existing', personId: kasia.id, confirmed: true };
    d.persons.r1 = { mode: 'new', firstName: 'Zdzisława' };
    const plan = buildImportPlan(n, d, {
      persons,
      existing: [],
      newId: () => uuid(),
      now: 1,
      batchId: 'b3',
      pickColor: nextColor,
    });
    await repos.imports.apply({ batch: batchMeta('b3'), ...plan, choose: () => 'skip' });

    const people = await repos.persons.list();
    expect(people.map((p) => p.firstName)).toContain('Zdzisława');
    expect(people.find((p) => p.id === kasia.id)!.aliases).toEqual(['Kasia', 'Kasieńka']);
    // następny import tego samego zapisu → dopasowanie przez alias, bez pytania
    const again = normalizeSchedule(parsed, { today: '2026-11-04', people });
    expect(again.persons[0]).toMatchObject({
      status: 'matched',
      match: { how: 'alias', personId: kasia.id },
    });
  });

  it('szkic weryfikacji: zapis, odczyt i usunięcie (P-12)', async () => {
    const { repos } = await setup();
    expect(await repos.imports.getDraft()).toBeUndefined();
    await repos.imports.saveDraft({
      id: 'current',
      createdAt: 5,
      parsed: { a: 1 },
      decisions: { b: 2 },
      imageThumb: 'data:y',
    });
    expect((await repos.imports.getDraft())!.createdAt).toBe(5);
    await repos.imports.clearDraft();
    expect(await repos.imports.getDraft()).toBeUndefined();
  });
});
