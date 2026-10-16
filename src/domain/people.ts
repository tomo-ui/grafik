import type { Person } from './types';

export const PERSON_COLORS = [
  'blue',
  'green',
  'orange',
  'pink',
  'purple',
  'teal',
  'indigo',
  'red',
  'yellow',
  'mint',
  'cyan',
  'brown',
] as const;

export const colorVar = (color: string) => `var(--p-${color})`;

/** Pierwszy kolor z palety, którego jeszcze nikt nie używa (potem rotacja). */
export function nextColor(used: string[]): string {
  const free = PERSON_COLORS.find((c) => !used.includes(c));
  return free ?? PERSON_COLORS[used.length % PERSON_COLORS.length]!;
}

export function initials(p: Pick<Person, 'firstName' | 'lastName'>): string {
  const a = [...p.firstName.trim()][0] ?? '';
  const b = [...(p.lastName?.trim() ?? '')][0] ?? '';
  return (a + b).toLocaleUpperCase('pl');
}

/**
 * Nazwy w siatce i PDF (E-29): samo imię; gdy imiona się powtarzają — dodaj inicjał nazwiska
 * („Anna K.”), a jeśli to nie rozstrzyga lub brak nazwiska — pełne nazwisko / numer.
 */
export function displayNames(
  people: Pick<Person, 'id' | 'firstName' | 'lastName'>[],
): Map<string, string> {
  const key = (p: { firstName: string }) => p.firstName.trim().toLocaleLowerCase('pl');
  const counts = new Map<string, number>();
  for (const p of people) counts.set(key(p), (counts.get(key(p)) ?? 0) + 1);

  const withInitial = new Map<string, string>();
  for (const p of people) {
    const first = p.firstName.trim();
    const last = p.lastName?.trim();
    if ((counts.get(key(p)) ?? 0) > 1 && last) {
      withInitial.set(p.id, `${first} ${[...last][0]!.toLocaleUpperCase('pl')}.`);
    } else withInitial.set(p.id, first);
  }

  // jeśli po dodaniu inicjału nadal są kolizje — pełne nazwisko, a bez nazwiska numer (2), (3)
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  const finalCounts = new Map<string, number>();
  for (const name of withInitial.values()) {
    const k = name.toLocaleLowerCase('pl');
    finalCounts.set(k, (finalCounts.get(k) ?? 0) + 1);
  }
  for (const p of people) {
    let name = withInitial.get(p.id)!;
    const k = name.toLocaleLowerCase('pl');
    if ((finalCounts.get(k) ?? 0) > 1) {
      const last = p.lastName?.trim();
      if (last) name = `${p.firstName.trim()} ${last}`;
      else {
        const n = (seen.get(k) ?? 0) + 1;
        seen.set(k, n);
        if (n > 1) name = `${name} (${n})`;
      }
    }
    out.set(p.id, name);
  }
  return out;
}

export function fullName(p: Pick<Person, 'firstName' | 'lastName'>): string {
  return [p.firstName.trim(), p.lastName?.trim()].filter(Boolean).join(' ');
}
