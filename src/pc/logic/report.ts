import { addDays, diffDays, weekdayOf } from '../../domain/dates';
import { formatHours } from '../../domain/i18n';
import { displayNames } from '../../domain/people';
import { inRange, shiftWorkMinutes } from '../../domain/totals';
import type { ISODate, Person, Shift } from '../../domain/types';

/** Raport godzin za dowolny zakres dat — jedna funkcja sum (`shiftWorkMinutes`) jak w reszcie aplikacji. */
export interface ReportRow {
  personId: string;
  name: string;
  workDays: number;
  minutes: number;
  /** dni pracy w piątek i sobotę (długie zmiany) */
  fridaySaturdayDays: number;
  off: number;
  vacation: number;
  sick: number;
  other: number;
}

export interface Report {
  from: ISODate;
  to: ISODate;
  rows: ReportRow[];
  totals: Omit<ReportRow, 'personId' | 'name'>;
  /** obsada dzienna: liczba osób w pracy */
  staffing: { date: ISODate; count: number }[];
  maxStaffing: number;
}

const zero = () => ({
  workDays: 0,
  minutes: 0,
  fridaySaturdayDays: 0,
  off: 0,
  vacation: 0,
  sick: 0,
  other: 0,
});

export function buildReport(
  persons: Person[],
  shifts: Shift[],
  from: ISODate,
  to: ISODate,
  opts: { includeEmpty?: boolean } = {},
): Report {
  const live = persons.filter((p) => !p.deletedAt).sort((a, b) => a.order - b.order);
  const names = displayNames(live);
  const rows = new Map<string, ReportRow>(
    live.map((p) => [p.id, { personId: p.id, name: names.get(p.id) ?? p.firstName, ...zero() }]),
  );
  const people = new Map<ISODate, Set<string>>();

  for (const s of shifts) {
    if (s.deletedAt || !inRange(s.date, from, to)) continue;
    const r = rows.get(s.personId);
    if (!r) continue;
    if (s.kind === 'work') {
      const m = shiftWorkMinutes(s);
      r.workDays++;
      r.minutes += m;
      const wd = weekdayOf(s.date);
      if (wd === 5 || wd === 6) r.fridaySaturdayDays++;
      let set = people.get(s.date);
      if (!set) people.set(s.date, (set = new Set()));
      set.add(s.personId);
    } else if (s.kind === 'off') r.off++;
    else if (s.kind === 'vacation') r.vacation++;
    else if (s.kind === 'sick') r.sick++;
    else r.other++;
  }

  const all = [...rows.values()];
  const kept = opts.includeEmpty
    ? all
    : all.filter(
        (r) =>
          !persons.find((p) => p.id === r.personId)?.archived ||
          r.workDays + r.off + r.vacation + r.sick + r.other > 0,
      );
  const totals = zero();
  for (const r of kept)
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += r[k];

  const span = Math.max(0, diffDays(from, to));
  const staffing = Array.from({ length: span + 1 }, (_, i) => {
    const date = addDays(from, i);
    return { date, count: people.get(date)?.size ?? 0 };
  });
  return {
    from,
    to,
    rows: kept,
    totals,
    staffing,
    maxStaffing: staffing.reduce((m, d) => Math.max(m, d.count), 0),
  };
}

/* ---------------------------------------------------------------- CSV */

/** Pole CSV z cudzysłowami, gdy trzeba (separator, cudzysłów, nowa linia) + ochrona przed formułami arkusza. */
export function csvField(v: string | number, sep = ';'): string {
  let s = String(v);
  if (/^[=+@]/.test(s) || (/^-/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s))) s = `'${s}`;
  return s.includes(sep) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number)[][], sep = ';'): string {
  return rows.map((r) => r.map((c) => csvField(c, sep)).join(sep)).join('\r\n');
}

const plain = (minutes: number) =>
  (minutes / 60).toLocaleString('pl-PL', { maximumFractionDigits: 2 });

export function reportToCsv(rep: Report): string {
  const head = ['Osoba', 'Dni pracy', 'Godziny', 'Pt/Sb', 'Wolne', 'Urlop', 'L4', 'Inne'];
  const body = rep.rows.map((r) => [
    r.name,
    r.workDays,
    plain(r.minutes),
    r.fridaySaturdayDays,
    r.off,
    r.vacation,
    r.sick,
    r.other,
  ]);
  const t = rep.totals;
  const foot = [
    'Razem',
    t.workDays,
    plain(t.minutes),
    t.fridaySaturdayDays,
    t.off,
    t.vacation,
    t.sick,
    t.other,
  ];
  return toCsv([head, ...body, foot]);
}

export const hoursText = (minutes: number) => (minutes ? formatHours(minutes) : '—');

/** Siatka osoby × dni jako CSV (nagłówek: data i dzień tygodnia; ostatnia kolumna: godziny). */
export function gridToCsv(persons: Person[], days: ISODate[], shifts: Shift[]): string {
  const names = displayNames(persons);
  const bySlot = new Map(
    shifts.filter((s) => !s.deletedAt).map((s) => [`${s.personId}|${s.date}`, s]),
  );
  const dayNames = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];
  const head = [
    'Osoba',
    ...days.map((d) => `${d.slice(8)}.${d.slice(5, 7)} ${dayNames[weekdayOf(d)]}`),
    'Godziny',
  ];
  const rows = persons.map((p) => {
    let minutes = 0;
    const cells = days.map((d) => {
      const s = bySlot.get(`${p.id}|${d}`);
      if (!s) return '';
      minutes += shiftWorkMinutes(s);
      if (s.kind === 'work') return s.start && s.end ? `${s.start}-${s.end}` : 'x';
      return { off: 'W', vacation: 'U', sick: 'L4', other: 'I' }[s.kind];
    });
    return [names.get(p.id) ?? p.firstName, ...cells, plain(minutes)];
  });
  return toCsv([head, ...rows]);
}
