import { weekdayOf } from './dates';
import type { DefaultHours, HHMM, ISODate, Shift, Weekday } from './types';

export const DEFAULT_HOURS: DefaultHours = {
  0: { start: '10:00', end: '22:00' },
  1: { start: '10:00', end: '22:00' },
  2: { start: '10:00', end: '22:00' },
  3: { start: '10:00', end: '22:00' },
  4: { start: '10:00', end: '22:00' },
  5: { start: '10:00', end: '23:00' },
  6: { start: '10:00', end: '23:00' },
};

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** 'HH:MM' → minuty od północy; null dla niepoprawnego zapisu (P-20: sekundy są odrzucane wcześniej). */
export function parseHHMM(s: string): number | null {
  const m = HHMM_RE.exec(s.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function formatHHMM(minutes: number): HHMM {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Obcina sekundy z wartości `input type=time` (P-20): '10:00:00' → '10:00'. */
export function normalizeTimeInput(s: string): HHMM {
  return s.trim().slice(0, 5);
}

export type TimesCheck =
  { ok: true; minutes: number; crossesMidnight: boolean } | { ok: false; error: string };

/**
 * Walidacja i długość zmiany — arytmetyka minut (P-23), nie różnica obiektów Date.
 * end <= start = koniec następnego dnia; end == start to błąd.
 */
export function checkTimes(start: string, end: string): TimesCheck {
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (s === null || e === null) return { ok: false, error: 'Niepoprawna godzina.' };
  if (s === e) return { ok: false, error: 'Początek i koniec zmiany nie mogą być takie same.' };
  const crossesMidnight = e < s;
  return { ok: true, minutes: crossesMidnight ? 1440 - s + e : e - s, crossesMidnight };
}

/** Długość zmiany w minutach; rzuca przy niepoprawnych godzinach. */
export function shiftMinutes(start: HHMM, end: HHMM): number {
  const r = checkTimes(start, end);
  if (!r.ok) throw new Error(r.error);
  return r.minutes;
}

export function defaultHoursFor(date: ISODate, defaults: DefaultHours = DEFAULT_HOURS) {
  return defaults[weekdayOf(date)];
}

export function defaultMinutesFor(date: ISODate, defaults: DefaultHours = DEFAULT_HOURS): number {
  const h = defaultHoursFor(date, defaults);
  return shiftMinutes(h.start, h.end);
}

/** Zmiany z flagą „domyślne”, które można zaktualizować po zmianie ustawień (tylko przyszłe, nieusunięte). */
export function shiftsUsingDefaults(shifts: Shift[], fromDate: ISODate): Shift[] {
  return shifts.filter(
    (s) => !s.deletedAt && s.kind === 'work' && s.usesDefaultHours && s.date >= fromDate,
  );
}

export function withDefaultHours(shift: Shift, defaults: DefaultHours): Shift {
  const h = defaults[weekdayOf(shift.date) as Weekday];
  return { ...shift, start: h.start, end: h.end };
}
