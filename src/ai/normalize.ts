import { daysInMonth, diffDays, isValidISODate, weekdayOf } from '../domain/dates';
import { checkTimes, defaultHoursFor, DEFAULT_HOURS } from '../domain/hours';
import type { DefaultHours, HHMM, ISODate, Person, ShiftKind, Weekday } from '../domain/types';
import { matchPerson, normalizeName, MATCH_AUTO, type NameMatch } from './names';
import type { ParsedEntry, ParsedSchedule } from './schema';

/* ------------------------------------------------------------------ typy */

export interface NormalizeContext {
  today: ISODate;
  /** okres wskazany przez użytkownika (miesiąc 1–12) */
  suggestedPeriod?: { year: number; month: number };
  people: Pick<Person, 'id' | 'firstName' | 'lastName' | 'aliases'>[];
  defaults?: DefaultHours;
}

export interface NormalizedEntry {
  id: string;
  date: ISODate;
  kind: ShiftKind;
  start?: HHMM;
  end?: HHMM;
  usesDefaultHours: boolean;
  rawCell: string;
  confidence: number;
  /** pewność < 0,7 — podświetlane na żółto */
  lowConfidence: boolean;
  /** godziny wymagają potwierdzenia (np. „22-10”, początek = koniec) */
  suspicious: boolean;
  notes: string[];
}

export interface EntryConflict {
  date: ISODate;
  first: NormalizedEntry;
  second: NormalizedEntry;
}

export type PersonStatus = 'matched' | 'suggested' | 'unresolved';

export interface NormalizedPerson {
  key: string;
  nameAsWritten: string;
  match: NameMatch;
  status: PersonStatus;
  entries: NormalizedEntry[];
  /** sprzeczne wartości dla tego samego dnia (np. dwie strony grafiku) */
  conflicts: EntryConflict[];
}

export interface ExcludedEntry {
  person: string;
  date: string;
  rawCell: string;
  reason: string;
}

export interface NormalizedImport {
  period: { year: number; month: number } | null;
  persons: NormalizedPerson[];
  excluded: ExcludedEntry[];
  warnings: string[];
  /** grupy kluczy osób z grafiku dopasowanych do tej samej osoby w bazie */
  duplicateTargets: string[][];
}

/* ------------------------------------------------------------ godziny */

