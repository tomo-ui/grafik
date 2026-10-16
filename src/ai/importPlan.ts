import { slotKey, findConflicts, type Conflict } from '../domain/conflicts';
import { isValidISODate } from '../domain/dates';
import { checkTimes } from '../domain/hours';
import type { HHMM, Person, Shift, ShiftKind } from '../domain/types';
import { normalizeName } from './names';
import {
  shiftYM,
  type NormalizedEntry,
  type NormalizedImport,
  type NormalizedPerson,
} from './normalize';

/* Decyzje użytkownika na ekranie weryfikacji (4.7) i budowa planu importu. */

export type PersonDecision =
  | { mode: 'existing'; personId: string; confirmed: boolean }
  | { mode: 'new'; firstName: string; lastName?: string }
  | { mode: 'skip' };

export interface EntryEdit {
  removed?: boolean;
  kind?: ShiftKind;
  start?: HHMM;
  end?: HHMM;
  usesDefaultHours?: boolean;
}

export type ConflictMode = 'replace' | 'skip' | 'ask';

export interface ImportDecisions {
  /** klucz = NormalizedPerson.key */
  persons: Record<string, PersonDecision | undefined>;
  /** klucz = NormalizedEntry.id */
  entryEdits: Record<string, EntryEdit>;
  /** wybór przy sprzecznych wpisach tej samej osoby/dnia; klucz = `${personKey}|${date}` */
  entryChoice: Record<string, 'first' | 'second'>;
  conflictMode: ConflictMode;
  /** tryb „pytaj dla każdej”; klucz = slotKey(personId|date) */
  perConflict: Record<string, 'replace' | 'skip'>;
  /** korekta okresu przez użytkownika: przesunięcie wszystkich dat */
  periodShift: { years: number; months: number };
}

/** Początkowe decyzje: pewne dopasowania gotowe, podpowiedzi czekają na potwierdzenie. */
export function initialDecisions(n: NormalizedImport): ImportDecisions {
  const persons: ImportDecisions['persons'] = {};
  for (const p of n.persons) {
    if (p.match.personId && p.status === 'matched') {
      persons[p.key] = { mode: 'existing', personId: p.match.personId, confirmed: true };
    } else if (p.match.personId && p.status === 'suggested') {
      persons[p.key] = { mode: 'existing', personId: p.match.personId, confirmed: false };
    }
  }
  return {
    persons,
    entryEdits: {},
    entryChoice: {},
    conflictMode: 'ask',
    perConflict: {},
    periodShift: { years: 0, months: 0 },
  };
}

