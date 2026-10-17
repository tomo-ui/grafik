import { slotKey } from '../../domain/conflicts';
import { defaultHoursFor } from '../../domain/hours';
import type { DefaultHours, ISODate, Shift } from '../../domain/types';
import type { CellSpec } from './quickCode';

export interface CellTarget {
  personId: string;
  date: ISODate;
  /** null = wyczyść komórkę */
  spec: CellSpec | null;
}

type Fields = Pick<Shift, 'kind' | 'start' | 'end' | 'usesDefaultHours' | 'note'>;

export interface Plan {
  creates: Shift[];
  updates: { id: string; before: Fields; after: Fields }[];
  deletes: string[];
  /** komórki bez zmian (identyczna zawartość lub czyszczenie pustej) */
  unchanged: number;
}

export const isEmptyPlan = (p: Plan) =>
  p.creates.length + p.updates.length + p.deletes.length === 0;

const fieldsOf = (s: Shift): Fields => ({
  kind: s.kind,
  start: s.start,
  end: s.end,
  usesDefaultHours: s.usesDefaultHours,
  note: s.note,
});

const sameFields = (a: Fields, b: Fields) =>
  a.kind === b.kind &&
  a.start === b.start &&
  a.end === b.end &&
  a.usesDefaultHours === b.usesDefaultHours &&
  (a.note ?? '') === (b.note ?? '');

/**
 * Plan zmian dla zaznaczonych komórek (zastosowanie opisu / wklejenie / wypełnienie / czyszczenie).
 * Czysta funkcja: nie dotyka bazy — wykonanie i cofanie robi warstwa wyżej.
 * Godziny domyślne zapisywane jako konkretne wartości + flaga (jak w aplikacji mobilnej).
 */
export function planCellChanges(
  targets: CellTarget[],
  existing: Shift[],
  defaults: DefaultHours,
  newId: () => string,
  now: number,
): Plan {
  const bySlot = new Map(existing.filter((s) => !s.deletedAt).map((s) => [slotKey(s), s]));
  const plan: Plan = { creates: [], updates: [], deletes: [], unchanged: 0 };
  const seen = new Set<string>();

  for (const t of targets) {
    const key = slotKey(t);
    if (seen.has(key)) continue; // ostatnie wystąpienie nie nadpisuje pierwszego — jedna zmiana na komórkę
    seen.add(key);
    const cur = bySlot.get(key);

    if (!t.spec) {
      if (cur) plan.deletes.push(cur.id);
      else plan.unchanged++;
      continue;
    }

    const hours =
      t.spec.kind === 'work'
        ? t.spec.useDefault
          ? defaultHoursFor(t.date, defaults)
          : { start: t.spec.start, end: t.spec.end }
        : undefined;
    const note = t.spec.note === undefined ? cur?.note : t.spec.note.trim() || undefined;
    const after: Fields = {
      kind: t.spec.kind,
      start: hours?.start,
      end: hours?.end,
      usesDefaultHours: t.spec.kind === 'work' && !!t.spec.useDefault,
      note,
    };

    if (!cur) {
      plan.creates.push({
        id: newId(),
        personId: t.personId,
        date: t.date,
        ...after,
        source: 'manual',
        updatedAt: now,
      });
    } else if (sameFields(fieldsOf(cur), after)) {
      plan.unchanged++;
    } else {
      plan.updates.push({ id: cur.id, before: fieldsOf(cur), after });
    }
  }
  return plan;
}
