import { checkTimes } from './hours';
import type { ISODate, Shift } from './types';

/** Jedna funkcja sum dla widoku zespołu, „Mojego grafiku” i PDF (wymóg audytu 16.2). */
export function shiftWorkMinutes(s: Shift): number {
  if (s.deletedAt || s.kind !== 'work' || !s.start || !s.end) return 0;
  const r = checkTimes(s.start, s.end);
  return r.ok ? r.minutes : 0;
}

export function inRange(date: ISODate, from?: ISODate, to?: ISODate): boolean {
  return (!from || date >= from) && (!to || date <= to);
}

export function sumMinutes(
  shifts: Shift[],
  opts: { personId?: string; from?: ISODate; to?: ISODate } = {},
): number {
  let total = 0;
  for (const s of shifts) {
    if (opts.personId && s.personId !== opts.personId) continue;
    if (!inRange(s.date, opts.from, opts.to)) continue;
    total += shiftWorkMinutes(s);
  }
  return total;
}

export function totalsByPerson(shifts: Shift[], from?: ISODate, to?: ISODate): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of shifts) {
    if (!inRange(s.date, from, to)) continue;
    const m = shiftWorkMinutes(s);
    if (m > 0) out.set(s.personId, (out.get(s.personId) ?? 0) + m);
  }
  return out;
}

/** Obsada: liczba osób z aktywną zmianą pracy danego dnia. */
export function staffingByDay(shifts: Shift[], from?: ISODate, to?: ISODate): Map<ISODate, number> {
  const people = new Map<ISODate, Set<string>>();
  for (const s of shifts) {
    if (s.deletedAt || s.kind !== 'work' || !inRange(s.date, from, to)) continue;
    let set = people.get(s.date);
    if (!set) people.set(s.date, (set = new Set()));
    set.add(s.personId);
  }
  return new Map([...people].map(([d, set]) => [d, set.size]));
}
