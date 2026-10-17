// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_HOURS } from '../../src/domain/hours';
import type { Person, Shift } from '../../src/domain/types';
import { planCellChanges, isEmptyPlan } from '../../src/pc/logic/cellOps';
import {
  fillPlacements,
  matrixToTsv,
  parseClipboardText,
  placeMatrix,
} from '../../src/pc/logic/clipboard';
import {
  parseCellCode as parseRaw,
  sameSpec,
  specFromShift,
  specText,
} from '../../src/pc/logic/quickCode';
import { buildReport, csvField, gridToCsv, reportToCsv, toCsv } from '../../src/pc/logic/report';
import {
  cellsIn,
  clampSel,
  inRect,
  moveFocus,
  rectOf,
  selectAll,
  selectCol,
  selectRow,
  single,
} from '../../src/pc/logic/selection';
import { UndoStack } from '../../src/pc/logic/undoStack';
import type { CellSpec } from '../../src/pc/logic/quickCode';

const parseCellCode = (s: string) => parseRaw(s) as CellSpec | null | 'invalid';
const spec = (s: string) => parseRaw(s) as CellSpec | null;

const person = (id: string, firstName: string, order = 0, extra: Partial<Person> = {}): Person => ({
  id,
  firstName,
  color: 'blue',
  aliases: [],
  isMe: false,
  archived: false,
  order,
  createdAt: 0,
  ...extra,
});
const shift = (id: string, personId: string, date: string, extra: Partial<Shift> = {}): Shift => ({
  id,
  personId,
  date,
  kind: 'work',
  start: '10:00',
  end: '22:00',
  usesDefaultHours: true,
  source: 'manual',
  updatedAt: 0,
  ...extra,
});

describe('kody komórek (klawiatura i schowek)', () => {
  it('rozpoznaje skróty, godziny i puste pole', () => {
    expect(parseCellCode('x')).toEqual({ kind: 'work', useDefault: true });
    expect(parseCellCode(' U ')).toEqual({ kind: 'vacation' });
    expect(parseCellCode('l4')).toEqual({ kind: 'sick' });
    expect(parseCellCode('W')).toEqual({ kind: 'off' });
    expect(parseCellCode('')).toBeNull();
    expect(parseCellCode('-')).toBeNull();
    expect(parseCellCode('10-22')).toEqual({
      kind: 'work',
      useDefault: false,
      start: '10:00',
      end: '22:00',
    });
    expect(parseCellCode('14.30–23')).toMatchObject({ start: '14:30', end: '23:00' });
    expect(parseCellCode('18:00-02:00')).toMatchObject({ start: '18:00', end: '02:00' });
  });

  it('odrzuca śmieci i początek = koniec', () => {
    expect(parseCellCode('abc')).toBe('invalid');
    expect(parseCellCode('10-10')).toBe('invalid');
    expect(parseCellCode('25-30')).toBe('invalid');
    expect(parseCellCode('10-22 plus')).toBe('invalid');
  });

  it('tekst komórki i porównywanie', () => {
    expect(specText(spec('10-22'))).toBe('10:00-22:00');
    expect(specText({ kind: 'sick' })).toBe('L4');
    expect(specText(null)).toBe('');
    expect(specText({ kind: 'work', useDefault: true })).toBe('x');
    expect(sameSpec({ kind: 'off' }, { kind: 'off', note: '' })).toBe(true);
    expect(sameSpec({ kind: 'off' }, null)).toBe(false);
    expect(specFromShift(shift('a', 'p', '2026-11-02')).useDefault).toBe(true);
  });
});

