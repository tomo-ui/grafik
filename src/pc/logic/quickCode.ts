import { parseTimeRange } from '../../ai/normalize';
import { checkTimes } from '../../domain/hours';
import type { HHMM, Shift, ShiftKind } from '../../domain/types';

/**
 * Opis zawartości komórki siatki (wersja na komputer): to, co wpisujemy z klawiatury,
 * wklejamy z arkusza albo ustawiamy w panelu bocznym.
 */
export interface CellSpec {
  kind: ShiftKind;
  /** tylko dla kind='work': godziny wg dnia tygodnia (z ustawień) */
  useDefault?: boolean;
  start?: HHMM;
  end?: HHMM;
  /** undefined = zachowaj istniejącą notatkę; '' = usuń */
  note?: string;
}

const KIND_CODES: Record<string, CellSpec> = {
  x: { kind: 'work', useDefault: true },
  p: { kind: 'work', useDefault: true },
  d: { kind: 'work', useDefault: true },
  praca: { kind: 'work', useDefault: true },
  w: { kind: 'off' },
  wolne: { kind: 'off' },
  u: { kind: 'vacation' },
  urlop: { kind: 'vacation' },
  l: { kind: 'sick' },
  l4: { kind: 'sick' },
  chorobowe: { kind: 'sick' },
  i: { kind: 'other' },
  inne: { kind: 'other' },
  '?': { kind: 'other' },
};

/**
 * Tekst z klawiatury/schowka → opis komórki.
 * Pusty tekst (lub „-”) = wyczyść komórkę (`null`); nierozpoznany = `'invalid'`.
 * Przykłady: `x` (godziny domyślne), `10-22`, `14.30–23`, `u`, `l4`, `w`.
 */
export function parseCellCode(raw: string): CellSpec | null | 'invalid' {
  const t = raw.trim().toLowerCase();
  if (t === '' || t === '-' || t === '—') return null;
  const named = KIND_CODES[t];
  if (named) return { ...named };
  const range = parseTimeRange(t);
  if (range && /^\d{1,2}(?:[:.]\d{2})?\s*[-–—]\s*\d{1,2}(?:[:.]\d{2})?$/.test(t)) {
    return checkTimes(range.start, range.end).ok
      ? { kind: 'work', useDefault: false, start: range.start, end: range.end }
      : 'invalid';
  }
  return 'invalid';
}

/** Zmiana zapisana w bazie → opis komórki (do kopiowania). */
export function specFromShift(s: Shift): CellSpec {
  if (s.kind === 'work') {
    return {
      kind: 'work',
      useDefault: s.usesDefaultHours,
      start: s.start,
      end: s.end,
      note: s.note ?? '',
    };
  }
  return { kind: s.kind, note: s.note ?? '' };
}

const CODE_OF_KIND: Record<Exclude<ShiftKind, 'work'>, string> = {
  off: 'W',
  vacation: 'U',
  sick: 'L4',
  other: 'I',
};

/** Krótki tekst komórki (też do TSV): `10:00-22:00`, `U`, `L4`… */
export function specText(spec: CellSpec | null): string {
  if (!spec) return '';
  if (spec.kind === 'work') return spec.start && spec.end ? `${spec.start}-${spec.end}` : 'x';
  return CODE_OF_KIND[spec.kind];
}

export function sameSpec(a: CellSpec | null, b: CellSpec | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.kind === b.kind &&
    !!a.useDefault === !!b.useDefault &&
    a.start === b.start &&
    a.end === b.end &&
    (a.note ?? '') === (b.note ?? '')
  );
}
