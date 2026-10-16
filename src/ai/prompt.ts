import { DEFAULT_HOURS } from '../domain/hours';
import type { DefaultHours, ISODate, Person } from '../domain/types';

/** Wersja promptu zapisywana w ImportBatch — pozwala porównywać jakość po zmianach (plan 4.5). */
export const PROMPT_VERSION = '1';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** „Sun–Thu 10:00–22:00, Fri–Sat 10:00–23:00” z ustawień (nie na sztywno). */
function describeDefaultHours(h: DefaultHours): string {
  const order = [0, 1, 2, 3, 4, 5, 6] as const;
  const groups: { range: string; days: number[] }[] = [];
  for (const d of order) {
    const range = `${h[d].start}–${h[d].end}`;
    const g = groups.find((x) => x.range === range && x.days[x.days.length - 1] === d - 1);
    if (g) g.days.push(d);
    else groups.push({ range, days: [d] });
  }
  return groups
    .map((g) => {
      const first = DAYS[g.days[0]!];
      const last = DAYS[g.days[g.days.length - 1]!];
      return `${first === last ? first : `${first}–${last}`} ${g.range}`;
    })
    .join(', ');
}

export interface PromptContext {
  today: ISODate;
  /** okres wskazany przez użytkownika, np. „2026-11” */
  suggestedPeriod?: string;
  people: Pick<Person, 'firstName' | 'lastName' | 'aliases'>[];
  defaults?: DefaultHours;
}

export function buildPrompt(ctx: PromptContext): string {
  const known = ctx.people.length
    ? ctx.people
        .map((p) => {
          const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
          return p.aliases.length ? `${name}: ${p.aliases.join(', ')}` : name;
        })
        .join('; ')
    : '(none)';
  const period = ctx.suggestedPeriod ?? ctx.today.slice(0, 7);

  return `You are extracting a staff work schedule from a photo. The schedule is in Polish.
Today is ${ctx.today}. If month/year are not visible, assume ${period}.
Known staff (name: aliases): ${known}.
Default shift hours if a cell only marks that someone works:
${describeDefaultHours(ctx.defaults ?? DEFAULT_HOURS)}.

Rules:
- Return one entry per person per day where the cell is NOT empty.
- Copy the cell text exactly into rawCell.
- If the cell contains hours (e.g. "10-18", "14:00–23"), fill start/end as HH:MM.
- If the cell only marks work (X, ✓, 1, D, a letter from the legend meaning work), set kind="work" and leave start/end null.
- Recognise Polish abbreviations: W/wolne = off, U/UW/urlop = vacation, L4/ch = sick.
- Read the legend if present and return it.
- Polish weekday headers: Pn, Wt, Śr, Cz, Pt, Sb, Nd. Copy the header of the entry's column into "weekday" when visible.
- Never invent people or days. If unsure, lower confidence (0–1) and add a warning.
- Dates must be YYYY-MM-DD and match the weekday headers when visible.
- The table may be transposed (people as columns, days as rows) or split into weeks; detect the layout.
- Crossed-out or overwritten cells: use the visible final value and add a warning.
- Ignore totals rows/columns (e.g. "Suma", "Razem", "h").`;
}

/** Opis kształtu JSON dołączany do promptu, gdy API odrzuciło responseSchema (plan 4.1: fallback). */
export const JSON_SHAPE_HINT = `Return ONLY valid JSON (no markdown) with this exact shape:
{"period":{"month":int|null,"year":int|null,"startDate":"YYYY-MM-DD"|null,"endDate":"YYYY-MM-DD"|null},
"legend":[{"symbol":string,"meaning":"work"|"off"|"vacation"|"sick"|"other","start":"HH:MM"|null,"end":"HH:MM"|null}],
"people":[{"nameAsWritten":string,"entries":[{"date":"YYYY-MM-DD","weekday":string|null,"rawCell":string,"kind":"work"|"off"|"vacation"|"sick"|"other","start":"HH:MM"|null,"end":"HH:MM"|null,"confidence":number}]}],
"warnings":[string]}`;
