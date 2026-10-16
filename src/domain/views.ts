import { addDays, diffDays, monthDays, weekDays } from './dates';
import { formatDayLong, formatMonth } from './i18n';
import { parseHHMM } from './hours';
import { colorVar } from './people';
import type { ISODate, Person, Shift } from './types';

const active = (s: Shift) => !s.deletedAt;

/* ---------- Mój grafik ---------- */

/** Czy zmiana pracy już się skończyła względem (data, minuty od północy)? Zmiany po północy kończą się dnia następnego. */
function hasEnded(s: Shift, today: ISODate, nowMin: number): boolean {
  if (s.date < today) return true; // zmiany sprzed dziś (te po północy z wczoraj ignorujemy w „najbliższej”)
  if (s.date > today) return false;
  const start = parseHHMM(s.start ?? '');
  const end = parseHHMM(s.end ?? '');
  if (start === null || end === null) return false;
  if (end <= start) return false; // kończy się jutro — dziś jeszcze trwa lub się nie zaczęła
  return end <= nowMin;
}

/** Najbliższa (lub trwająca) zmiana pracy osoby. */
export function nextShift(
  shifts: Shift[],
  personId: string,
  today: ISODate,
  nowMin: number,
): Shift | null {
  const list = shifts
    .filter((s) => active(s) && s.personId === personId && s.kind === 'work')
    .filter((s) => !hasEnded(s, today, nowMin))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? '').localeCompare(b.start ?? ''));
  return list[0] ?? null;
}

/** „dziś” / „jutro” / „za 3 dni”. */
export function relativeDay(date: ISODate, today: ISODate): string {
  const n = diffDays(today, date);
  if (n === 0) return 'dziś';
  if (n === 1) return 'jutro';
  if (n === -1) return 'wczoraj';
  if (n > 1) return `za ${n} dni`;
  return `${-n} dni temu`;
}

/** Osoby (poza `shift.personId`) pracujące tego samego dnia. */
export function coworkersOn(shifts: Shift[], shift: Shift): string[] {
  const ids = new Set<string>();
  for (const s of shifts) {
    if (active(s) && s.kind === 'work' && s.date === shift.date && s.personId !== shift.personId) {
      ids.add(s.personId);
    }
  }
  return [...ids];
}

export interface MonthSummary {
  shifts: number;
  minutes: number;
  off: number;
}

/** Podsumowanie miesiąca osoby: liczba zmian pracy, minuty pracy, liczba wolnych. */
export function monthSummary(
  shifts: Shift[],
  personId: string,
  from: ISODate,
  to: ISODate,
  minutesOf: (s: Shift) => number,
): MonthSummary {
  const out: MonthSummary = { shifts: 0, minutes: 0, off: 0 };
  for (const s of shifts) {
    if (!active(s) || s.personId !== personId || s.date < from || s.date > to) continue;
    if (s.kind === 'work') {
      out.shifts++;
      out.minutes += minutesOf(s);
    } else if (s.kind === 'off') out.off++;
  }
  return out;
}

/** „2–8 listopada” albo „28 grudnia – 3 stycznia”. */
export function formatWeekRange(start: ISODate, end: ISODate): string {
  const [, sm, sd] = start.split('-').map(Number) as [number, number, number];
  const [, em, ed] = end.split('-').map(Number) as [number, number, number];
  const monthName = (d: ISODate) => formatDayLong(d).split(' ').slice(-1)[0]!;
  return sm === em
    ? `${sd}–${ed} ${monthName(end)}`
    : `${sd} ${monthName(start)} – ${ed} ${monthName(end)}`;
}

export interface WeekGroup {
  key: ISODate;
  label: string;
  shifts: Shift[];
}

/** Nadchodzące zmiany (od `today`) pogrupowane po tygodniach: „Ten tydzień”, „Następny tydzień”, zakresy. */
export function groupByWeek(shifts: Shift[], today: ISODate, weekStartsOn: 0 | 1): WeekGroup[] {
  const thisWeek = weekDays(today, weekStartsOn)[0]!;
  const groups = new Map<ISODate, Shift[]>();
  for (const s of shifts) {
    if (!active(s) || s.date < today) continue;
    const key = weekDays(s.date, weekStartsOn)[0]!;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => {
      const diff = diffDays(thisWeek, key) / 7;
      const label =
        diff === 0
          ? 'Ten tydzień'
          : diff === 1
            ? 'Następny tydzień'
            : formatWeekRange(key, addDays(key, 6));
      return {
        key,
        label,
        shifts: list.sort((a, b) => a.date.localeCompare(b.date)),
      };
    });
}

/* ---------- Kalendarz ---------- */

export interface DayDots {
  colors: string[];
  extra: number;
}

/** Kropki osób w pracy danego dnia: max `max` kolorów + liczba pozostałych. */
export function dotsForDay(
  shifts: Shift[],
  personsById: Map<string, Pick<Person, 'color'>>,
  date: ISODate,
  max = 4,
): DayDots {
  const ids: string[] = [];
  for (const s of shifts) {
    if (active(s) && s.kind === 'work' && s.date === date && !ids.includes(s.personId)) {
      ids.push(s.personId);
    }
  }
  const colors = ids
    .map((id) => personsById.get(id)?.color)
    .filter((c): c is string => !!c)
    .map(colorVar);
  return { colors: colors.slice(0, max), extra: Math.max(0, colors.length - max) };
}

/** Przesunięcie okresu: tydzień ±7 dni, miesiąc ±1 (kotwica = pierwszy dzień miesiąca). */
export function shiftPeriod(anchor: ISODate, mode: 'week' | 'month', delta: number): ISODate {
  if (mode === 'week') return addDays(anchor, 7 * delta);
  const [y, m] = anchor.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`;
}

export type PeriodMode = 'week' | 'month';

export interface Period {
  mode: PeriodMode;
  from: ISODate;
  to: ISODate;
  days: ISODate[];
  label: string;
}

/** Dni i opis okresu (tydzień zawierający `anchor` albo miesiąc `anchor`). */
export function periodOf(anchor: ISODate, mode: PeriodMode, weekStartsOn: 0 | 1): Period {
  if (mode === 'week') {
    const days = weekDays(anchor, weekStartsOn);
    return {
      mode,
      from: days[0]!,
      to: days[6]!,
      days,
      label: formatWeekRange(days[0]!, days[6]!),
    };
  }
  const [y, m] = anchor.split('-').map(Number) as [number, number];
  const days = monthDays(y, m);
  return { mode, from: days[0]!, to: days[days.length - 1]!, days, label: formatMonth(anchor) };
}
