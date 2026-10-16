import {
  addDays as fnsAddDays,
  format,
  getDay,
  getDaysInMonth,
  isValid,
  parse,
  startOfWeek,
} from 'date-fns';
import type { ISODate, Weekday } from './types';

const FMT = 'yyyy-MM-dd';
const RE = /^\d{4}-\d{2}-\d{2}$/;
// Referencja w południe: unikamy nieistniejącej północy przy zmianie czasu (DST)
const REF = new Date(2000, 0, 1, 12);

/** Data lokalna → 'YYYY-MM-DD' (nie UTC!). */
export function toISODate(d: Date): ISODate {
  return format(d, FMT);
}

export function isValidISODate(s: string): boolean {
  if (!RE.test(s)) return false;
  const d = parse(s, FMT, REF);
  return isValid(d) && format(d, FMT) === s;
}

/** 'YYYY-MM-DD' → Date o lokalnym południu. Rzuca błąd dla niepoprawnych dat (np. 2026-11-31). */
export function fromISODate(s: ISODate): Date {
  if (!isValidISODate(s)) throw new Error(`Niepoprawna data: ${s}`);
  return parse(s, FMT, REF);
}

export function weekdayOf(s: ISODate): Weekday {
  return getDay(fromISODate(s)) as Weekday;
}

export function addDays(s: ISODate, n: number): ISODate {
  return toISODate(fnsAddDays(fromISODate(s), n));
}

/** Dzisiejsza data lokalna (parametr `now` pod testy). */
export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(now);
}

export function daysInMonth(year: number, month: number): number {
  return getDaysInMonth(new Date(year, month - 1, 1, 12));
}

/** Wszystkie dni miesiąca (month 1–12). */
export function monthDays(year: number, month: number): ISODate[] {
  const mm = String(month).padStart(2, '0');
  return Array.from(
    { length: daysInMonth(year, month) },
    (_, i) => `${year}-${mm}-${String(i + 1).padStart(2, '0')}`,
  );
}

/** 7 dni tygodnia zawierającego `date`, zaczynając od weekStartsOn. */
export function weekDays(date: ISODate, weekStartsOn: 0 | 1): ISODate[] {
  const start = toISODate(startOfWeek(fromISODate(date), { weekStartsOn }));
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Liczba dni od a do b (b - a), arytmetyką kalendarzową, nie milisekundową. */
export function diffDays(a: ISODate, b: ISODate): number {
  const [ya, ma, da] = a.split('-').map(Number) as [number, number, number];
  const [yb, mb, db] = b.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}
