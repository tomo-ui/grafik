import { addDays, diffDays, weekdayOf, weekDays } from './dates';
import { checkTimes, defaultHoursFor } from './hours';
import type { DefaultHours, HHMM, ISODate, Shift, ShiftKind } from './types';

export interface ShiftFormInput {
  personIds: string[];
  dates: ISODate[];
  kind: ShiftKind;
  /** tylko dla kind='work': true = godziny wg dnia tygodnia */
  useDefault: boolean;
  start: HHMM;
  end: HHMM;
  note: string;
}

export type FormCheck =
  { ok: true; warnings: string[]; count: number } | { ok: false; errors: string[] };

/** Walidacja formularza dodawania (E-04, E-05). */
export function validateForm(input: ShiftFormInput): FormCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (input.personIds.length === 0) errors.push('Wybierz co najmniej jedną osobę.');
  if (input.dates.length === 0) errors.push('Wybierz co najmniej jeden dzień.');
  if (input.kind === 'work' && !input.useDefault) {
    const r = checkTimes(input.start, input.end);
    if (!r.ok) errors.push(r.error);
    else if (r.crossesMidnight) {
      warnings.push(
        'Zmiana kończy się następnego dnia (+1 dzień). Upewnij się, że to nie pomyłka.',
      );
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, warnings, count: input.personIds.length * input.dates.length };
}

/** Tworzy rekordy: osoby × dni. Godziny domyślne zapisywane jako konkretne wartości + flaga. */
export function buildShifts(
  input: ShiftFormInput,
  defaults: DefaultHours,
  newId: () => string,
  now: number,
): Shift[] {
  const check = validateForm(input);
  if (!check.ok) throw new Error(check.errors[0]);
  const dates = [...new Set(input.dates)].sort();
  const note = input.note.trim() || undefined;
  const out: Shift[] = [];
  for (const personId of input.personIds) {
    for (const date of dates) {
      const base = {
        id: newId(),
        personId,
        date,
        note,
        source: 'manual' as const,
        updatedAt: now,
      };
      if (input.kind === 'work') {
        const h = input.useDefault ? defaultHoursFor(date, defaults) : undefined;
        out.push({
          ...base,
          kind: 'work',
          start: h ? h.start : input.start,
          end: h ? h.end : input.end,
          usesDefaultHours: input.useDefault,
        });
      } else {
        out.push({ ...base, kind: input.kind, usesDefaultHours: false });
      }
    }
  }
  return out;
}

/* ---------- Szybkie zaznaczenia dni ---------- */

export type QuickPick = 'week' | 'workdays' | 'weekend';

/** Cały tydzień / Pn–Pt / weekend tygodnia zawierającego `anchor`. */
export function quickDates(pick: QuickPick, anchor: ISODate, weekStartsOn: 0 | 1): ISODate[] {
  const week = weekDays(anchor, weekStartsOn);
  if (pick === 'week') return week;
  if (pick === 'workdays') return week.filter((d) => ![0, 6].includes(weekdayOf(d)));
  return week.filter((d) => [0, 6].includes(weekdayOf(d)));
}

/** „Powtórz co tydzień do…”: dla każdego zaznaczonego dnia dodaje kolejne tygodnie do `until` (włącznie). */
export function repeatWeekly(dates: ISODate[], until: ISODate): ISODate[] {
  const out = new Set<ISODate>();
  for (const d of dates) {
    for (let cur = d; cur <= until; cur = addDays(cur, 7)) out.add(cur);
  }
  return [...out].sort();
}

/** Zakres dat między a i b (kolejność dowolna), włącznie. */
export function datesBetween(a: ISODate, b: ISODate): ISODate[] {
  const [from, to] = a <= b ? [a, b] : [b, a];
  const n = diffDays(from, to);
  return Array.from({ length: n + 1 }, (_, i) => addDays(from, i));
}

/** Opis podglądu godzin domyślnych, np. „Pt–Sb 10:00–23:00, pozostałe 10:00–22:00”. */
export function describeDefaults(defaults: DefaultHours): string {
  const names = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb'];
  const order = [1, 2, 3, 4, 5, 6, 0] as const;
  const groups: { label: string[]; range: string }[] = [];
  for (const d of order) {
    const range = `${defaults[d].start}–${defaults[d].end}`;
    const g = groups.find((x) => x.range === range);
    if (g) g.label.push(names[d]!);
    else groups.push({ label: [names[d]!], range });
  }
  if (groups.length === 1) return `Codziennie ${groups[0]!.range}`;
  // największa grupa = „pozostałe”
  groups.sort((a, b) => b.label.length - a.label.length);
  const [rest, ...special] = groups;
  const compact = (days: string[]) => {
    const idx = days.map((n) => order.findIndex((d) => names[d] === n)).sort((a, b) => a - b);
    const contiguous = idx.every((v, i) => i === 0 || v === idx[i - 1]! + 1);
    const l = idx.map((i) => names[order[i]!]!);
    return contiguous && l.length >= 2 ? `${l[0]}–${l[l.length - 1]}` : l.join(', ');
  };
  const parts = special
    .sort(
      (a, b) =>
        order.findIndex((d) => names[d] === a.label[0]) -
        order.findIndex((d) => names[d] === b.label[0]),
    )
    .map((g) => `${g.label.length > 1 ? compact(g.label) : g.label[0]} ${g.range}`);
  return `${parts.join(', ')}, pozostałe ${rest!.range}`;
}