/** Wpisy osoby po zastosowaniu: wyboru przy sprzecznościach, edycji, usunięć i przesunięcia okresu. */
export function resolveEntries(person: NormalizedPerson, d: ImportDecisions): NormalizedEntry[] {
  const { years, months } = d.periodShift;
  const out: NormalizedEntry[] = [];
  for (const e of person.entries) {
    let entry = e;
    const conflict = person.conflicts.find((c) => c.date === e.date);
    if (conflict && d.entryChoice[`${person.key}|${e.date}`] === 'second') entry = conflict.second;
    const edit = d.entryEdits[entry.id] ?? d.entryEdits[e.id];
    if (edit?.removed) continue;
    const merged: NormalizedEntry = {
      ...entry,
      ...(edit?.kind ? { kind: edit.kind } : {}),
      ...(edit?.start ? { start: edit.start } : {}),
      ...(edit?.end ? { end: edit.end } : {}),
      ...(edit?.usesDefaultHours !== undefined ? { usesDefaultHours: edit.usesDefaultHours } : {}),
    };
    if (merged.kind !== 'work') {
      merged.start = undefined;
      merged.end = undefined;
      merged.usesDefaultHours = false;
    }
    out.push({
      ...merged,
      date: years || months ? shiftYM(merged.date, years, months) : merged.date,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface Blockers {
  /** osoby bez decyzji lub z niepotwierdzoną podpowiedzią */
  unresolved: string[];
  /** dwie różne nazwy → ta sama osoba w bazie (obie na czerwono) */
  duplicate: string[];
  /** sprzeczne wpisy bez wyboru */
  entryConflicts: string[];
  /** wpisy z niepoprawnymi godzinami (np. początek = koniec) */
  invalid: string[];
}

export const hasBlockers = (b: Blockers) =>
  b.unresolved.length + b.duplicate.length + b.entryConflicts.length + b.invalid.length > 0;

/** Co blokuje przycisk „Importuj” (4.7: nie importujemy, dopóki są nierozstrzygnięte osoby). */
export function blockers(n: NormalizedImport, d: ImportDecisions): Blockers {
  const b: Blockers = { unresolved: [], duplicate: [], entryConflicts: [], invalid: [] };
  const targets = new Map<string, string[]>();
  for (const p of n.persons) {
    const dec = d.persons[p.key];
    if (!dec || (dec.mode === 'existing' && !dec.confirmed)) b.unresolved.push(p.key);
    if (dec?.mode === 'skip') continue;
    if (dec?.mode === 'existing') {
      targets.set(dec.personId, [...(targets.get(dec.personId) ?? []), p.key]);
    }
    for (const c of p.conflicts) {
      if (!d.entryChoice[`${p.key}|${c.date}`]) b.entryConflicts.push(p.key);
    }
    if (dec) {
      for (const e of resolveEntries(p, d)) {
        if (e.kind === 'work' && (!e.start || !e.end || !checkTimes(e.start, e.end).ok)) {
          b.invalid.push(p.key);
          break;
        }
        if (!isValidISODate(e.date)) {
          b.invalid.push(p.key);
          break;
        }
      }
    }
  }
  for (const keys of targets.values()) if (keys.length > 1) b.duplicate.push(...keys);
  b.entryConflicts = [...new Set(b.entryConflicts)];
  return b;
}

export interface ImportPlan {
  newPersons: Person[];
  aliasUpdates: { personId: string; alias: string }[];
  shifts: Shift[];
  /** kolizje z istniejącymi zmianami w bazie */
  conflicts: Conflict<Shift>[];
  skippedPeople: string[];
}

export interface PlanContext {
  persons: Pick<Person, 'id' | 'firstName' | 'lastName' | 'aliases' | 'color' | 'order'>[];
  existing: Shift[];
  newId: () => string;
  now: number;
  batchId: string;
  /** kolory dla nowych osób */
  pickColor: (used: string[]) => string;
}

/** Zamienia decyzje w konkretne rekordy do zapisu. */
export function buildImportPlan(
  n: NormalizedImport,
  d: ImportDecisions,
  ctx: PlanContext,
): ImportPlan {
  const newPersons: Person[] = [];
  const aliasUpdates: ImportPlan['aliasUpdates'] = [];
  const shifts: Shift[] = [];
  const skippedPeople: string[] = [];
  const used = ctx.persons.map((p) => p.color);
  let order = ctx.persons.reduce((m, p) => Math.max(m, p.order), -1) + 1;

  for (const p of n.persons) {
    const dec = d.persons[p.key];
    if (!dec || dec.mode === 'skip') {
      skippedPeople.push(p.nameAsWritten);
      continue;
    }
    let personId: string;
    if (dec.mode === 'new') {
      personId = ctx.newId();
      const color = ctx.pickColor(used);
      used.push(color);
      newPersons.push({
        id: personId,
        firstName: dec.firstName.trim() || p.nameAsWritten,
        lastName: dec.lastName?.trim() || undefined,
        color,
        aliases: [],
        isMe: false,
        archived: false,
        order: order++,
        createdAt: ctx.now,
      });
    } else {
      personId = dec.personId;
      const person = ctx.persons.find((x) => x.id === personId);
      const w = normalizeName(p.nameAsWritten);
      const known =
        !person ||
        normalizeName(person.firstName) === w ||
        normalizeName([person.firstName, person.lastName].filter(Boolean).join(' ')) === w ||
        person.aliases.some((a) => normalizeName(a) === w);
      if (
        !known &&
        !aliasUpdates.some((a) => a.personId === personId && normalizeName(a.alias) === w)
      ) {
        aliasUpdates.push({ personId, alias: p.nameAsWritten });
      }
    }
    for (const e of resolveEntries(p, d)) {
      shifts.push({
        id: ctx.newId(),
        personId,
        date: e.date,
        kind: e.kind,
        start: e.kind === 'work' ? e.start : undefined,
        end: e.kind === 'work' ? e.end : undefined,
        usesDefaultHours: e.kind === 'work' ? e.usesDefaultHours : false,
        note: undefined,
        source: 'ai',
        importBatchId: ctx.batchId,
        updatedAt: ctx.now,
      });
    }
  }

  return {
    newPersons,
    aliasUpdates,
    shifts,
    conflicts: findConflicts(ctx.existing, shifts),
    skippedPeople,
  };
}

/** Polityka dla kolizji wg trybu globalnego i wyborów „pytaj dla każdej”. */
export function conflictPolicy(d: ImportDecisions) {
  return (incoming: Shift): 'replace' | 'skip' => {
    if (d.conflictMode === 'replace') return 'replace';
    if (d.conflictMode === 'skip') return 'skip';
    return d.perConflict[slotKey(incoming)] ?? 'skip';
  };
}
