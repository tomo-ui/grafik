import { parseHHMM } from './hours';
import type { Shift, ShiftKind } from './types';

export const KIND_LABELS: Record<ShiftKind, string> = {
  work: 'Praca',
  off: 'Wolne',
  vacation: 'Urlop',
  sick: 'L4',
  other: 'Inne',
};

/** Skrót do pigułek w siatce: W / U / L4. */
export const KIND_SHORT: Record<Exclude<ShiftKind, 'work'>, string> = {
  off: 'W',
  vacation: 'U',
  sick: 'L4',
  other: '?',
};

/** Czy zmiana kończy się następnego dnia (end <= start). */
export function endsNextDay(s: Pick<Shift, 'start' | 'end'>): boolean {
  if (!s.start || !s.end) return false;
  const a = parseHHMM(s.start);
  const b = parseHHMM(s.end);
  return a !== null && b !== null && b <= a;
}

/** „10:00–22:00”, „18:00–02:00 (+1 dzień)”, „Wolne”. */
export function shiftLabel(s: Pick<Shift, 'kind' | 'start' | 'end'>): string {
  if (s.kind !== 'work' || !s.start || !s.end) return KIND_LABELS[s.kind];
  return `${s.start}–${s.end}${endsNextDay(s) ? ' (+1 dzień)' : ''}`;
}
