/** Zaznaczanie komórek siatki (wiersze = osoby, kolumny = dni) — czysta logika. */

export interface Cell {
  row: number;
  col: number;
}
export interface Sel {
  anchor: Cell;
  focus: Cell;
}
export interface Rect {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

export const single = (c: Cell): Sel => ({ anchor: c, focus: c });

export function rectOf(s: Sel): Rect {
  return {
    r0: Math.min(s.anchor.row, s.focus.row),
    r1: Math.max(s.anchor.row, s.focus.row),
    c0: Math.min(s.anchor.col, s.focus.col),
    c1: Math.max(s.anchor.col, s.focus.col),
  };
}

export const rectSize = (r: Rect) => ({ rows: r.r1 - r.r0 + 1, cols: r.c1 - r.c0 + 1 });

export function inRect(r: Rect, c: Cell): boolean {
  return c.row >= r.r0 && c.row <= r.r1 && c.col >= r.c0 && c.col <= r.c1;
}

export function cellsIn(r: Rect): Cell[] {
  const out: Cell[] = [];
  for (let row = r.r0; row <= r.r1; row++)
    for (let col = r.c0; col <= r.c1; col++) out.push({ row, col });
  return out;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Przesunięcie kursora strzałką; `extend` (Shift) rozciąga zaznaczenie od kotwicy. */
export function moveFocus(
  s: Sel,
  dRow: number,
  dCol: number,
  extend: boolean,
  rows: number,
  cols: number,
): Sel {
  const focus = {
    row: clamp(s.focus.row + dRow, 0, Math.max(0, rows - 1)),
    col: clamp(s.focus.col + dCol, 0, Math.max(0, cols - 1)),
  };
  return extend ? { anchor: s.anchor, focus } : single(focus);
}

export function selectAll(rows: number, cols: number): Sel {
  return {
    anchor: { row: 0, col: 0 },
    focus: { row: Math.max(0, rows - 1), col: Math.max(0, cols - 1) },
  };
}

/** Cały wiersz (klik w nazwę osoby) lub cała kolumna (klik w dzień). */
export const selectRow = (row: number, cols: number): Sel => ({
  anchor: { row, col: 0 },
  focus: { row, col: Math.max(0, cols - 1) },
});
export const selectCol = (col: number, rows: number): Sel => ({
  anchor: { row: 0, col },
  focus: { row: Math.max(0, rows - 1), col },
});

/** Po zmianie liczby wierszy/kolumn (filtr, zmiana miesiąca) utrzymaj zaznaczenie w granicach. */
export function clampSel(s: Sel, rows: number, cols: number): Sel {
  const fix = (c: Cell): Cell => ({
    row: clamp(c.row, 0, Math.max(0, rows - 1)),
    col: clamp(c.col, 0, Math.max(0, cols - 1)),
  });
  return { anchor: fix(s.anchor), focus: fix(s.focus) };
}
