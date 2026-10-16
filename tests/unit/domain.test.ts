import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addDays,
  daysInMonth,
  diffDays,
  fromISODate,
  isValidISODate,
  monthDays,
  todayISO,
  toISODate,
  weekdayOf,
  weekDays,
} from '../../src/domain/dates';
import { formatHours, plural, PEOPLE, SHIFTS } from '../../src/domain/i18n';
import {
  checkTimes,
  DEFAULT_HOURS,
  defaultMinutesFor,
  normalizeTimeInput,
  parseHHMM,
  shiftMinutes,
  shiftsUsingDefaults,
  withDefaultHours,
} from '../../src/domain/hours';
import { staffingByDay, sumMinutes, totalsByPerson } from '../../src/domain/totals';
import { findConflicts, findDuplicates } from '../../src/domain/conflicts';
import type { Shift } from '../../src/domain/types';

const shift = (p: Partial<Shift> & Pick<Shift, 'personId' | 'date'>): Shift => ({
  id: crypto.randomUUID(),
  kind: 'work',
  start: '10:00',
  end: '22:00',
  usesDefaultHours: true,
  source: 'manual',
  updatedAt: 0,
  ...p,
});

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe('godziny domyślne (E-01, E-02)', () => {
  it('każdy dzień tygodnia: Nd–Czw 12 h, Pt–Sb 13 h — na pełny miesiąc', () => {
    for (const date of monthDays(2026, 11)) {
      const wd = weekdayOf(date);
      const expected = wd === 5 || wd === 6 ? 13 * 60 : 12 * 60;
      expect(defaultMinutesFor(date), date).toBe(expected);
    }
  });

  it('piątek 10:00–23:00, niedziela 10:00–22:00', () => {
    expect(DEFAULT_HOURS[5]).toEqual({ start: '10:00', end: '23:00' });
    expect(DEFAULT_HOURS[0]).toEqual({ start: '10:00', end: '22:00' });
    expect(weekdayOf('2026-11-06')).toBe(5);
    expect(weekdayOf('2026-11-08')).toBe(0);
  });
});

describe('checkTimes (E-04, E-05, P-20, P-23)', () => {
  it('zwykła zmiana', () => {
    expect(checkTimes('10:00', '22:00')).toEqual({
      ok: true,
      minutes: 720,
      crossesMidnight: false,
    });
  });
  it('po północy 18:00–02:00 = 8 h z flagą +1 dzień', () => {
    expect(checkTimes('18:00', '02:00')).toEqual({ ok: true, minutes: 480, crossesMidnight: true });
  });
  it('koniec = początek to błąd', () => {
    expect(checkTimes('10:00', '10:00').ok).toBe(false);
  });
  it('niepoprawne godziny', () => {
    expect(checkTimes('25:00', '10:00').ok).toBe(false);
    expect(checkTimes('10:60', '11:00').ok).toBe(false);
    expect(checkTimes('abc', '11:00').ok).toBe(false);
  });
  it('parseHHMM i obcinanie sekund', () => {
    expect(parseHHMM('9:05')).toBe(545);
    expect(parseHHMM('10:00:00')).toBeNull();
    expect(normalizeTimeInput('10:00:00')).toBe('10:00');
    expect(() => shiftMinutes('x', 'y')).toThrow();
  });
});

describe('plural i formaty (pl-PL)', () => {
  const cases: [number, string][] = [
    [0, '0 zmian'],
    [1, '1 zmiana'],
    [2, '2 zmiany'],
    [4, '4 zmiany'],
    [5, '5 zmian'],
    [12, '12 zmian'],
    [21, '21 zmian'],
    [22, '22 zmiany'],
    [25, '25 zmian'],
    [112, '112 zmian'],
  ];
  it.each(cases)('%i → %s', (n, expected) => {
    expect(plural(n, SHIFTS)).toBe(expected);
  });
  it('osoby', () => {
    expect(plural(1, PEOPLE)).toBe('1 osoba');
    expect(plural(3, PEOPLE)).toBe('3 osoby');
    expect(plural(5, PEOPLE)).toBe('5 osób');
  });
  it('godziny z przecinkiem', () => {
    expect(formatHours(750)).toBe('12,5 h');
    expect(formatHours(720)).toBe('12 h');
  });
});

