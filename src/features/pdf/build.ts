import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { displayNames, fullName } from '../../domain/people';
import type { DefaultHours, Person, Shift } from '../../domain/types';
import { buildPersonPdf } from './builders/personList';
import { buildTeamPdf } from './builders/teamGrid';
import { pdfFileName, validateRange, type PdfOptions } from './model';

export interface PdfData {
  options: PdfOptions;
  persons: Person[];
  shifts: Shift[];
  defaults: DefaultHours;
  generatedAt: Date;
}

export type BuildResult =
  | { empty: true; reason: 'no-shifts' | 'no-people' | 'bad-range'; message: string }
  | { empty: false; doc: TDocumentDefinitions; fileName: string; people: Person[] };

const MESSAGES = {
  'no-shifts': 'Brak zmian w wybranym okresie.',
  'no-people': 'Nie wybrano żadnej osoby.',
} as const;

/** Osoby do eksportu wg opcji; zarchiwizowane tylko, gdy mają zmiany w zakresie. */
export function selectPeople(options: PdfOptions, persons: Person[], shifts: Shift[]): Person[] {
  const inRange = new Set(
    shifts
      .filter((s) => !s.deletedAt && s.date >= options.range.from && s.date <= options.range.to)
      .map((s) => s.personId),
  );
  const live = persons.filter((p) => !p.deletedAt).sort((a, b) => a.order - b.order);
  if (options.people === 'me') return live.filter((p) => p.isMe);
  if (Array.isArray(options.people)) {
    const wanted = new Set(options.people);
    return live.filter((p) => wanted.has(p.id));
  }
  return live.filter((p) => !p.archived || inRange.has(p.id));
}

/**
 * Buduje definicję dokumentu albo zwraca „pusto”. PDF nie powstaje, gdy wybrane osoby nie mają
 * żadnej zmiany w zakresie (plan 9: komunikat „Brak zmian w wybranym okresie”).
 */
export function buildPdf(data: PdfData): BuildResult {
  const { options } = data;
  const rangeError = validateRange(options.range.from, options.range.to);
  if (rangeError) return { empty: true, reason: 'bad-range', message: rangeError };

  const people = selectPeople(options, data.persons, data.shifts);
  if (people.length === 0)
    return { empty: true, reason: 'no-people', message: MESSAGES['no-people'] };

  const ids = new Set(people.map((p) => p.id));
  const has = data.shifts.some(
    (s) =>
      !s.deletedAt &&
      ids.has(s.personId) &&
      s.date >= options.range.from &&
      s.date <= options.range.to,
  );
  if (!has) return { empty: true, reason: 'no-shifts', message: MESSAGES['no-shifts'] };

  const names = displayNames(data.persons.filter((p) => !p.deletedAt));
  if (options.layout === 'person') {
    const doc = buildPersonPdf({
      options,
      people,
      shifts: data.shifts,
      generatedAt: data.generatedAt,
    });
    const single = people.length === 1 ? people[0]!.firstName || fullName(people[0]!) : undefined;
    return { empty: false, doc, fileName: pdfFileName(options.range, single), people };
  }
  const doc = buildTeamPdf({
    options,
    people,
    shifts: data.shifts,
    names,
    defaults: data.defaults,
    generatedAt: data.generatedAt,
  });
  return { empty: false, doc, fileName: pdfFileName(options.range), people };
}
