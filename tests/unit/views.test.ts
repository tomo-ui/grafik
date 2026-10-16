import { describe, expect, it } from 'vitest';
import {
  coworkersOn,
  dotsForDay,
  formatWeekRange,
  groupByWeek,
  monthSummary,
  nextShift,
  periodOf,
  relativeDay,
  shiftPeriod,
} from '../../src/domain/views';
import { shiftWorkMinutes } from '../../src/domain/totals';
import type { Shift } from '../../src/domain/types';

const mk = (personId: string, date: string, p: Partial<Shift> = {}): Shift => ({
  id: `${personId}-${date}-${p.start ?? ''}`,
  personId,
  date,
  kind: 'work',
  start: '10:00',
  end: '22:00',
  usesDefaultHours: true,
  source: 'manual',
  updatedAt: 0,
  ...p,
});

describe('nextShift', () => {
  const shifts = [
    mk('a', '2026-11-03'),
    mk('a', '2026-11-04'),
    mk('a', '2026-11-06', { start: '10:00', end: '23:00' }),
    mk('b', '2026-11-04'),
    mk('a', '2026-11-05', { kind: 'off', start: undefined, end: undefined }),
    mk('a', '2026-11-07', { deletedAt: 1 }),
  ];
  it('wczorajsza zmiana jest pomijana', () => {
    expect(nextShift(shifts, 'a', '2026-11-04', 9 * 60)?.date).toBe('2026-11-04');
  });
  it('dzisiejsza trwa do końca, potem następna', () => {
    expect(nextShift(shifts, 'a', '2026-11-04', 21 * 60 + 59)?.date).toBe('2026-11-04');
    expect(nextShift(shifts, 'a', '2026-11-04', 22 * 60)?.date).toBe('2026-11-06');
  });
  it('pomija wolne i usunięte; null gdy brak', () => {
    expect(nextShift(shifts, 'a', '2026-11-07', 0)).toBeNull();
    expect(nextShift(shifts, 'zz', '2026-11-01', 0)).toBeNull();
  });
  it('zmiana po północy dziś jeszcze się nie skończyła', () => {
    const night = [mk('a', '2026-11-04', { start: '18:00', end: '02:00' })];
    expect(nextShift(night, 'a', '2026-11-04', 23 * 60)?.date).toBe('2026-11-04');
  });
});

describe('relativeDay', () => {
  it.each([
    ['2026-11-04', 'dziś'],
    ['2026-11-05', 'jutro'],
    ['2026-11-06', 'za 2 dni'],
    ['2026-11-30', 'za 26 dni'],
    ['2026-11-03', 'wczoraj'],
  ])('%s → %s', (d, expected) => expect(relativeDay(d, '2026-11-04')).toBe(expected));
});

describe('coworkersOn / monthSummary', () => {
  const shifts = [
    mk('a', '2026-11-04'),
    mk('b', '2026-11-04'),
    mk('c', '2026-11-04', { kind: 'vacation', start: undefined, end: undefined }),
    mk('a', '2026-11-05', { start: '10:00', end: '16:30' }),
    mk('a', '2026-11-06', { kind: 'off', start: undefined, end: undefined }),
    mk('a', '2026-12-01'),
  ];
  it('współpracownicy tylko w pracy', () => {
    expect(coworkersOn(shifts, shifts[0]!)).toEqual(['b']);
  });
  it('podsumowanie miesiąca', () => {
    expect(monthSummary(shifts, 'a', '2026-11-01', '2026-11-30', shiftWorkMinutes)).toEqual({
      shifts: 2,
      minutes: 720 + 390,
      off: 1,
    });
  });
});

describe('groupByWeek i zakresy', () => {
  const today = '2026-11-04'; // środa
  const shifts = [
    mk('a', '2026-11-03'), // przeszłość
    mk('a', '2026-11-04'),
    mk('a', '2026-11-08'),
    mk('a', '2026-11-10'),
    mk('a', '2026-11-25'),
  ];
  it('Ten tydzień / Następny tydzień / zakres', () => {
    const g = groupByWeek(shifts, today, 1);
    expect(g.map((x) => x.label)).toEqual(['Ten tydzień', 'Następny tydzień', '23–29 listopada']);
    expect(g[0]!.shifts.map((s) => s.date)).toEqual(['2026-11-04', '2026-11-08']);
  });
  it('tydzień od niedzieli przesuwa niedzielę do następnego tygodnia', () => {
    const g = groupByWeek(shifts, today, 0);
    expect(g[0]!.shifts.map((s) => s.date)).toEqual(['2026-11-04']);
    expect(g[1]!.label).toBe('Następny tydzień');
  });
  it('zakres przez granicę miesiąca i roku (E-12)', () => {
    expect(formatWeekRange('2026-12-28', '2027-01-03')).toBe('28 grudnia – 3 stycznia');
    expect(formatWeekRange('2026-11-02', '2026-11-08')).toBe('2–8 listopada');
  });
});

describe('okres, nawigacja, kropki', () => {
  it('periodOf: tydzień 28.12–03.01 i luty 2028', () => {
    const w = periodOf('2026-12-30', 'week', 1);
    expect([w.from, w.to, w.days.length]).toEqual(['2026-12-28', '2027-01-03', 7]);
    const m = periodOf('2028-02-01', 'month', 1);
    expect(m.days).toHaveLength(29);
    expect(m.label).toBe('luty 2028');
  });
  it('shiftPeriod', () => {
    expect(shiftPeriod('2026-12-30', 'week', 1)).toBe('2027-01-06');
    expect(shiftPeriod('2026-12-01', 'month', 1)).toBe('2027-01-01');
    expect(shiftPeriod('2026-01-01', 'month', -1)).toBe('2025-12-01');
  });
  it('kropki: max 4 + reszta', () => {
    const people = new Map(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => [id, { color: i % 2 ? 'red' : 'blue' }]),
    );
    const shifts = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => mk(id, '2026-11-04'));
    const dots = dotsForDay(shifts, people, '2026-11-04');
    expect(dots.colors).toHaveLength(4);
    expect(dots.extra).toBe(2);
    expect(dotsForDay(shifts, people, '2026-11-05')).toEqual({ colors: [], extra: 0 });
  });
});
