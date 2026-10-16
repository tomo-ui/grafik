import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { weekdayOf } from '../../../domain/dates';
import { DAY_SHORT } from '../../../domain/i18n';
import { shiftWorkMinutes, staffingByDay, totalsByPerson } from '../../../domain/totals';
import { describeDefaults } from '../../../domain/shiftForm';
import type { DefaultHours, ISODate, Person, Shift } from '../../../domain/types';
import {
  cellFontSize,
  cellText,
  MIN_CELL_FONT,
  darken,
  periodTitle,
  personHex,
  plainHours,
  rangeDays,
  splitDays,
  tint,
  truncate,
  type PdfOptions,
} from '../model';

export interface TeamInput {
  options: PdfOptions;
  /** osoby w kolejności wyświetlania (już przefiltrowane wg opcji) */
  people: Person[];
  /** zmiany z zakresu (mogą zawierać innych ludzi — filtrujemy po `people`) */
  shifts: Shift[];
  names: Map<string, string>;
  defaults: DefaultHours;
  generatedAt: Date;
}

const GRAY = '#F2F2F7';
const BW_GRAY = '#E5E5EA';
const LINE = '#C7C7CC';
const TEXT = '#1C1C1E';
const MUTED = '#8E8E93';

/** Szerokości stałe (pt) strony A4 poziomo: 842 − 2 × 24 marginesu = 794 pt użytecznych. */
const BAR_W = 5;
const NAME_W = 74;
const SUM_W = 30;
const TOTAL_W = 38;
/** pdfmake dolicza padding komórek do szerokości kolumn — uwzględniamy to w rachunku */
const PAD = 3;
const PAGE_W = 794;