/** „10” → 10:00, „10.30” → 10:30, „1030” → 10:30, „24:00” → 00:00; inaczej undefined. */
export function normalizeTime(input: string | undefined | null): HHMM | undefined {
  if (!input) return undefined;
  const t = input.trim().toLowerCase().replace(/\s*h$/, '');
  let h: number;
  let m: number;
  let r: RegExpExecArray | null;
  if ((r = /^(\d{1,2})$/.exec(t))) {
    h = Number(r[1]);
    m = 0;
  } else if ((r = /^(\d{1,2})[:.](\d{2})(?::\d{2})?$/.exec(t))) {
    h = Number(r[1]);
    m = Number(r[2]);
  } else if ((r = /^(\d{3,4})$/.exec(t))) {
    const n = r[1]!.padStart(4, '0');
    h = Number(n.slice(0, 2));
    m = Number(n.slice(2));
  } else return undefined;
  if (h === 24 && m === 0) h = 0;
  if (h > 23 || m > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** „10-18”, „14:00–23”, „9.30 - 17” → { start, end }. */
export function parseTimeRange(raw: string): { start: HHMM; end: HHMM } | undefined {
  const m = /(\d{1,2}(?:[:.]\d{2})?)\s*[-–—]\s*(\d{1,2}(?:[:.]\d{2})?)/.exec(raw);
  if (!m) return undefined;
  const start = normalizeTime(m[1]);
  const end = normalizeTime(m[2]);
  return start && end ? { start, end } : undefined;
}

const WEEKDAY_NAMES: Record<string, Weekday> = {
  nd: 0,
  niedz: 0,
  niedziela: 0,
  n: 0,
  pn: 1,
  pon: 1,
  poniedzialek: 1,
  wt: 2,
  wto: 2,
  wtorek: 2,
  sr: 3,
  sro: 3,
  sroda: 3,
  cz: 4,
  czw: 4,
  czwartek: 4,
  pt: 5,
  pia: 5,
  piatek: 5,
  sb: 6,
  sob: 6,
  sobota: 6,
};

export function parseWeekdayHeader(s: string | undefined): Weekday | undefined {
  if (!s) return undefined;
  return WEEKDAY_NAMES[normalizeName(s).replace(/\s/g, '')];
}

/* ---------------------------------------------------- daty / okresy */

/** Przesuwa datę o miesiące/lata, ucinając dzień do długości miesiąca. */
export function shiftYM(date: ISODate, dYear: number, dMonth: number): ISODate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const idx = (y + dYear) * 12 + (m - 1) + dMonth;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

function weekdayAgreement(
  entries: { date: ISODate; wd: Weekday }[],
  dYear: number,
  dMonth: number,
) {
  if (entries.length === 0) return 0;
  const ok = entries.filter((e) => weekdayOf(shiftYM(e.date, dYear, dMonth)) === e.wd).length;
  return ok / entries.length;
}

function modalMonth(dates: ISODate[]): { year: number; month: number } | null {
  const counts = new Map<string, number>();
  for (const d of dates) counts.set(d.slice(0, 7), (counts.get(d.slice(0, 7)) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [k, v] of counts) if (v > n) [best, n] = [k, v];
  return best ? { year: Number(best.slice(0, 4)), month: Number(best.slice(5, 7)) } : null;
}

/* ------------------------------------------------------------- główna */

interface WorkRow {
  nameAsWritten: string;
  entries: ParsedEntry[];
}

/** Scala wiersze o tej samej (znormalizowanej) nazwie — np. dwie strony grafiku. */
function mergeRows(people: ParsedSchedule['people']): WorkRow[] {
  const rows = new Map<string, WorkRow>();
  for (const p of people) {
    const k = normalizeName(p.nameAsWritten);
    const cur = rows.get(k);
    if (cur) cur.entries.push(...p.entries);
    else rows.set(k, { nameAsWritten: p.nameAsWritten.trim(), entries: [...p.entries] });
  }
  return [...rows.values()];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

export function normalizeSchedule(parsed: ParsedSchedule, ctx: NormalizeContext): NormalizedImport {
  const defaults = ctx.defaults ?? DEFAULT_HOURS;
  const warnings: string[] = [...parsed.warnings];
  const excluded: ExcludedEntry[] = [];

  const rows = mergeRows(parsed.people);

  /* 1. daty poprawne składniowo */
  type Prepared = { row: number; entry: ParsedEntry; date: ISODate };
  const prepared: Prepared[] = [];
  rows.forEach((row, ri) => {
    for (const e of row.entries) {
      const date = e.date.trim();
      if (!isValidISODate(date)) {
        excluded.push({
          person: row.nameAsWritten,
          date: e.date,
          rawCell: e.rawCell,
          reason: 'Niepoprawna data (np. nieistniejący dzień miesiąca).',
        });
        continue;
      }
      prepared.push({ row: ri, entry: e, date });
    }
  });

  /* 2. spójność dat z nagłówkami dni tygodnia: korekta roku/miesiąca o 1 */
  let dYear = 0;
  let dMonth = 0;
  const withWd = prepared
    .map((p) => ({ date: p.date, wd: parseWeekdayHeader(p.entry.weekday) }))
    .filter((x): x is { date: ISODate; wd: Weekday } => x.wd !== undefined);
  if (withWd.length >= 3) {
    const base = weekdayAgreement(withWd, 0, 0);
    if (base < 0.7) {
      const candidates: [number, number][] = [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
        [-1, 1],
        [1, -1],
        [-1, -1],
        [1, 1],
      ];
      const best = candidates
        .map(([y, m]) => ({ y, m, score: weekdayAgreement(withWd, y, m) }))
        .sort((a, b) => b.score - a.score)[0]!;
      if (best.score >= 0.9) {
        dYear = best.y;
        dMonth = best.m;
        warnings.push(
          'Daty z odczytu nie zgadzały się z dniami tygodnia — poprawiono miesiąc/rok. Sprawdź okres.',
        );
      } else {
        warnings.push('Daty nie zgadzają się z nagłówkami dni tygodnia. Sprawdź okres grafiku.');
      }
    }
  }
  const fixed = prepared.map((p) => ({
    ...p,
    date: dYear || dMonth ? shiftYM(p.date, dYear, dMonth) : p.date,
    corrected: !!(dYear || dMonth),
  }));

  /* 3. wykryty okres i wpisy spoza niego (> 7 dni) */
  const period = modalMonth(fixed.map((f) => f.date));
  let bounds: { from: ISODate; to: ISODate } | null = null;
  const ps = parsed.period;
  if (
    ps.startDate &&
    ps.endDate &&
    isValidISODate(ps.startDate) &&
    isValidISODate(ps.endDate) &&
    !dYear &&
    !dMonth
  ) {
    bounds = { from: ps.startDate, to: ps.endDate };
  } else if (period) {
    bounds = {
      from: `${period.year}-${String(period.month).padStart(2, '0')}-01`,
      to: `${period.year}-${String(period.month).padStart(2, '0')}-${String(daysInMonth(period.year, period.month)).padStart(2, '0')}`,
    };
  }
  if (period && ctx.suggestedPeriod) {
    const sp = ctx.suggestedPeriod;
    if (sp.year !== period.year || sp.month !== period.month) {
      warnings.push(
        `Wykryty okres (${String(period.month).padStart(2, '0')}.${period.year}) różni się od wybranego (${String(sp.month).padStart(2, '0')}.${sp.year}). Sprawdź okres.`,
      );
    }
  }

  const inRange = fixed.filter((f) => {
    if (!bounds) return true;
    const outside =
      f.date < bounds.from
        ? diffDays(f.date, bounds.from)
        : f.date > bounds.to
          ? diffDays(bounds.to, f.date)
          : 0;
    if (outside > 7) {
      excluded.push({
        person: rows[f.row]!.nameAsWritten,
        date: f.date,
        rawCell: f.entry.rawCell,
        reason: 'Data spoza okresu grafiku (ponad 7 dni).',
      });
      return false;
    }
    return true;
  });

  /* 4. wpisy: godziny, legenda, domyślne, pewność */
  const legend = parsed.legend.map((l) => ({ ...l, key: normalizeName(l.symbol) }));
  const persons: NormalizedPerson[] = rows.map((row, ri) => {
    const key = `r${ri}`;
    const entries: NormalizedEntry[] = [];
    const conflicts: EntryConflict[] = [];
    const byDate = new Map<ISODate, NormalizedEntry>();
    let seq = 0;

    for (const f of inRange.filter((x) => x.row === ri)) {
      const e = f.entry;
      const notes: string[] = [];
      if (f.corrected) notes.push('Data skorygowana na podstawie dnia tygodnia.');
      const date = f.date;
      const kind: ShiftKind = e.kind;
      let start: HHMM | undefined;
      let end: HHMM | undefined;
      let usesDefaultHours = false;
      let suspicious = false;

      if (kind === 'work') {
        start = normalizeTime(e.start);
        end = normalizeTime(e.end);
        if (!start || !end) {
          const range = parseTimeRange(e.rawCell);
          if (range) [start, end] = [range.start, range.end];
        }
        if (!start || !end) {
          const sym = normalizeName(e.rawCell);
          const l = legend.find((x) => x.key === sym && x.meaning === 'work' && x.start && x.end);
          const ls = normalizeTime(l?.start);
          const le = normalizeTime(l?.end);
          if (ls && le) {
            [start, end] = [ls, le];
            notes.push('Godziny z legendy grafiku.');
          }
        }
        if (!start || !end) {
          const d = defaultHoursFor(date, defaults);
          [start, end] = [d.start, d.end];
          usesDefaultHours = true;
        } else {
          const d = defaultHoursFor(date, defaults);
          usesDefaultHours = start === d.start && end === d.end;
          const t = checkTimes(start, end);
          if (!t.ok) {
            suspicious = true;
            notes.push('Początek i koniec zmiany są takie same — popraw godziny.');
          } else if (t.crossesMidnight) {
            suspicious = true;
            notes.push('Zmiana kończy się następnego dnia (+1 dzień) — sprawdź godziny.');
          }
        }
      }
      // wolne / urlop / L4 / inne: bez godzin

      const entry: NormalizedEntry = {
        id: `${key}:${seq++}`,
        date,
        kind,
        start,
        end,
        usesDefaultHours,
        rawCell: e.rawCell,
        confidence: e.confidence,
        lowConfidence: e.confidence < 0.7,
        suspicious,
        notes,
      };

      const prev = byDate.get(date);
      if (prev) {
        const same =
          prev.kind === entry.kind && prev.start === entry.start && prev.end === entry.end;
        if (!same) conflicts.push({ date, first: prev, second: entry });
        continue; // duplikat identyczny lub sprzeczny — zostaje pierwszy, sprzeczność do rozstrzygnięcia
      }
      byDate.set(date, entry);
      entries.push(entry);
    }

    entries.sort((a, b) => a.date.localeCompare(b.date));
    const match = matchPerson(row.nameAsWritten, ctx.people);
    const status: PersonStatus =
      match.personId && match.how !== 'none'
        ? match.how === 'fuzzy' && (match.score < MATCH_AUTO || match.runnerUp)
          ? 'suggested'
          : 'matched'
        : 'unresolved';
    return { key, nameAsWritten: row.nameAsWritten, match, status, entries, conflicts };
  });

  /* 5. dwie różne nazwy z grafiku → ta sama osoba w bazie */
  const byTarget = new Map<string, string[]>();
  for (const p of persons) {
    if (p.match.personId && p.status !== 'unresolved') {
      byTarget.set(p.match.personId, [...(byTarget.get(p.match.personId) ?? []), p.key]);
    }
  }
  const duplicateTargets = [...byTarget.values()].filter((g) => g.length > 1);

  /* 6. podejrzanie mało dni u osoby */
  const counts = persons.map((p) => p.entries.length);
  if (persons.length >= 3) {
    const m = median(counts);
    if (m >= 6) {
      for (const p of persons) {
        if (p.entries.length < m * 0.4) {
          warnings.push(`Sprawdź osobę ${p.nameAsWritten} — wykryto ${p.entries.length} dni.`);
        }
      }
    }
  }

  return { period, persons, excluded, warnings, duplicateTargets };
}
