import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { fromISODate } from '../../../domain/dates';
import { plural, SHIFTS } from '../../../domain/i18n';
import { shiftLabel } from '../../../domain/labels';
import { fullName } from '../../../domain/people';
import { shiftWorkMinutes } from '../../../domain/totals';
import type { Person, Shift } from '../../../domain/types';
import { darken, periodTitle, personHex, plainHours, tint, type PdfOptions } from '../model';
import { fmtDate } from './teamGrid';

export interface PersonInput {
  options: PdfOptions;
  people: Person[];
  shifts: Shift[];
  generatedAt: Date;
}

const MUTED = '#8E8E93';
const LINE = '#C7C7CC';
const GRAY = '#F2F2F7';

const weekdayLong = new Intl.DateTimeFormat('pl-PL', { weekday: 'long' });
const fmtShort = (iso: string) => `${Number(iso.slice(8))}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** Lista osoby, A4 pionowo (plan 9): data | dzień | godziny | h | notatka + podsumowanie. */
export function buildPersonPdf(input: PersonInput): TDocumentDefinitions {
  const { options, people } = input;
  const color = options.color;
  const content: Content[] = [];

  people.forEach((p, idx) => {
    const own = input.shifts
      .filter(
        (s) =>
          !s.deletedAt &&
          s.personId === p.id &&
          s.date >= options.range.from &&
          s.date <= options.range.to,
      )
      .sort((a, b) => a.date.localeCompare(b.date));
    const hex = personHex(p.color);
    const works = own.filter((s) => s.kind === 'work');
    const total = works.reduce((n, s) => n + shiftWorkMinutes(s), 0);

    content.push({
      columns: [
        {
          stack: [
            {
              text: fullName(p) || p.firstName,
              fontSize: 18,
              bold: true,
              color: color ? darken(hex, 0.35) : '#000000',
            },
            { text: periodTitle(options.range), fontSize: 11, color: MUTED },
          ],
        },
        {
          text: `Wygenerowano: ${fmtDate(input.generatedAt)}`,
          fontSize: 8,
          color: MUTED,
          alignment: 'right',
          width: 'auto',
        },
      ],
      margin: [0, 0, 0, 8],
      ...(idx > 0 ? { pageBreak: 'before' as const } : {}),
    });

    if (own.length === 0) {
      content.push({ text: 'Brak zmian w wybranym okresie.', fontSize: 10, color: MUTED });
      return;
    }

    const header: TableCell[] = [
      { text: 'Data', style: 'th' },
      { text: 'Dzień', style: 'th' },
      { text: 'Godziny', style: 'th' },
      { text: 'h', style: 'th', alignment: 'right' },
      ...(options.showNotes ? [{ text: 'Notatka', style: 'th' } as TableCell] : []),
    ];
    const rows: TableCell[][] = own.map((s) => {
      const wd = fromISODate(s.date).getDay();
      const weekend = wd === 0 || wd === 6;
      const work = s.kind === 'work';
      const fill = work && color ? tint(hex, 0.12) : weekend ? GRAY : undefined;
      const row: TableCell[] = [
        { text: fmtShort(s.date), fillColor: fill },
        { text: weekdayLong.format(fromISODate(s.date)), fillColor: fill },
        { text: shiftLabel(s), bold: work, color: work ? '#000000' : MUTED, fillColor: fill },
        { text: work ? plainHours(shiftWorkMinutes(s)) : '', alignment: 'right', fillColor: fill },
      ];
      if (options.showNotes)
        row.push({ text: s.note ?? '', fontSize: 9, color: '#3A3A3C', fillColor: fill });
      return row;
    });

    content.push({
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: options.showNotes ? [62, 78, 96, 28, '*'] : [70, 100, 120, 40],
        heights: (row: number) => (row === 0 ? 20 : 20),
        body: [header, ...rows],
      },
      layout: {
        hLineWidth: (i: number) => (i <= 1 ? 0.8 : 0.4),
        vLineWidth: () => 0,
        hLineColor: () => LINE,
        paddingLeft: () => 4,
        paddingRight: () => 4,
        paddingTop: () => 4,
        paddingBottom: () => 4,
      },
    });

    if (options.showTotals) {
      content.push({
        text: [
          { text: 'Podsumowanie: ', bold: true },
          `${plural(works.length, SHIFTS)}, suma ${plainHours(total)} h`,
        ],
        margin: [0, 10, 0, 0],
        fontSize: 10,
      });
    }
  });

  return {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: [40, 40, 40, 40],
    info: { title: `Grafik — ${periodTitle(options.range)}`, creator: 'Grafik' },
    defaultStyle: { font: 'Inter', fontSize: 10, color: '#1C1C1E' },
    styles: { th: { fontSize: 8.5, bold: true, color: MUTED } },
    footer: (current: number, count: number) => ({
      text: `Strona ${current} z ${count}`,
      alignment: 'center',
      fontSize: 8,
      color: MUTED,
      margin: [0, 12, 0, 0],
    }),
    content,
  };
}
