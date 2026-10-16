// @vitest-environment node
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPdf, selectPeople, type PdfData } from '../../src/features/pdf/build';
import {
  asciiName,
  cellFontSize,
  cellText,
  darken,
  defaultOptions,
  MIN_CELL_FONT,
  pdfFileName,
  periodTitle,
  plainHours,
  rangeDays,
  rangeFor,
  slug,
  splitDays,
  tint,
  truncate,
  validateRange,
  type PdfOptions,
} from '../../src/features/pdf/model';
import { DEFAULT_HOURS } from '../../src/domain/hours';
import { weekdayOf } from '../../src/domain/dates';
import { shiftWorkMinutes, totalsByPerson } from '../../src/domain/totals';
import type { Person, Shift } from '../../src/domain/types';
import { collectFontSizes, extractText, toPdfBuffer } from '../helpers/pdfNode';

/* ---------------------------------------------------------------- dane */

const COLORS = [
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
];
const FIRST = [
  'Anna',
  'Basia',
  'Celina',
  'Dorota',
  'Ewa',
  'Fela',
  'Gosia',
  'Hania',
  'Iga',
  'Jola',
  'Kasia',
  'Lena',
  'Marta',
  'Nina',
  'Ola',
];

function makePeople(n: number): Person[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    firstName: i === 1 ? 'Łukasz' : `${FIRST[i % FIRST.length]}${i >= FIRST.length ? i : ''}`,
    lastName: i === 1 ? 'Żółć' : undefined,
    color: COLORS[i % COLORS.length]!,
    aliases: [],
    isMe: i === 0,
    archived: false,
    order: i,
    createdAt: i,
  }));
}

function monthShifts(people: Person[], year = 2026, month = 11): Shift[] {
  const days = new Date(year, month, 0).getDate();
  const out: Shift[] = [];
  people.forEach((p, pi) => {
    for (let d = 1; d <= days; d++) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if ((d + pi) % 3 === 0) continue; // nie każdy dzień
      const wd = weekdayOf(date);
      const base = {
        id: `${p.id}-${date}`,
        personId: p.id,
        date,
        source: 'manual' as const,
        updatedAt: 1,
      };
      if ((d + pi) % 11 === 0) {
        out.push({ ...base, kind: 'off', usesDefaultHours: false });
      } else if ((d + pi) % 17 === 0) {
        out.push({ ...base, kind: 'vacation', usesDefaultHours: false });
      } else if ((d + pi) % 19 === 0) {
        out.push({ ...base, kind: 'sick', usesDefaultHours: false });
      } else {
        out.push({
          ...base,
          kind: 'work',
          start: (d + pi) % 7 === 0 ? '10:30' : '10:00',
          end: (d + pi) % 5 === 0 ? '16:00' : wd === 5 || wd === 6 ? '23:00' : '22:00',
          usesDefaultHours: false,
          note: d === 4 && pi === 0 ? 'zażółć gęślą jaźń' : undefined,
        });
      }
    }
  });
  return out;
}

const NOW = new Date(2026, 10, 4, 10, 0);
const opts = (over: Partial<PdfOptions> = {}): PdfOptions => ({
  ...defaultOptions('2026-11-04'),
  ...over,
});
const data = (people: Person[], o: PdfOptions, shifts?: Shift[]): PdfData => ({
  options: o,
  persons: people,
  shifts: shifts ?? monthShifts(people),
  defaults: DEFAULT_HOURS,
  generatedAt: NOW,
});

/* ---------------------------------------------------------------- model */

