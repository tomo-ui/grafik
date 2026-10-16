import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  buildShifts,
  datesBetween,
  describeDefaults,
  quickDates,
  repeatWeekly,
  validateForm,
  type ShiftFormInput,
} from '../../src/domain/shiftForm';
import { DEFAULT_HOURS } from '../../src/domain/hours';
import { formatDayLong, formatMonth } from '../../src/domain/i18n';
import { findConflicts } from '../../src/domain/conflicts';
import { GrafikDB, uuid } from '../../src/db/db';
import { createRepos } from '../../src/db/repos';

const base: ShiftFormInput = {
  personIds: ['a', 'b'],
  dates: ['2026-11-02', '2026-11-06', '2026-11-08'],
  kind: 'work',
  useDefault: true,
  start: '10:00',
  end: '22:00',
  note: '',
};
let n = 0;
const id = () => `id${++n}`;

describe('validateForm', () => {
  it('wymaga osób i dni', () => {
    expect(validateForm({ ...base, personIds: [] })).toMatchObject({ ok: false });
    expect(validateForm({ ...base, dates: [] })).toMatchObject({ ok: false });
  });
  it('koniec = początek to błąd (E-05) — tylko dla własnych godzin', () => {
    const r = validateForm({ ...base, useDefault: false, start: '10:00', end: '10:00' });
    expect(r.ok).toBe(false);
    expect(validateForm({ ...base, useDefault: true, start: '10:00', end: '10:00' }).ok).toBe(true);
  });
  it('po północy daje ostrzeżenie (E-04)', () => {
    const r = validateForm({ ...base, useDefault: false, start: '18:00', end: '02:00' });
    expect(r.ok && r.warnings[0]).toMatch(/\+1 dzień/);
  });
  it('liczy osoby × dni', () => {
    const r = validateForm(base);
    expect(r.ok && r.count).toBe(6);
  });
});

describe('buildShifts', () => {
  it('piątek 10–23, niedziela 10–22, flaga domyślne (E-01, E-02)', () => {
    const s = buildShifts(base, DEFAULT_HOURS, id, 1);
    expect(s).toHaveLength(6);
    const fri = s.find((x) => x.date === '2026-11-06' && x.personId === 'a')!;
    const sun = s.find((x) => x.date === '2026-11-08' && x.personId === 'b')!;
    expect([fri.start, fri.end, fri.usesDefaultHours]).toEqual(['10:00', '23:00', true]);
    expect([sun.start, sun.end]).toEqual(['10:00', '22:00']);
  });
  it('własne godziny: flaga false, wszystkie takie same', () => {
    const s = buildShifts(
      { ...base, useDefault: false, start: '12:00', end: '18:00' },
      DEFAULT_HOURS,
      id,
      1,
    );
    expect(s.every((x) => x.start === '12:00' && x.end === '18:00' && !x.usesDefaultHours)).toBe(
      true,
    );
  });
  it('wolne/urlop/L4 bez godzin, z notatką', () => {
    const s = buildShifts({ ...base, kind: 'vacation', note: ' Urlop ' }, DEFAULT_HOURS, id, 1);
    expect(s.every((x) => x.kind === 'vacation' && !x.start && x.note === 'Urlop')).toBe(true);
  });
  it('deduplikuje powtórzone dni i sortuje', () => {
    const s = buildShifts(
      { ...base, personIds: ['a'], dates: ['2026-11-03', '2026-11-02', '2026-11-03'] },
      DEFAULT_HOURS,
      id,
      1,
    );
    expect(s.map((x) => x.date)).toEqual(['2026-11-02', '2026-11-03']);
  });
  it('rzuca przy niepoprawnym formularzu', () => {
    expect(() => buildShifts({ ...base, personIds: [] }, DEFAULT_HOURS, id, 1)).toThrow();
  });
});

describe('szybkie zaznaczenia', () => {
  it('cały tydzień od poniedziałku i od niedzieli', () => {
    expect(quickDates('week', '2026-11-04', 1)).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ]);
    expect(quickDates('week', '2026-11-04', 0)[0]).toBe('2026-11-01');
  });
  it('Pn–Pt i weekend', () => {
    expect(quickDates('workdays', '2026-11-04', 1)).toHaveLength(5);
    expect(quickDates('weekend', '2026-11-04', 1)).toEqual(['2026-11-07', '2026-11-08']);
  });
  it('powtarzanie co tydzień do daty, przez zmianę roku', () => {
    expect(repeatWeekly(['2026-12-28', '2026-12-30'], '2027-01-12')).toEqual([
      '2026-12-28',
      '2026-12-30',
      '2027-01-04',
      '2027-01-06',
      '2027-01-11',
    ]);
  });
  it('zakres dat w dowolnej kolejności', () => {
    expect(datesBetween('2026-11-03', '2026-11-01')).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
    ]);
    expect(datesBetween('2026-02-27', '2026-03-01')).toHaveLength(3);
  });
});

describe('opis godzin domyślnych', () => {
  it('standardowy podział', () => {
    expect(describeDefaults(DEFAULT_HOURS)).toBe('Pt–Sb 10:00–23:00, pozostałe 10:00–22:00');
  });
  it('jednakowe godziny', () => {
    const all = Object.fromEntries(
      [0, 1, 2, 3, 4, 5, 6].map((d) => [d, { start: '09:00', end: '17:00' }]),
    );
    expect(describeDefaults(all as typeof DEFAULT_HOURS)).toBe('Codziennie 09:00–17:00');
  });
});

describe('formaty dat po polsku', () => {
  it('dzień i miesiąc', () => {
    expect(formatDayLong('2026-11-03')).toBe('wtorek, 3 listopada');
    expect(formatMonth('2026-11-03')).toBe('listopad 2026');
  });
});

describe('zapis z kolizjami i Cofnij (E-03)', () => {
  it('pomiń/zastąp oraz undoAdd przywraca stan sprzed', async () => {
    const db = new GrafikDB(`t-${uuid()}`);
    const repos = createRepos(db);
    const a = await repos.persons.create({ firstName: 'Ania', color: 'blue' });
    const b = await repos.persons.create({ firstName: 'Basia', color: 'green' });
    const form = { ...base, personIds: [a.id, b.id], dates: ['2026-11-02', '2026-11-03'] };

    const first = buildShifts(
      { ...form, personIds: [a.id], dates: ['2026-11-02'] },
      DEFAULT_HOURS,
      uuid,
      1,
    );
    await repos.shifts.addMany(first);

    const incoming = buildShifts(form, DEFAULT_HOURS, uuid, 2);
    const existing = await repos.shifts.range('2026-11-01', '2026-11-30');
    expect(findConflicts(existing, incoming)).toHaveLength(1);

    const skip = await repos.shifts.addMany(incoming, 'skip');
    expect(skip.added).toHaveLength(3);
    expect(skip.skipped).toHaveLength(1);
    await repos.shifts.undoAdd(skip.added, skip.replaced);
    expect(await repos.shifts.range('2026-11-01', '2026-11-30')).toHaveLength(1);

    const rep = await repos.shifts.addMany(buildShifts(form, DEFAULT_HOURS, uuid, 3), 'replace');
    expect(rep.added).toHaveLength(4);
    expect(rep.replaced).toHaveLength(1);
    await repos.shifts.undoAdd(rep.added, rep.replaced);
    const after = await repos.shifts.range('2026-11-01', '2026-11-30');
    expect(after.map((s) => s.id)).toEqual([first[0]!.id]);
  });
});