describe('daty (P-04, E-09..E-12)', () => {
  it('odrzuca niepoprawne daty', () => {
    expect(isValidISODate('2026-11-31')).toBe(false);
    expect(isValidISODate('2026-02-29')).toBe(false);
    expect(isValidISODate('2028-02-29')).toBe(true);
    expect(() => fromISODate('2026-13-01')).toThrow();
  });
  it('luty 2027 i 2028 (przestępny)', () => {
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(monthDays(2028, 2)).toHaveLength(29);
  });
  it('tydzień 28.12–03.01 ma poprawne lata', () => {
    const w = weekDays('2026-12-30', 1);
    expect(w[0]).toBe('2026-12-28');
    expect(w[6]).toBe('2027-01-03');
  });
  it('tydzień od niedzieli', () => {
    expect(weekDays('2026-11-04', 0)[0]).toBe('2026-11-01');
  });
  it('addDays i diffDays przez zmianę czasu 25.10.2026 i 28.03.2027', () => {
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2027-03-27', 2)).toBe('2027-03-29');
    expect(diffDays('2026-10-24', '2026-10-27')).toBe(3);
  });

  const zones = ['Europe/Warsaw', 'America/New_York', 'Pacific/Auckland', 'UTC'];
  describe.each(zones)('strefa %s', (tz) => {
    it('„dziś” o 23:30 i 00:30 czasu lokalnego', () => {
      process.env.TZ = tz;
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 10, 3, 23, 30)); // lokalnie
      expect(todayISO()).toBe('2026-11-03');
      vi.setSystemTime(new Date(2026, 10, 4, 0, 30));
      expect(todayISO()).toBe('2026-11-04');
    });
    it('round-trip toISODate(fromISODate(x)) i dzień tygodnia', () => {
      process.env.TZ = tz;
      for (const d of ['2026-10-25', '2027-03-28', '2026-12-31', '2028-02-29']) {
        expect(toISODate(fromISODate(d))).toBe(d);
      }
      expect(weekdayOf('2026-11-03')).toBe(2); // wtorek
    });
    it('sumy przez zmianę czasu bez odchyleń (E-10, P-23)', () => {
      process.env.TZ = tz;
      const shifts = monthDays(2026, 10).map((date) => shift({ personId: 'a', date }));
      const total = sumMinutes(shifts, { personId: 'a' });
      // 31 dni po 12 h, Pt/Sb po 13 h
      const fri = monthDays(2026, 10).filter((d) => [5, 6].includes(weekdayOf(d))).length;
      expect(total).toBe(31 * 720);
      expect(fri).toBeGreaterThan(0);
    });
  });
});

describe('sumy i obsada', () => {
  const shifts = [
    shift({ personId: 'a', date: '2026-11-02' }),
    shift({ personId: 'a', date: '2026-11-03', start: '10:00', end: '16:30' }),
    shift({
      personId: 'a',
      date: '2026-11-04',
      kind: 'vacation',
      start: undefined,
      end: undefined,
    }),
    shift({ personId: 'b', date: '2026-11-02' }),
    shift({ personId: 'b', date: '2026-11-03', deletedAt: 1 }),
    shift({ personId: 'a', date: '2026-12-01' }),
  ];
  it('liczy tylko pracę, bez usuniętych i urlopów', () => {
    expect(sumMinutes(shifts, { personId: 'a', from: '2026-11-01', to: '2026-11-30' })).toBe(
      720 + 390,
    );
    expect(sumMinutes(shifts, { personId: 'b' })).toBe(720);
  });
  it('totalsByPerson zgadza się z sumMinutes', () => {
    const m = totalsByPerson(shifts, '2026-11-01', '2026-11-30');
    expect(m.get('a')).toBe(
      sumMinutes(shifts, { personId: 'a', from: '2026-11-01', to: '2026-11-30' }),
    );
    expect(m.get('b')).toBe(720);
  });
  it('obsada per dzień', () => {
    const s = staffingByDay(shifts, '2026-11-01', '2026-11-30');
    expect(s.get('2026-11-02')).toBe(2);
    expect(s.get('2026-11-03')).toBe(1);
    expect(s.has('2026-11-04')).toBe(false);
  });
});

describe('konflikty', () => {
  const existing = [
    shift({ personId: 'a', date: '2026-11-02' }),
    shift({ personId: 'a', date: '2026-11-03', deletedAt: 5 }),
  ];
  it('znajduje kolizje, ignoruje usunięte', () => {
    const c = findConflicts(existing, [
      { personId: 'a', date: '2026-11-02' },
      { personId: 'a', date: '2026-11-03' },
      { personId: 'b', date: '2026-11-02' },
    ]);
    expect(c).toHaveLength(1);
    expect(c[0]?.incoming.date).toBe('2026-11-02');
  });
  it('duplikaty we wsadzie', () => {
    const d = findDuplicates([
      { personId: 'a', date: '1' },
      { personId: 'a', date: '1' },
      { personId: 'a', date: '2' },
    ]);
    expect(d).toHaveLength(1);
  });
});

describe('aktualizacja godzin domyślnych', () => {
  it('obejmuje tylko przyszłe zmiany z flagą', () => {
    const list = [
      shift({ personId: 'a', date: '2026-10-01' }),
      shift({ personId: 'a', date: '2026-11-10' }),
      shift({ personId: 'a', date: '2026-11-11', usesDefaultHours: false }),
      shift({ personId: 'a', date: '2026-11-12', deletedAt: 1 }),
    ];
    const affected = shiftsUsingDefaults(list, '2026-11-01');
    expect(affected.map((s) => s.date)).toEqual(['2026-11-10']);
    const updated = withDefaultHours(affected[0]!, {
      ...DEFAULT_HOURS,
      2: { start: '09:00', end: '21:00' },
    });
    expect(updated.start).toBe('09:00'); // 2026-11-10 to wtorek
  });
});