describe('zaznaczanie', () => {
  it('prostokąt niezależnie od kierunku przeciągania', () => {
    const r = rectOf({ anchor: { row: 3, col: 5 }, focus: { row: 1, col: 2 } });
    expect(r).toEqual({ r0: 1, r1: 3, c0: 2, c1: 5 });
    expect(cellsIn(r)).toHaveLength(12);
    expect(inRect(r, { row: 2, col: 3 })).toBe(true);
    expect(inRect(r, { row: 0, col: 3 })).toBe(false);
  });

  it('strzałki: ruch, granice, rozciąganie Shiftem', () => {
    let s = single({ row: 0, col: 0 });
    s = moveFocus(s, -1, -1, false, 3, 7);
    expect(s.focus).toEqual({ row: 0, col: 0 });
    s = moveFocus(s, 0, 1, true, 3, 7);
    s = moveFocus(s, 1, 0, true, 3, 7);
    expect(rectOf(s)).toEqual({ r0: 0, r1: 1, c0: 0, c1: 1 });
    s = moveFocus(s, 0, 100, false, 3, 7);
    expect(s.focus.col).toBe(6);
  });

  it('wiersz, kolumna, wszystko, przycinanie po zmianie rozmiaru', () => {
    expect(rectOf(selectRow(2, 30))).toEqual({ r0: 2, r1: 2, c0: 0, c1: 29 });
    expect(rectOf(selectCol(4, 5))).toEqual({ r0: 0, r1: 4, c0: 4, c1: 4 });
    expect(rectOf(selectAll(2, 3))).toEqual({ r0: 0, r1: 1, c0: 0, c1: 2 });
    const c = clampSel({ anchor: { row: 9, col: 40 }, focus: { row: 9, col: 40 } }, 3, 28);
    expect(c.focus).toEqual({ row: 2, col: 27 });
    expect(selectAll(0, 0).focus).toEqual({ row: 0, col: 0 });
  });
});

describe('plan zmian komórek', () => {
  const n = () => {
    let i = 0;
    return () => `id${++i}`;
  };
  const date = '2026-11-06'; // piątek → 10–23 wg domyślnych
  const target = (
    spec: Parameters<typeof planCellChanges>[0][number]['spec'],
    d = date,
    p = 'p1',
  ) => ({
    personId: p,
    date: d,
    spec,
  });

  it('tworzy zmianę z godzinami domyślnymi dla dnia tygodnia', () => {
    const plan = planCellChanges(
      [target({ kind: 'work', useDefault: true })],
      [],
      DEFAULT_HOURS,
      n(),
      5,
    );
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0]).toMatchObject({
      start: '10:00',
      end: '23:00',
      usesDefaultHours: true,
      source: 'manual',
    });
  });

  it('aktualizuje istniejącą (before/after) i pomija identyczną', () => {
    const cur = shift('s1', 'p1', date, { end: '23:00' });
    const upd = planCellChanges([target({ kind: 'vacation' })], [cur], DEFAULT_HOURS, n(), 1);
    expect(upd.updates).toHaveLength(1);
    expect(upd.updates[0]!.before).toMatchObject({ kind: 'work', end: '23:00' });
    expect(upd.updates[0]!.after).toMatchObject({
      kind: 'vacation',
      start: undefined,
      usesDefaultHours: false,
    });

    const same = planCellChanges(
      [target({ kind: 'work', useDefault: true })],
      [cur],
      DEFAULT_HOURS,
      n(),
      1,
    );
    expect(isEmptyPlan(same)).toBe(true);
    expect(same.unchanged).toBe(1);
  });

  it('czyszczenie: usuwa istniejącą, pustej nie rusza; notatka zachowana, gdy nie podano', () => {
    const cur = shift('s1', 'p1', date, { note: 'zamiana', end: '23:00' });
    expect(planCellChanges([target(null)], [cur], DEFAULT_HOURS, n(), 1).deletes).toEqual(['s1']);
    expect(planCellChanges([target(null)], [], DEFAULT_HOURS, n(), 1).unchanged).toBe(1);
    const keep = planCellChanges(
      [target({ kind: 'work', useDefault: false, start: '12:00', end: '20:00' })],
      [cur],
      DEFAULT_HOURS,
      n(),
      1,
    );
    expect(keep.updates[0]!.after.note).toBe('zamiana');
    const clear = planCellChanges(
      [target({ kind: 'work', useDefault: false, start: '12:00', end: '20:00', note: '' })],
      [cur],
      DEFAULT_HOURS,
      n(),
      1,
    );
    expect(clear.updates[0]!.after.note).toBeUndefined();
  });

  it('ignoruje usunięte i duplikaty komórek w jednym planie', () => {
    const gone = shift('s1', 'p1', date, { deletedAt: 1 });
    const plan = planCellChanges(
      [target({ kind: 'off' }), target({ kind: 'vacation' })],
      [gone],
      DEFAULT_HOURS,
      n(),
      1,
    );
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0]!.kind).toBe('off');
  });
});

