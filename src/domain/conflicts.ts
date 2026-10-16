import type { ISODate, Shift } from './types';

export interface Slot {
  personId: string;
  date: ISODate;
}

export const slotKey = (s: Slot) => `${s.personId}|${s.date}`;

export interface Conflict<T extends Slot> {
  incoming: T;
  existing: Shift;
}

/** Kolizje z istniejącymi (nieusuniętymi) zmianami: jedna osoba = max 1 zmiana dziennie. */
export function findConflicts<T extends Slot>(existing: Shift[], incoming: T[]): Conflict<T>[] {
  const byKey = new Map<string, Shift>();
  for (const s of existing) if (!s.deletedAt) byKey.set(slotKey(s), s);
  const out: Conflict<T>[] = [];
  for (const inc of incoming) {
    const hit = byKey.get(slotKey(inc));
    if (hit) out.push({ incoming: inc, existing: hit });
  }
  return out;
}

/** Duplikaty w samym wsadzie (np. dwa wpisy tej samej osoby tego samego dnia). */
export function findDuplicates<T extends Slot>(items: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const k = slotKey(it);
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}