export const fmtDate = (d: Date) =>
  `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

/** Siatka zespołu, A4 poziomo (plan 9). Czyste dane → definicja dokumentu pdfmake. */
export function buildTeamPdf(input: TeamInput): TDocumentDefinitions {
  const { options, people, names, defaults } = input;
  const ids = new Set(people.map((p) => p.id));
  const shifts = input.shifts.filter(
    (s) =>
      !s.deletedAt &&
      ids.has(s.personId) &&
      s.date >= options.range.from &&
      s.date <= options.range.to,
  );
  const byKey = new Map(shifts.map((s) => [`${s.personId}|${s.date}`, s]));
  const days = rangeDays(options.range.from, options.range.to);
  const parts = splitDays(days);
  const color = options.color;
  const multiPart = parts.length > 1;
  const maxCols = Math.max(...parts.map((p) => p.length));
  // te same szerokości kolumn dni w obu częściach (odniesienie: część 2 z dodatkową kolumną „Razem”)
  const sumArea = options.showTotals ? (multiPart ? SUM_W + TOTAL_W : SUM_W) : 0;
  const sumCols = options.showTotals ? (multiPart ? 2 : 1) : 0;
  const dayW: string | number = multiPart
    ? Math.floor(
        (PAGE_W - BAR_W - NAME_W - sumArea - ((2 + maxCols + sumCols) * PAD * 2) / 2) / maxCols,
      )
    : '*';
  const totalAll = totalsByPerson(shifts, options.range.from, options.range.to);
  const staffing = staffingByDay(shifts, options.range.from, options.range.to);

  const content: Content[] = [
    {
      columns: [
        {
          stack: [
            { text: 'Grafik pracy', style: 'title' },
            { text: periodTitle(options.range), style: 'period' },
          ],
        },
        {
          text: `Wygenerowano: ${fmtDate(input.generatedAt)}`,
          style: 'small',
          alignment: 'right',
          width: 'auto',
        },
      ],
      margin: [0, 0, 0, 8],
    },
  ];

  parts.forEach((partDays, partIdx) => {
    const multi = parts.length > 1;
    const fs = cellFontSize(partDays.length);
    const secondPart = multi && partIdx === 1;
    const partTotals = totalsByPerson(shifts, partDays[0]!, partDays[partDays.length - 1]!);

    const weekendFill = (d: ISODate) => {
      const wd = weekdayOf(d);
      return wd === 0 || wd === 6 ? (color ? GRAY : BW_GRAY) : undefined;
    };

    /* nagłówek: osoby | dni (dwie linie: Pn / 3) | sumy */
    const header: TableCell[] = [
      { text: '', fillColor: undefined },
      { text: 'Osoba', style: 'th', alignment: 'left' },
      ...partDays.map<TableCell>((d) => ({
        stack: [
          {
            text: DAY_SHORT[weekdayOf(d)]!,
            fontSize: Math.max(MIN_CELL_FONT, fs - 0.5),
            color: MUTED,
            alignment: 'center',
          },
          { text: String(Number(d.slice(8))), fontSize: fs + 0.5, bold: true, alignment: 'center' },
        ],
        fillColor: weekendFill(d),
      })),
    ];
    if (options.showTotals) header.push({ text: 'Σ h', style: 'th', alignment: 'right' });
    if (options.showTotals && secondPart)
      header.push({ text: 'Razem', style: 'th', alignment: 'right' });

    const nameChars = Math.floor((NAME_W - 8) / (fs * 0.62));
    const rows: TableCell[][] = people.map((p) => {
      const hex = personHex(p.color);
      const row: TableCell[] = [
        { text: '', fillColor: color ? hex : undefined },
        {
          text: truncate(names.get(p.id) ?? p.firstName, nameChars),
          fontSize: fs + 0.5,
          bold: true,
          color: TEXT,
        },
        ...partDays.map<TableCell>((d) => {
          const s = byKey.get(`${p.id}|${d}`);
          if (!s) return { text: '', fillColor: weekendFill(d) };
          const work = s.kind === 'work';
          return {
            text: cellText(s),
            alignment: 'center',
            fontSize: fs,
            bold: work,
            color: work ? (color ? darken(hex) : '#000000') : MUTED,
            italics: !work,
            fillColor: work && color ? tint(hex, 0.2) : weekendFill(d),
          };
        }),
      ];
      if (options.showTotals) {
        row.push({
          text: plainHours(partTotals.get(p.id) ?? 0),
          alignment: 'right',
          fontSize: fs,
          color: TEXT,
        });
        if (secondPart) {
          row.push({
            text: plainHours(totalAll.get(p.id) ?? 0),
            alignment: 'right',
            fontSize: fs,
            bold: true,
            color: TEXT,
          });
        }
      }
      return row;
    });

    if (options.showStaffing) {
      const staff: TableCell[] = [
        {
          text: 'Obsada',
          colSpan: 2,
          fontSize: fs,
          bold: true,
          color: MUTED,
          fillColor: color ? GRAY : BW_GRAY,
        },
        {},
        ...partDays.map<TableCell>((d) => {
          const n = staffing.get(d) ?? 0;
          return {
            text: n > 0 ? String(n) : '',
            alignment: 'center',
            fontSize: fs,
            color: MUTED,
            fillColor: color ? GRAY : BW_GRAY,
          };
        }),
      ];
      if (options.showTotals) {
        staff.push({ text: '', fillColor: color ? GRAY : BW_GRAY });
        if (secondPart) staff.push({ text: '', fillColor: color ? GRAY : BW_GRAY });
      }
      rows.push(staff);
    }

    const widths: (string | number)[] = [
      BAR_W,
      NAME_W,
      ...partDays.map(() => dayW),
      ...(options.showTotals ? [SUM_W] : []),
      ...(options.showTotals && secondPart ? [TOTAL_W] : []),
    ];

    if (multi) {
      const first = Number(partDays[0]!.slice(8));
      const last = Number(partDays[partDays.length - 1]!.slice(8));
      content.push({
        text: `Część ${partIdx + 1} z ${parts.length} · dni ${first}–${last}`,
        style: 'part',
        ...(partIdx > 0 ? { pageBreak: 'before' as const } : {}),
      });
    }
    content.push({
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths,
        // wiersz ≥ 18 pt; nagłówek dwuliniowy
        heights: (row: number) => (row === 0 ? 30 : 18),
        body: [header, ...rows],
      },
      layout: {
        hLineWidth: (i: number) => (i === 0 || i === 1 ? 0.8 : 0.4),
        vLineWidth: (i: number) => (i === 1 ? 0 : 0.3),
        hLineColor: () => (color ? LINE : '#555555'),
        vLineColor: () => (color ? LINE : '#777777'),
        paddingLeft: () => PAD / 2,
        paddingRight: () => PAD / 2,
        paddingTop: () => 3,
        paddingBottom: () => 3,
      },
    });
  });

  /* notatki (opcja) */
  if (options.showNotes) {
    const notes = shifts
      .filter((s) => s.note)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(
        (s) =>
          `${Number(s.date.slice(8))}.${s.date.slice(5, 7)} · ${names.get(s.personId) ?? ''}: ${s.note}`,
      );
    if (notes.length > 0) {
      content.push({ text: 'Notatki', style: 'sectionTitle', margin: [0, 10, 0, 2] });
      content.push({ ul: notes, fontSize: 8.5, color: TEXT });
    }
  }

  /* legenda */
  const legend: Content[] = [{ text: 'Legenda', style: 'sectionTitle', margin: [0, 12, 0, 3] }];
  if (color) {
    legend.push({
      text: people.flatMap((p) => [
        { text: '■ ', color: personHex(p.color), fontSize: 9 },
        { text: `${names.get(p.id) ?? p.firstName}   `, fontSize: 8.5, color: TEXT },
      ]),
      margin: [0, 0, 0, 2],
    });
  }
  legend.push({
    text: `W — wolne   ·   U — urlop   ·   L4 — zwolnienie lekarskie   ·${
      options.showTotals ? '   Σ h — suma godzin pracy   ·' : ''
    }   Godziny domyślne: ${describeDefaults(defaults)}`,
    fontSize: 8,
    color: MUTED,
  });
  content.push({ stack: legend, unbreakable: true });

  return {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [24, 28, 24, 34],
    info: { title: `Grafik pracy — ${periodTitle(options.range)}`, creator: 'Grafik' },
    defaultStyle: { font: 'Inter', fontSize: 9, color: TEXT },
    styles: {
      title: { fontSize: 16, bold: true },
      period: { fontSize: 12, color: MUTED },
      part: { fontSize: 10, bold: true, margin: [0, 0, 0, 4] },
      sectionTitle: { fontSize: 9, bold: true },
      small: { fontSize: 8, color: MUTED },
      th: { fontSize: 8, bold: true, color: MUTED },
    },
    footer: (current: number, count: number) => ({
      text: `Strona ${current} z ${count}`,
      alignment: 'center',
      fontSize: 8,
      color: MUTED,
      margin: [0, 10, 0, 0],
    }),
    content,
  };
}

/** Do testów: suma godzin pracy wg tej samej funkcji co w aplikacji. */
export const minutesOf = shiftWorkMinutes;
