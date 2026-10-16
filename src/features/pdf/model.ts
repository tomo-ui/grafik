import { addDays, diffDays, monthDays, weekDays, fromISODate } from '../../domain/dates';
import { parseHHMM } from '../../domain/hours';
import { KIND_SHORT } from '../../domain/labels';
import { normalizeName } from '../../ai/names';
import { formatDayLong } from '../../domain/i18n';
import type { ISODate, Shift } from '../../domain/types';

/* Opcje i czysta logika eksportu PDF (plan 8.7, 9). */

export type PdfLayout = 'team' | 'person';
export type RangeKind = 'week' | 'month' | 'custom';

export interface PdfOptions {
  layout: PdfLayout;
  range: { kind: RangeKind; from: ISODate; to: ISODate };
  /** 'all' | 'me' | lista id */
  people: 'all' | 'me' | string[];
  color: boolean;
  showTotals: boolean;
  showStaffing: boolean;
  showNotes: boolean;
}

/** Maks. długość własnego zakresu (dwie części po ≤ 16 dni). */
export const MAX_RANGE_DAYS = 31;
/** Zakres dłuższy niż to dzielimy ZAWSZE na dwie części (plan 9). */
export const SINGLE_PART_MAX_DAYS = 16;
export const FIRST_PART_DAYS = 15;
/** Minimalny rozmiar czcionki w komórkach — nigdy mniejszy (plan 9). */
export const MIN_CELL_FONT = 7.5;

export function defaultOptions(today: ISODate): PdfOptions {
  const days = monthDays(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
  return {
    layout: 'team',
    range: { kind: 'month', from: days[0]!, to: days[days.length - 1]! },
    people: 'all',
    color: true,
    showTotals: true,
    showStaffing: true,
    showNotes: false,
  };
}

/** Zakres dla tygodnia/miesiąca zawierającego `anchor`. */
export function rangeFor(kind: 'week' | 'month', anchor: ISODate, weekStartsOn: 0 | 1) {
  if (kind === 'week') {
    const w = weekDays(anchor, weekStartsOn);
    return { kind, from: w[0]!, to: w[6]! } as const;
  }
  const m = monthDays(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)));
  return { kind, from: m[0]!, to: m[m.length - 1]! } as const;
}

export function rangeDays(from: ISODate, to: ISODate): ISODate[] {
  const n = diffDays(from, to);
  return Array.from({ length: Math.max(0, n) + 1 }, (_, i) => addDays(from, i));
}

export function validateRange(from: ISODate, to: ISODate): string | null {
  if (to < from) return 'Koniec zakresu nie może być przed początkiem.';
  if (diffDays(from, to) + 1 > MAX_RANGE_DAYS) {
    return `Zakres może mieć maksymalnie ${MAX_RANGE_DAYS} dni.`;
  }
  return null;
}

/**
 * Deterministyczny podział na części (plan 9): ≤ 16 dni → jedna część; > 16 → zawsze dwie:
 * dni 1–15 i 16–koniec.
 */
export function splitDays(days: ISODate[]): ISODate[][] {
  if (days.length <= SINGLE_PART_MAX_DAYS) return [days];
  return [days.slice(0, FIRST_PART_DAYS), days.slice(FIRST_PART_DAYS)];
}

/** Rozmiar czcionki w komórkach zależnie od liczby kolumn dni; zawsze ≥ 7,5 pt. */
export function cellFontSize(dayColumns: number): number {
  // przy 13–16 kolumnach „10:30–23” musi zmieścić się w jednej linii → minimalny dozwolony rozmiar
  const size = dayColumns <= 7 ? 10 : dayColumns <= 12 ? 9 : MIN_CELL_FONT;
  return Math.max(MIN_CELL_FONT, size);
}

const plNum = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 });
/** Minuty → „12,5” (bez jednostki, do kolumny Σ h). */
export const plainHours = (minutes: number) => plNum.format(minutes / 60);

const hourShort = (hhmm: string): string => {
  const m = parseHHMM(hhmm);
  if (m === null) return hhmm;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm === 0 ? String(h) : `${h}:${String(mm).padStart(2, '0')}`;
};

/** Krótki zapis do komórki: „10–22”, „10:30–16”, wolne „W”, urlop „U”, L4 „L4”. */
export function cellText(s: Pick<Shift, 'kind' | 'start' | 'end'>): string {
  if (s.kind !== 'work') return KIND_SHORT[s.kind];
  if (!s.start || !s.end) return '?';
  return `${hourShort(s.start)}–${hourShort(s.end)}`;
}