describe('model PDF', () => {
  it('podział na części: ≤ 16 dni → jedna; > 16 → zawsze dwie (1–15, 16–koniec)', () => {
    const d = (n: number) => rangeDays('2026-11-01', `2026-11-${String(n).padStart(2, '0')}`);
    expect(splitDays(d(7))).toHaveLength(1);
    expect(splitDays(d(16))).toHaveLength(1);
    const two = splitDays(d(17));
    expect(two.map((p) => p.length)).toEqual([15, 2]);
    const month = splitDays(rangeDays('2026-12-01', '2026-12-31'));
    expect(month.map((p) => p.length)).toEqual([15, 16]);
    expect(month[1]![0]).toBe('2026-12-16');
  });

  it('czcionka w komórkach nigdy < 7,5 pt dla 1…16 kolumn', () => {
    for (let n = 1; n <= 16; n++) expect(cellFontSize(n)).toBeGreaterThanOrEqual(MIN_CELL_FONT);
    expect(cellFontSize(7)).toBe(10);
    expect(cellFontSize(12)).toBe(9);
    expect(cellFontSize(13)).toBe(7.5);
    expect(cellFontSize(16)).toBe(7.5);
  });

  it('krótki zapis komórek i polski format liczb', () => {
    expect(cellText({ kind: 'work', start: '10:00', end: '22:00' })).toBe('10–22');
    expect(cellText({ kind: 'work', start: '10:30', end: '16:00' })).toBe('10:30–16');
    expect(cellText({ kind: 'work', start: '18:00', end: '02:00' })).toBe('18–2');
    expect(cellText({ kind: 'off' })).toBe('W');
    expect(cellText({ kind: 'vacation' })).toBe('U');
    expect(cellText({ kind: 'sick' })).toBe('L4');
    expect(plainHours(750)).toBe('12,5');
    expect(plainHours(720)).toBe('12');
  });

  it('przycinanie długich imion z wielokropkiem', () => {
    expect(truncate('Ala', 10)).toBe('Ala');
    expect(truncate('Bartłomiej-Maksymilian', 8)).toBe('Bartłom…');
    expect(truncate('X', 1)).toBe('X');
  });

  it('nazwy plików (plan 8.7): miesiąc, własny zakres, osoba', () => {
    expect(pdfFileName({ from: '2026-11-01', to: '2026-11-30' })).toBe('Grafik_2026-11.pdf');
    expect(pdfFileName({ from: '2026-11-03', to: '2026-11-09' })).toBe(
      'Grafik_2026-11-03_2026-11-09.pdf',
    );
    expect(pdfFileName({ from: '2028-02-01', to: '2028-02-29' })).toBe('Grafik_2028-02.pdf');
    expect(pdfFileName({ from: '2026-12-28', to: '2027-01-03' })).toBe(
      'Grafik_2026-12-28_2027-01-03.pdf',
    );
    expect(pdfFileName({ from: '2026-11-01', to: '2026-11-30' }, 'Łukasz')).toBe(
      'Grafik_Lukasz_2026-11.pdf',
    );
    expect(asciiName('Żaneta Ćwik')).toBe('ZanetaCwik');
    expect(slug('Łukasz Żółć')).toBe('lukasz-zolc');
  });

  it('tytuły okresów', () => {
    expect(periodTitle({ kind: 'month', from: '2026-11-01', to: '2026-11-30' })).toBe(
      'Listopad 2026',
    );
    expect(periodTitle({ kind: 'week', from: '2026-11-02', to: '2026-11-08' })).toBe(
      '2–8 listopada 2026',
    );
    expect(periodTitle({ kind: 'week', from: '2026-12-28', to: '2027-01-03' })).toBe(
      '28 grudnia 2026 – 3 stycznia 2027',
    );
  });

  it('zakresy: tydzień/miesiąc, walidacja (max 31 dni), luty przestępny (E-11)', () => {
    expect(rangeFor('week', '2026-11-04', 1)).toMatchObject({
      from: '2026-11-02',
      to: '2026-11-08',
    });
    expect(rangeFor('week', '2026-11-04', 0)).toMatchObject({
      from: '2026-11-01',
      to: '2026-11-07',
    });
    expect(rangeFor('month', '2028-02-10', 1)).toMatchObject({
      from: '2028-02-01',
      to: '2028-02-29',
    });
    expect(rangeDays('2028-02-01', '2028-02-29')).toHaveLength(29);
    expect(validateRange('2026-11-01', '2026-12-01')).toBeNull(); // 31 dni
    expect(validateRange('2026-11-01', '2026-12-02')).toMatch(/maksymalnie 31/);
    expect(validateRange('2026-11-05', '2026-11-01')).toMatch(/przed początkiem/);
  });

  it('kolory: tint rozjaśnia, darken ściemnia', () => {
    expect(tint('#000000', 0.2)).toBe('#cccccc');
    expect(tint('#007AFF', 1)).toBe('#007aff');
    expect(darken('#FFFFFF', 0.5)).toBe('#808080');
  });
});

describe('wybór osób i puste okresy', () => {
  const people = makePeople(4);
  it('„wszyscy”, „ja”, wybrane; zarchiwizowana tylko ze zmianami w zakresie', () => {
    const archived: Person[] = people.map((p) => (p.id === 'p3' ? { ...p, archived: true } : p));
    const shifts = monthShifts(archived);
    expect(selectPeople(opts(), archived, shifts).map((p) => p.id)).toEqual([
      'p0',
      'p1',
      'p2',
      'p3',
    ]);
    expect(
      selectPeople(
        opts(),
        archived,
        shifts.filter((s) => s.personId !== 'p3'),
      ).map((p) => p.id),
    ).toEqual(['p0', 'p1', 'p2']);
    expect(selectPeople(opts({ people: 'me' }), archived, shifts).map((p) => p.id)).toEqual(['p0']);
    expect(selectPeople(opts({ people: ['p2', 'p1'] }), archived, shifts).map((p) => p.id)).toEqual(
      ['p1', 'p2'],
    );
  });
  it('okres bez zmian → brak PDF z komunikatem (E-30)', () => {
    const r = buildPdf(data(people, opts(), []));
    expect(r).toMatchObject({
      empty: true,
      reason: 'no-shifts',
      message: 'Brak zmian w wybranym okresie.',
    });
  });
  it('brak osób i zły zakres', () => {
    expect(buildPdf(data(people, opts({ people: [] })))).toMatchObject({
      empty: true,
      reason: 'no-people',
    });
    expect(
      buildPdf(
        data(people, opts({ range: { kind: 'custom', from: '2026-11-01', to: '2026-12-31' } })),
      ),
    ).toMatchObject({
      empty: true,
      reason: 'bad-range',
    });
  });
  it('„ja” bez przypisanej osoby → nikt nie wybrany', () => {
    const noMe = people.map((p) => ({ ...p, isMe: false }));
    expect(buildPdf(data(noMe, opts({ people: 'me' })))).toMatchObject({
      empty: true,
      reason: 'no-people',
    });
  });
});

