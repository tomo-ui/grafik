import { fromISODate } from './dates';
import type { ISODate } from './types';

const rules = new Intl.PluralRules('pl-PL');
const numberFmt = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 });

export interface PluralForms {
  one: string;
  few: string;
  many: string;
}

/** plural(5, { one: 'zmiana', few: 'zmiany', many: 'zmian' }) → 'zmian' */
export function pluralForm(n: number, forms: PluralForms): string {
  const cat = rules.select(Math.abs(n));
  if (cat === 'one') return forms.one;
  if (cat === 'few') return forms.few;
  return forms.many; // many + other
}

/** plural(22, ...) → '22 zmiany' */
export function plural(n: number, forms: PluralForms): string {
  return `${numberFmt.format(n)} ${pluralForm(n, forms)}`;
}

export const SHIFTS = { one: 'zmiana', few: 'zmiany', many: 'zmian' } as const;
export const PEOPLE = { one: 'osoba', few: 'osoby', many: 'osób' } as const;

/** Minuty → '12,5 h' (przecinek dziesiętny). */
export function formatHours(minutes: number): string {
  return `${numberFmt.format(minutes / 60)} h`;
}

/** Indeks = Weekday (0 = niedziela). */
export const DAY_NAMES = [
  'Niedziela',
  'Poniedziałek',
  'Wtorek',
  'Środa',
  'Czwartek',
  'Piątek',
  'Sobota',
] as const;
export const DAY_SHORT = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb'] as const;

const dayFmt = new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
const dayShortFmt = new Intl.DateTimeFormat('pl-PL', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
const monthFmt = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' });

/** „wtorek, 4 listopada” */
export const formatDayLong = (d: ISODate) => dayFmt.format(fromISODate(d));
/** „wt., 4 lis” */
export const formatDayShort = (d: ISODate) => dayShortFmt.format(fromISODate(d));
/** „listopad 2026” */
export const formatMonth = (d: ISODate) => monthFmt.format(fromISODate(d));

export const KOLIZJE = { one: 'kolizja', few: 'kolizje', many: 'kolizji' } as const;
