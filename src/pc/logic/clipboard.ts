import { parseCellCode, specText, type CellSpec } from './quickCode';
import { rectSize, type Cell, type Rect } from './selection';

export type Matrix = (CellSpec | null)[][];

/** Macierz komórek → TSV (wklejalny do Excela/Arkuszy Google). */
export function matrixToTsv(m: Matrix): string {
  return m.map((row) => row.map(specText).join('\t')).join('\n');
}

export interface ParsedClipboard {
  matrix: Matrix;
  /** ile komórek tekstu nie dało się rozpoznać */
  invalid: number;
}

/** Tekst ze schowka (TSV, także pojedyncza wartość) → macierz opisów komórek. */
export function parseClipboardText(text: string): ParsedClipboard {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  let invalid = 0;
  const matrix: Matrix = lines.map((line) =>
    line.split('\t').map((cell) => {
      const spec = parseCellCode(cell.replace(/^"|"$/g, ''));
      if (spec === 'invalid') {
        invalid++;
        return null;
      }
      return spec;
    }),
  );
  return { matrix, invalid };
}

export interface Placed {
  row: number;
  col: number;
  spec: CellSpec | null;
}

/**
 * Gdzie wkleić macierz: pojedyncza wartość wypełnia całe zaznaczenie;
 * większa macierz trafia od lewego górnego rogu zaznaczenia i jest przycinana do siatki.
 */
export function placeMatrix(m: Matrix, sel: Rect, rows: number, cols: number): Placed[] {
  const h = m.length;
  const w = Math.max(0, ...m.map((r) => r.length));
  if (h === 0 || w === 0) return [];
  const out: Placed[] = [];
  if (h === 1 && w === 1) {
    for (let row = sel.r0; row <= sel.r1; row++)
      for (let col = sel.c0; col <= sel.c1; col++) out.push({ row, col, spec: m[0]![0] ?? null });
    return out;
  }
  for (let i = 0; i < h; i++) {
    for (let j = 0; j < w; j++) {
      const row = sel.r0 + i;
      const col = sel.c0 + j;
      if (row >= rows || col >= cols) continue;
      out.push({ row, col, spec: m[i]![j] ?? null });
    }
  }
  return out;
}

/** Wypełnienie w dół (Ctrl+D) lub w prawo (Ctrl+R) wartością z pierwszego wiersza/kolumny zaznaczenia. */
export function fillPlacements(
  rect: Rect,
  direction: 'down' | 'right',
  specAt: (cell: Cell) => CellSpec | null,
): Placed[] {
  const { rows, cols } = rectSize(rect);
  const out: Placed[] = [];
  if (direction === 'down') {
    if (rows < 2) return out;
    for (let col = rect.c0; col <= rect.c1; col++) {
      const spec = specAt({ row: rect.r0, col });
      for (let row = rect.r0 + 1; row <= rect.r1; row++) out.push({ row, col, spec });
    }
  } else {
    if (cols < 2) return out;
    for (let row = rect.r0; row <= rect.r1; row++) {
      const spec = specAt({ row, col: rect.c0 });
      for (let col = rect.c0 + 1; col <= rect.c1; col++) out.push({ row, col, spec });
    }
  }
  return out;
}