/** Przycina tekst do `maxChars` znaków z wielokropkiem (szacunek szerokości kolumny). */
export function truncate(text: string, maxChars: number): string {
  const chars = [...text];
  if (chars.length <= maxChars) return text;
  return `${chars
    .slice(0, Math.max(1, maxChars - 1))
    .join('')
    .trimEnd()}…`;
}

/** Bezpieczny dla nazw plików slug: małe litery, bez polskich znaków (ł→l). */
export function slug(s: string): string {
  return (
    normalizeName(s)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'osoba'
  );
}

/** Imię do nazwy pliku: bez polskich znaków (ł→l) i spacji, wielkość liter zachowana. */
export function asciiName(s: string): string {
  return (
    s
      .replace(/ł/g, 'l')
      .replace(/Ł/g, 'L')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '') || 'osoba'
  );
}

/**
 * Nazwa pliku: `Grafik_2026-11.pdf` (cały miesiąc) albo `Grafik_2026-11-03_2026-11-09.pdf`.
 * Układ „lista osoby” dopisuje imię: `Grafik_Ania_2026-11.pdf`.
 */
export function pdfFileName(range: { from: ISODate; to: ISODate }, personName?: string): string {
  const days = monthDays(Number(range.from.slice(0, 4)), Number(range.from.slice(5, 7)));
  const wholeMonth = range.from === days[0] && range.to === days[days.length - 1];
  const period = wholeMonth ? range.from.slice(0, 7) : `${range.from}_${range.to}`;
  const who = personName ? `_${asciiName(personName)}` : '';
  return `Grafik${who}_${period}.pdf`;
}

/** „3–9 listopada 2026” / „Listopad 2026” / „3.11 – 9.12.2026”. */
export function periodTitle(range: { kind: RangeKind; from: ISODate; to: ISODate }): string {
  const monthDaysList = monthDays(Number(range.from.slice(0, 4)), Number(range.from.slice(5, 7)));
  const whole =
    range.from === monthDaysList[0] && range.to === monthDaysList[monthDaysList.length - 1];
  const fmtMonth = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' });
  if (whole) {
    const t = fmtMonth.format(fromISODate(range.from));
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  const f = fromISODate(range.from);
  const t = fromISODate(range.to);
  // dopełniacz („listopada”): sam `month: 'long'` daje mianownik, więc formatujemy z dniem i go odcinamy
  const month = (d: Date) =>
    new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long' })
      .format(d)
      .replace(/^\d+\s*/, '');
  if (f.getFullYear() === t.getFullYear() && f.getMonth() === t.getMonth()) {
    return `${f.getDate()}–${t.getDate()} ${month(t)} ${t.getFullYear()}`;
  }
  if (f.getFullYear() === t.getFullYear()) {
    return `${f.getDate()} ${month(f)} – ${t.getDate()} ${month(t)} ${t.getFullYear()}`;
  }
  return `${f.getDate()} ${month(f)} ${f.getFullYear()} – ${t.getDate()} ${month(t)} ${t.getFullYear()}`;
}

/** Data w tabeli osoby: „wtorek, 3 listopada” → kolumny rozdzielamy w builderze. */
export const longDay = (d: ISODate) => formatDayLong(d);

/* ----------------------------- kolory (PDF jest dokumentem, nie ma CSS-a) ----------------------------- */

/** Kolory osób (wartości trybu jasnego, jak w tokenach interfejsu). */
export const PERSON_HEX: Record<string, string> = {
  blue: '#007AFF',
  green: '#34C759',
  orange: '#FF9500',
  pink: '#FF2D55',
  purple: '#AF52DE',
  teal: '#30B0C7',
  indigo: '#5856D6',
  red: '#FF3B30',
  yellow: '#FFCC00',
  mint: '#00C7BE',
  cyan: '#32ADE6',
  brown: '#A2845E',
};

const toRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
};
const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b]
    .map((x) =>
      Math.round(Math.max(0, Math.min(255, x)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/** Miesza kolor z bielym: ratio = udział koloru (np. 0,18 → delikatne tło komórki). */
export function tint(hex: string, ratio: number): string {
  const [r, g, b] = toRgb(hex);
  return toHex(255 - (255 - r) * ratio, 255 - (255 - g) * ratio, 255 - (255 - b) * ratio);
}

/** Ciemniejsza wersja koloru na tekst (kontrast na jasnym tle komórki). */
export function darken(hex: string, ratio = 0.55): string {
  const [r, g, b] = toRgb(hex);
  return toHex(r * (1 - ratio), g * (1 - ratio), b * (1 - ratio));
}

export const personHex = (color: string) => PERSON_HEX[color] ?? '#8E8E93';