describe('schowek i wypełnianie', () => {
  it('TSV w obie strony', () => {
    const m = [
      [spec('10-22'), { kind: 'vacation' as const }],
      [null, spec('l4')],
    ];
    const tsv = matrixToTsv(m);
    expect(tsv).toBe('10:00-22:00\tU\n\tL4');
    const back = parseClipboardText(tsv);
    expect(back.invalid).toBe(0);
    expect(back.matrix[0]![1]).toEqual({ kind: 'vacation' });
    expect(back.matrix[1]![0]).toBeNull();
  });

  it('liczy nierozpoznane komórki, obsługuje CRLF i cudzysłowy z Excela', () => {
    const r = parseClipboardText('"x"\r\nfoo\r\n');
    expect(r.matrix).toHaveLength(2);
    expect(r.invalid).toBe(1);
  });

  it('pojedyncza wartość wypełnia zaznaczenie; macierz od rogu i przycięta do siatki', () => {
    const sel = { r0: 1, r1: 2, c0: 1, c1: 3 };
    expect(placeMatrix([[{ kind: 'off' }]], sel, 5, 5)).toHaveLength(6);
    const m = [
      [{ kind: 'off' as const }, { kind: 'vacation' as const }],
      [{ kind: 'sick' as const }, null],
    ];
    const placed = placeMatrix(m, { r0: 3, r1: 3, c0: 3, c1: 3 }, 4, 5);
    expect(placed.map((p) => [p.row, p.col])).toEqual([
      [3, 3],
      [3, 4],
    ]);
    expect(placeMatrix([], sel, 5, 5)).toEqual([]);
  });

  it('wypełnianie w dół i w prawo z pierwszego wiersza/kolumny', () => {
    const rect = { r0: 0, r1: 2, c0: 0, c1: 1 };
    const specAt = ({ row, col }: { row: number; col: number }) =>
      col === 0 ? { kind: 'off' as const } : row === 0 ? { kind: 'sick' as const } : null;
    const down = fillPlacements(rect, 'down', specAt);
    expect(down).toHaveLength(4);
    expect(down.filter((p) => p.col === 1).every((p) => p.spec?.kind === 'sick')).toBe(true);
    expect(fillPlacements({ ...rect, r1: 0 }, 'down', specAt)).toEqual([]);
    const right = fillPlacements(rect, 'right', specAt);
    expect(right.map((p) => [p.row, p.col, p.spec?.kind])).toEqual([
      [0, 1, 'off'],
      [1, 1, 'off'],
      [2, 1, 'off'],
    ]);
  });
});