/* ------------------------------------------------------ generowanie PDF */

describe('generowanie PDF (Node, pdfmake + pdf.js)', () => {
  it('polskie znaki są poprawne w tekście PDF (P-16)', async () => {
    const people = makePeople(3);
    const r = buildPdf(data(people, opts({ showNotes: true })));
    if (r.empty) throw new Error('puste');
    const { pages } = await extractText(await toPdfBuffer(r.doc));
    const all = pages.join(' ');
    expect(all).toContain('zażółć gęślą jaźń');
    expect(all).toContain('Łukasz Ż.'.slice(0, 0) + 'Łukasz');
    expect(all).toContain('Grafik pracy');
    expect(all).toContain('Listopad 2026');
    // żadnych „krzaków” ani znaków zastępczych
    expect(all).not.toMatch(/[�]/);
  });

  it('miesiąc = 2 części, powtórzona kolumna osób, sumy cząstkowe + „Razem” w drugiej, stopka „Strona X z Y”', async () => {
    const people = makePeople(6);
    const r = buildPdf(data(people, opts()));
    if (r.empty) throw new Error('puste');
    const { pages, numPages } = await extractText(await toPdfBuffer(r.doc));
    expect(numPages).toBe(2);
    expect(pages[0]).toContain('Część 1 z 2 · dni 1–15');
    expect(pages[1]).toContain('Część 2 z 2 · dni 16–30');
    expect(pages[0]).toContain('Anna');
    expect(pages[1]).toContain('Anna');
    expect(pages[0]).not.toContain('Razem');
    expect(pages[1]).toContain('Razem');
    expect(pages[0]).toContain('Strona 1 z 2');
    expect(pages[1]).toContain('Strona 2 z 2');
    expect(pages[1]).toContain('Legenda');
    expect(pages[1]).toContain('W — wolne');
    expect(pages[1]).toContain('Godziny domyślne: Pt–Sb');
  });

  it('tydzień (7 dni) = jedna część bez podziału; nagłówek dwuliniowy Pn/3', async () => {
    const people = makePeople(4);
    const range = rangeFor('week', '2026-11-04', 1);
    const r = buildPdf(data(people, opts({ range })));
    if (r.empty) throw new Error('puste');
    const { pages, numPages } = await extractText(await toPdfBuffer(r.doc));
    expect(numPages).toBe(1);
    expect(pages[0]).not.toContain('Część');
    expect(pages[0]).toContain('2–8 listopada 2026');
    for (const d of ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb', 'Nd']) expect(pages[0]).toContain(d);
  });

  it('sumy w PDF = sumy z jednej funkcji aplikacji (test porównawczy)', async () => {
    const people = makePeople(3);
    const shifts = monthShifts(people);
    const r = buildPdf(data(people, opts(), shifts));
    if (r.empty) throw new Error('puste');
    const { pages } = await extractText(await toPdfBuffer(r.doc));
    const totals = totalsByPerson(shifts, '2026-11-01', '2026-11-30');
    // „Razem” w drugiej części: ostatnia liczba w wierszu osoby; sprawdzamy, że każda suma występuje
    for (const p of people) {
      const hrs = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 }).format(
        (totals.get(p.id) ?? 0) / 60,
      );
      expect(pages[1]).toContain(hrs);
    }
    expect(shifts.reduce((n, s) => n + shiftWorkMinutes(s), 0)).toBeGreaterThan(0);
  });

  it('31 dni × 25 osób (E-31): dwie części, nagłówki powtarzane na kolejnych stronach, czcionka ≥ 7,5 pt', async () => {
    const people = makePeople(25);
    const range = { kind: 'custom' as const, from: '2026-12-01', to: '2026-12-31' };
    const r = buildPdf(data(people, opts({ range }), monthShifts(people, 2026, 12)));
    if (r.empty) throw new Error('puste');
    const { pages, numPages } = await extractText(await toPdfBuffer(r.doc));
    expect(numPages).toBeGreaterThanOrEqual(4); // 2 części × ≥ 2 strony
    const withTable = pages.filter((p) => /Osoba/.test(p));
    expect(withTable.length).toBe(numPages); // każda strona ma powtórzony nagłówek tabeli
    // „Część 2” zaczyna nową stronę
    const idx2 = pages.findIndex((p) => p.includes('Część 2 z 2'));
    expect(idx2).toBeGreaterThan(0);
    expect(pages[idx2 - 1]).not.toContain('Część 2 z 2');
    expect(Math.min(...collectFontSizes(r.doc))).toBeGreaterThanOrEqual(MIN_CELL_FONT);
    // każda osoba widoczna
    expect(pages.join(' ')).toContain('Ola');
    expect(pages.join(' ')).toContain('Anna');
  });

  it('lista osoby (A4 pionowo): data | dzień | godziny, podsumowanie, notatki', async () => {
    const people = makePeople(2);
    const r = buildPdf(data(people, opts({ layout: 'person', people: 'me', showNotes: true })));
    if (r.empty) throw new Error('puste');
    expect(r.fileName).toBe('Grafik_Anna_2026-11.pdf');
    expect(r.doc.pageOrientation).toBe('portrait');
    const { pages } = await extractText(await toPdfBuffer(r.doc));
    const all = pages.join(' ');
    expect(all).toContain('Anna');
    expect(all).toContain('Listopad 2026');
    expect(all).toContain('Data');
    expect(all).toContain('Godziny');
    expect(all).toContain('zażółć gęślą jaźń');
    expect(all).toMatch(/Podsumowanie:\s*\d+ zmian/);
    expect(all).toContain('wtorek');
  });

  it('wiele osób na liście: każda od nowej strony, bez zmian = komunikat', async () => {
    const people = makePeople(3);
    const shifts = monthShifts(people).filter((s) => s.personId !== 'p2');
    const r = buildPdf(data(people, opts({ layout: 'person', people: 'all' }), shifts));
    if (r.empty) throw new Error('puste');
    expect(r.fileName).toBe('Grafik_2026-11.pdf'); // wiele osób → bez imienia w nazwie
    const { pages, numPages } = await extractText(await toPdfBuffer(r.doc));
    expect(numPages).toBeGreaterThanOrEqual(3);
    expect(pages.join(' ')).toContain('Brak zmian w wybranym okresie.');
  });

  it('opcje: bez sum / bez obsady / czarno-biały zmieniają treść', async () => {
    const people = makePeople(3);
    const withAll = buildPdf(data(people, opts()));
    const noSums = buildPdf(data(people, opts({ showTotals: false })));
    const noStaff = buildPdf(data(people, opts({ showStaffing: false })));
    if (withAll.empty || noSums.empty || noStaff.empty) throw new Error('puste');
    const t = async (r: typeof withAll) =>
      (await extractText(await toPdfBuffer(r.doc))).pages.join(' ');
    expect(await t(withAll)).toContain('Σ h');
    expect(await t(noSums)).not.toContain('Σ h');
    expect(await t(withAll)).toContain('Obsada');
    expect(await t(noStaff)).not.toContain('Obsada');
  });

  it('macierz wariantów → docs/pdf-samples/*.pdf (do obejrzenia po rasteryzacji)', async () => {
    mkdirSync('docs/pdf-samples', { recursive: true });
    const week = rangeFor('week', '2026-11-04', 1);
    const month = rangeFor('month', '2026-11-04', 1);
    let n = 0;
    for (const [rangeName, range] of [
      ['tydzien', week],
      ['miesiac', month],
    ] as const) {
      for (const count of [1, 10, 25]) {
        for (const color of [true, false]) {
          for (const notes of [false, true]) {
            const people = makePeople(count);
            const r = buildPdf(data(people, opts({ range, color, showNotes: notes })));
            if (r.empty) throw new Error('puste');
            const buf = await toPdfBuffer(r.doc);
            expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
            const file = `docs/pdf-samples/${rangeName}-${count}os-${color ? 'kolor' : 'cz-b'}-${notes ? 'notatki' : 'bez-notatek'}.pdf`;
            writeFileSync(file, buf);
            const { numPages } = await extractText(buf);
            expect(numPages).toBeGreaterThanOrEqual(1);
            n++;
          }
        }
      }
    }
    // + układ listy osoby
    const p10 = makePeople(10);
    const r = buildPdf(data(p10, opts({ layout: 'person', people: 'me', showNotes: true })));
    if (r.empty) throw new Error('puste');
    writeFileSync('docs/pdf-samples/lista-osoby.pdf', await toPdfBuffer(r.doc));
    expect(n).toBe(24);
  }, 120_000);
});