describe('raport godzin', () => {
  const people = [
    person('a', 'Ania', 0),
    person('b', 'Basia', 1),
    person('c', 'Cezary', 2, { archived: true }),
  ];
  const shifts = [
    shift('1', 'a', '2026-11-05'),
    shift('2', 'a', '2026-11-06', { end: '23:00' }), // piątek
    shift('3', 'a', '2026-11-07', { end: '23:00' }), // sobota
    shift('4', 'b', '2026-11-05', { kind: 'vacation', start: undefined, end: undefined }),
    shift('5', 'b', '2026-11-06', { kind: 'sick', start: undefined, end: undefined }),
    shift('6', 'a', '2026-12-01'), // poza zakresem
    shift('7', 'a', '2026-11-08', { deletedAt: 1 }),
  ];

  it('sumuje dni i godziny tą samą funkcją co reszta aplikacji; pomija usunięte i spoza zakresu', () => {
    const rep = buildReport(people, shifts, '2026-11-01', '2026-11-30');
    const a = rep.rows.find((r) => r.personId === 'a')!;
    expect(a).toMatchObject({ workDays: 3, minutes: (12 + 13 + 13) * 60, fridaySaturdayDays: 2 });
    const b = rep.rows.find((r) => r.personId === 'b')!;
    expect(b).toMatchObject({ vacation: 1, sick: 1, workDays: 0 });
    expect(rep.rows.map((r) => r.personId)).toEqual(['a', 'b']); // zarchiwizowany bez zmian ukryty
    expect(rep.totals.minutes).toBe(38 * 60);
    expect(rep.staffing).toHaveLength(30);
    expect(rep.staffing.find((d) => d.date === '2026-11-05')!.count).toBe(1);
    expect(rep.maxStaffing).toBe(1);
  });

  it('opcjonalnie pokazuje osoby bez zmian', () => {
    expect(
      buildReport(people, [], '2026-11-01', '2026-11-30', { includeEmpty: true }).rows,
    ).toHaveLength(3);
  });

  it('CSV: separator średnik, polski przecinek, ochrona przed formułami', () => {
    const rep = buildReport(people, shifts, '2026-11-01', '2026-11-30');
    const csv = reportToCsv(rep);
    expect(csv.split('\r\n')[0]).toBe('Osoba;Dni pracy;Godziny;Pt/Sb;Wolne;Urlop;L4;Inne');
    expect(csv).toContain('Ania;3;38;2;0;0;0;0');
    expect(csv.endsWith('Razem;3;38;2;0;1;1;0')).toBe(true);
    expect(csvField('=1+1')).toBe("'=1+1");
    expect(csvField('a;b')).toBe('"a;b"');
    expect(csvField('mówi "cześć"')).toBe('"mówi ""cześć"""');
    expect(csvField(-5)).toBe('-5');
    expect(toCsv([['a', 1.5]])).toBe('a;1.5');
  });

  it('CSV siatki: nagłówek z dniami tygodnia i godzinami', () => {
    const days = ['2026-11-05', '2026-11-06', '2026-11-07'];
    const csv = gridToCsv([people[0]!, people[1]!], days, shifts);
    const [head, a, b] = csv.split('\r\n');
    expect(head).toBe('Osoba;05.11 cz;06.11 pt;07.11 sb;Godziny');
    expect(a).toBe('Ania;10:00-22:00;10:00-23:00;10:00-23:00;38');
    expect(b).toBe('Basia;U;L4;;0');
  });
});

describe('stos cofnij/ponów', () => {
  const makeOp = (log: string[], name: string) => ({
    label: name,
    undo: async () => void log.push(`undo ${name}`),
    redo: async () => void log.push(`redo ${name}`),
  });

  it('cofa i ponawia w kolejności, nowa operacja kasuje „ponów”', async () => {
    const log: string[] = [];
    const s = new UndoStack();
    s.push(makeOp(log, 'A'));
    s.push(makeOp(log, 'B'));
    expect(s.undoLabel).toBe('B');
    expect(await s.undo()).toBe('B');
    expect(s.canRedo).toBe(true);
    expect(await s.redo()).toBe('B');
    await s.undo();
    s.push(makeOp(log, 'C'));
    expect(s.canRedo).toBe(false);
    expect(log).toEqual(['undo B', 'redo B', 'undo B']);
    expect(await s.undo()).toBe('C');
    expect(await s.undo()).toBe('A');
    expect(await s.undo()).toBeNull();
  });

  it('błąd cofania zostawia stos bez zmian; limit głębokości', async () => {
    const s = new UndoStack(2);
    s.push({
      label: 'x',
      undo: async () => Promise.reject(new Error('boom')),
      redo: async () => {},
    });
    await expect(s.undo()).rejects.toThrow('boom');
    expect(s.canUndo).toBe(true);
    s.push(makeOp([], 'y'));
    s.push(makeOp([], 'z'));
    await s.undo();
    await s.undo();
    expect(s.canUndo).toBe(false);
  });

  it('powiadamia subskrybentów', async () => {
    const s = new UndoStack();
    let n = 0;
    const off = s.subscribe(() => n++);
    s.push(makeOp([], 'A'));
    await s.undo();
    off();
    s.push(makeOp([], 'B'));
    expect(n).toBe(2);
  });
});
