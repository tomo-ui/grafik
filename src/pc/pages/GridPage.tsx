import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as RKeyboardEvent,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  PanelRight,
  Printer,
  Redo2,
  Undo2,
} from 'lucide-react';
import { Link } from 'wouter';
import { normalizeName } from '../../ai/names';
import { usePersons } from '../../app/data';
import { repos } from '../../db/repos';
import { todayISO, weekdayOf } from '../../domain/dates';
import { formatDayLong, formatHours } from '../../domain/i18n';
import { endsNextDay, KIND_LABELS, shiftLabel } from '../../domain/labels';
import { colorVar, displayNames, fullName } from '../../domain/people';
import { shiftWorkMinutes, staffingByDay, totalsByPerson } from '../../domain/totals';
import type { Person, Settings, Shift, ShiftKind } from '../../domain/types';
import { periodOf, shiftPeriod } from '../../domain/views';
import {
  fillPlacements,
  matrixToTsv,
  parseClipboardText,
  placeMatrix,
  type Matrix,
  type Placed,
} from '../logic/clipboard';
import { parseCellCode, specFromShift, specText, type CellSpec } from '../logic/quickCode';
import { gridToCsv } from '../logic/report';
import {
  cellsIn,
  clampSel,
  inRect,
  moveFocus,
  rectOf,
  rectSize,
  selectAll,
  selectCol,
  selectRow,
  single,
  type Cell,
  type Sel,
} from '../logic/selection';
import { useOps } from '../ops';
import { usePc } from '../store';
import { ContextMenu, downloadBlob, Empty, Seg, useToast, type MenuItem } from '../ui';

const short = (t: string) => (t.endsWith(':00') ? String(Number(t.slice(0, 2))) : t);
const cellText = (s: Shift): string => {
  if (s.kind === 'work' && s.start && s.end) {
    return `${short(s.start)}–${short(s.end)}${endsNextDay(s) ? '+1' : ''}`;
  }
  return { work: 'x', off: 'W', vacation: 'U', sick: 'L4', other: 'I' }[s.kind];
};
const monthName = (m: number) =>
  new Intl.DateTimeFormat('pl-PL', { month: 'long' }).format(new Date(2026, m - 1, 1));

export function GridPage({ settings }: { settings: Settings }) {
  const personsQuery = usePersons(true);
  const persons = useMemo(() => personsQuery ?? [], [personsQuery]);
  const ops = useOps();
  const toast = useToast();
  const {
    mode,
    anchor,
    inspector,
    hideEmpty,
    showArchived,
    setMode,
    setAnchor,
    setInspector,
    setHideEmpty,
    setShowArchived,
  } = usePc();
  const today = todayISO();
  const anc = anchor ?? today;
  const period = useMemo(
    () => periodOf(anc, mode, settings.weekStartsOn),
    [anc, mode, settings.weekStartsOn],
  );

  const shifts = useLiveQuery(
    () => repos.shifts.range(period.from, period.to),
    [period.from, period.to],
  );
  const list = useMemo(() => shifts ?? [], [shifts]);
  const bySlot = useMemo(() => new Map(list.map((s) => [`${s.personId}|${s.date}`, s])), [list]);

  const [filter, setFilter] = useState('');
  const rows = useMemo<Person[]>(() => {
    const needle = normalizeName(filter);
    const withShifts = new Set(list.map((s) => s.personId));
    return persons.filter((p) => {
      if (p.archived && !showArchived && !withShifts.has(p.id)) return false;
      if (hideEmpty && !withShifts.has(p.id)) return false;
      return !needle || normalizeName(fullName(p)).includes(needle);
    });
  }, [persons, list, filter, hideEmpty, showArchived]);
  const names = useMemo(() => displayNames(rows), [rows]);
  const days = period.days;
  const nRows = rows.length;
  const nCols = days.length;

  const totals = useMemo(() => totalsByPerson(list, period.from, period.to), [list, period]);
  const staffing = useMemo(() => staffingByDay(list, period.from, period.to), [list, period]);
  const grand = useMemo(() => [...totals.values()].reduce((a, b) => a + b, 0), [totals]);

  /* ------------------------------------------------------------ zaznaczenie */
  const [selState, setSelState] = useState<Sel | null>(null);
  // zaznaczenie zawsze mieści się w siatce (po filtrze lub zmianie miesiąca)
  const sel = useMemo(
    () => (selState && nRows && nCols ? clampSel(selState, nRows, nCols) : null),
    [selState, nRows, nCols],
  );
  const setSel = useCallback(
    (s: Sel | null) => setSelState(s && nRows && nCols ? clampSel(s, nRows, nCols) : null),
    [nRows, nCols],
  );
  const rect = sel ? rectOf(sel) : null;
  const dragging = useRef(false);
  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const shiftAt = useCallback(
    (c: Cell): Shift | undefined => {
      const p = rows[c.row];
      const d = days[c.col];
      return p && d ? bySlot.get(`${p.id}|${d}`) : undefined;
    },
    [rows, days, bySlot],
  );

  /* ----------------------------------------------------------------- zapis */
  const busy = useRef(false);
  const run = useCallback(
    async (placed: Placed[], label: string) => {
      if (busy.current || placed.length === 0) return;
      busy.current = true;
      try {
        const targets = placed.flatMap((p) => {
          const person = rows[p.row];
          const date = days[p.col];
          return person && date ? [{ personId: person.id, date, spec: p.spec }] : [];
        });
        const n = await ops.applyCells(targets, settings.defaultHours, label);
        if (n === 0) toast('Bez zmian.');
        else toast(`${label}: ${n}`, { label: 'Cofnij', run: () => void ops.undo() });
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Nie udało się zapisać zmian.');
      } finally {
        busy.current = false;
      }
    },
    [ops, rows, days, settings.defaultHours, toast],
  );

  const applySpecToSelection = useCallback(
    (spec: CellSpec | null, label: string) => {
      if (!rect) return Promise.resolve();
      return run(
        cellsIn(rect).map((c) => ({ ...c, spec })),
        label,
      );
    },
    [rect, run],
  );

  /* ------------------------------------------------------------ edycja w komórce */
  const [edit, setEdit] = useState<{ text: string; invalid: boolean } | null>(null);
  const startEdit = (text: string) => {
    if (sel) setEdit({ text, invalid: false });
  };
  const commitEdit = useCallback(
    async (move: 'down' | 'right' | null) => {
      if (!edit || !sel) return;
      const spec = parseCellCode(edit.text);
      if (spec === 'invalid') {
        setEdit({ ...edit, invalid: true });
        toast('Nierozpoznany zapis. Wpisz godziny (10-22) albo x, w, u, l4, i; pusty = usuń.');
        return;
      }
      setEdit(null);
      const r = rectOf(sel);
      const wasSingle = r.r0 === r.r1 && r.c0 === r.c1;
      await applySpecToSelection(spec, spec ? 'Ustawiono komórki' : 'Wyczyszczono komórki');
      if (wasSingle && move)
        setSel(
          moveFocus(sel, move === 'down' ? 1 : 0, move === 'right' ? 1 : 0, false, nRows, nCols),
        );
      containerRef.current?.focus();
    },
    [edit, sel, applySpecToSelection, setSel, nRows, nCols, toast],
  );

  /* ------------------------------------------------------------------ schowek */
  const clip = useRef<{ text: string; matrix: Matrix } | null>(null);
  const copySel = useCallback(
    (cut: boolean) => {
      if (!rect) return;
      const matrix: Matrix = [];
      for (let r = rect.r0; r <= rect.r1; r++) {
        const row: (CellSpec | null)[] = [];
        for (let c = rect.c0; c <= rect.c1; c++) {
          const s = shiftAt({ row: r, col: c });
          row.push(s ? specFromShift(s) : null);
        }
        matrix.push(row);
      }
      const text = matrixToTsv(matrix);
      clip.current = { text, matrix };
      void navigator.clipboard?.writeText(text).catch(() => {});
      toast(cut ? 'Wycięto zaznaczenie.' : 'Skopiowano zaznaczenie.');
      if (cut) void applySpecToSelection(null, 'Wycięto komórki');
    },
    [rect, shiftAt, toast, applySpecToSelection],
  );

  const pasteText = useCallback(
    (text: string) => {
      if (!rect) return;
      let matrix: Matrix;
      if (clip.current && clip.current.text === text.trim()) matrix = clip.current.matrix;
      else {
        const parsed = parseClipboardText(text);
        if (parsed.invalid > 0) {
          toast(`Nie wklejono: ${parsed.invalid} komórek ma nierozpoznany zapis.`);
          return;
        }
        matrix = parsed.matrix;
      }
      void run(placeMatrix(matrix, rect, nRows, nCols), 'Wklejono');
    },
    [rect, nRows, nCols, run, toast],
  );

  const fill = useCallback(
    (direction: 'down' | 'right') => {
      if (!rect) return;
      const placed = fillPlacements(rect, direction, (c) => {
        const s = shiftAt(c);
        return s ? specFromShift(s) : null;
      });
      void run(placed, direction === 'down' ? 'Wypełniono w dół' : 'Wypełniono w prawo');
    },
    [rect, shiftAt, run],
  );

  /* ---------------------------------------------------------------- klawiatura */
  const containerRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: RKeyboardEvent<HTMLDivElement>) => {
    if (edit) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    if (key === 'PageUp' || key === 'PageDown') {
      e.preventDefault();
      setAnchor(shiftPeriod(anc, mode, key === 'PageUp' ? -1 : 1));
      return;
    }
    if (!sel) {
      if (nRows && nCols && (key.startsWith('Arrow') || key === 'Enter')) {
        e.preventDefault();
        setSel(single({ row: 0, col: 0 }));
      }
      return;
    }
    const jump = mod ? 1000 : 1;
    if (key === 'ArrowDown') {
      e.preventDefault();
      setSel(moveFocus(sel, jump, 0, e.shiftKey, nRows, nCols));
    } else if (key === 'ArrowUp') {
      e.preventDefault();
      setSel(moveFocus(sel, -jump, 0, e.shiftKey, nRows, nCols));
    } else if (key === 'ArrowRight') {
      e.preventDefault();
      setSel(moveFocus(sel, 0, jump, e.shiftKey, nRows, nCols));
    } else if (key === 'ArrowLeft') {
      e.preventDefault();
      setSel(moveFocus(sel, 0, -jump, e.shiftKey, nRows, nCols));
    } else if (key === 'Home') {
      e.preventDefault();
      setSel(moveFocus(sel, 0, -1000, e.shiftKey, nRows, nCols));
    } else if (key === 'End') {
      e.preventDefault();
      setSel(moveFocus(sel, 0, 1000, e.shiftKey, nRows, nCols));
    } else if (key === 'Tab') {
      e.preventDefault();
      setSel(moveFocus(sel, 0, e.shiftKey ? -1 : 1, false, nRows, nCols));
    } else if (key === 'Enter' || key === 'F2') {
      e.preventDefault();
      const s = shiftAt(sel.focus);
      startEdit(s ? specText(specFromShift(s)) : '');
    } else if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault();
      void applySpecToSelection(null, 'Wyczyszczono komórki');
    } else if (key === 'Escape') {
      setSel(single(sel.focus));
    } else if (mod && key.toLowerCase() === 'a') {
      e.preventDefault();
      setSel(selectAll(nRows, nCols));
    } else if (mod && key.toLowerCase() === 'c') {
      e.preventDefault();
      copySel(false);
    } else if (mod && key.toLowerCase() === 'x') {
      e.preventDefault();
      copySel(true);
    } else if (mod && key.toLowerCase() === 'd') {
      e.preventDefault();
      fill('down');
    } else if (mod && key.toLowerCase() === 'r') {
      e.preventDefault();
      fill('right');
    } else if (!mod && !e.altKey && key.length === 1) {
      e.preventDefault();
      startEdit(key);
    }
  };

  /* ----------------------------------------------------------- menu kontekstowe */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuItems: MenuItem[] = [
    {
      label: 'Praca (godziny domyślne)',
      shortcut: 'x',
      onSelect: () =>
        void applySpecToSelection({ kind: 'work', useDefault: true }, 'Ustawiono pracę'),
    },
    {
      label: 'Wolne',
      shortcut: 'w',
      onSelect: () => void applySpecToSelection({ kind: 'off' }, 'Ustawiono wolne'),
    },
    {
      label: 'Urlop',
      shortcut: 'u',
      onSelect: () => void applySpecToSelection({ kind: 'vacation' }, 'Ustawiono urlop'),
    },
    {
      label: 'L4',
      shortcut: 'l4',
      onSelect: () => void applySpecToSelection({ kind: 'sick' }, 'Ustawiono L4'),
    },
    {
      label: 'Inne',
      shortcut: 'i',
      onSelect: () => void applySpecToSelection({ kind: 'other' }, 'Ustawiono „inne”'),
    },
    { label: 'Kopiuj', shortcut: 'Ctrl+C', separatorBefore: true, onSelect: () => copySel(false) },
    {
      label: 'Wklej',
      shortcut: 'Ctrl+V',
      onSelect: () => {
        void navigator.clipboard
          ?.readText()
          .then(pasteText)
          .catch(() => toast('Przeglądarka nie pozwoliła odczytać schowka — użyj Ctrl+V.'));
      },
    },
    { label: 'Wypełnij w dół', shortcut: 'Ctrl+D', onSelect: () => fill('down') },
    { label: 'Wypełnij w prawo', shortcut: 'Ctrl+R', onSelect: () => fill('right') },
    {
      label: 'Wyczyść',
      shortcut: 'Del',
      danger: true,
      separatorBefore: true,
      onSelect: () => void applySpecToSelection(null, 'Wyczyszczono komórki'),
    },
  ];

  /* ------------------------------------------------------------------- widok */
  const years = useMemo(() => {
    const y = Number(anc.slice(0, 4));
    return Array.from({ length: 11 }, (_, i) => y - 5 + i);
  }, [anc]);
  const exportCsv = () => {
    const csv = gridToCsv(rows, days, list);
    downloadBlob(
      new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }),
      `Grafik_${period.from}_${period.to}.csv`,
    );
  };
  const selSummary = useMemo(() => {
    if (!rect) return null;
    const cells = cellsIn(rect);
    const found = cells.map(shiftAt).filter((s): s is Shift => !!s);
    return {
      cells: cells.length,
      shifts: found.length,
      minutes: found.reduce((m, s) => m + shiftWorkMinutes(s), 0),
      ...rectSize(rect),
    };
  }, [rect, shiftAt]);

  if (shifts && persons.length === 0) {
    return (
      <div className="pc-page">
        <Empty title="Nie ma jeszcze żadnej osoby">
          <p>Dodaj osoby, a potem układaj grafik w siatce.</p>
          <Link href="/osoby" className="btn primary">
            Przejdź do osób
          </Link>
        </Empty>
      </div>
    );
  }

  return (
    <>
      <div className="toolbar" role="toolbar" aria-label="Narzędzia grafiku">
        <h1 aria-live="polite" style={{ textTransform: 'capitalize', minWidth: 170 }}>
          {period.label}
        </h1>
        <div className="row" style={{ gap: 4 }}>
          <button
            type="button"
            className="btn icon"
            aria-label="Poprzedni okres"
            onClick={() => setAnchor(shiftPeriod(anc, mode, -1))}
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
          <button type="button" className="btn" onClick={() => setAnchor(null)}>
            Dziś
          </button>
          <button
            type="button"
            className="btn icon"
            aria-label="Następny okres"
            onClick={() => setAnchor(shiftPeriod(anc, mode, 1))}
          >
            <ChevronRight size={16} aria-hidden />
          </button>
        </div>
        <Seg
          label="Zakres"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'month', label: 'Miesiąc' },
            { value: 'week', label: 'Tydzień' },
          ]}
        />
        <select
          className="select"
          aria-label="Miesiąc"
          value={Number(anc.slice(5, 7))}
          onChange={(e) =>
            setAnchor(`${anc.slice(0, 4)}-${String(e.target.value).padStart(2, '0')}-01`)
          }
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {monthName(m)}
            </option>
          ))}
        </select>
        <select
          className="select"
          aria-label="Rok"
          value={Number(anc.slice(0, 4))}
          onChange={(e) => setAnchor(`${e.target.value}-${anc.slice(5, 7)}-01`)}
        >
          {years.map((y) => (
            <option key={y}>{y}</option>
          ))}
        </select>
        <span className="sep" />
        <input
          className="input"
          type="search"
          placeholder="Szukaj osoby…"
          aria-label="Szukaj osoby"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="row">
          <input
            type="checkbox"
            checked={hideEmpty}
            onChange={(e) => setHideEmpty(e.target.checked)}
          />
          Ukryj bez zmian
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Zarchiwizowane
        </label>
        <span className="grow" />
        <button
          type="button"
          className="btn icon"
          aria-label="Cofnij"
          title="Cofnij (Ctrl+Z)"
          disabled={!ops.canUndo}
          onClick={() => void ops.undo()}
        >
          <Undo2 size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="btn icon"
          aria-label="Ponów"
          title="Ponów (Ctrl+Shift+Z)"
          disabled={!ops.canRedo}
          onClick={() => void ops.redo()}
        >
          <Redo2 size={16} aria-hidden />
        </button>
        <button type="button" className="btn" onClick={exportCsv} disabled={!nRows}>
          <Download size={15} aria-hidden /> CSV
        </button>
        <button
          type="button"
          className="btn icon"
          aria-label="Drukuj"
          onClick={() => window.print()}
        >
          <Printer size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="btn icon"
          aria-label="Panel zaznaczenia"
          aria-pressed={inspector}
          onClick={() => setInspector(!inspector)}
        >
          <PanelRight size={16} aria-hidden />
        </button>
      </div>

      <div
        className={`grid-layout${inspector ? '' : ' no-inspector'}`}
        style={{ flex: 1, minHeight: 0 }}
      >
        <div
          ref={containerRef}
          className="grid-scroll"
          tabIndex={0}
          role="application"
          aria-label="Siatka grafiku. Strzałki poruszają, wpisz godziny albo x, w, u, l4, i; Delete czyści."
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            if (edit) return;
            e.preventDefault();
            pasteText(e.clipboardData.getData('text/plain'));
          }}
        >
          {nRows === 0 ? (
            <Empty title="Brak osób do wyświetlenia">
              <p>Zmień filtr albo włącz „Zarchiwizowane”.</p>
            </Empty>
          ) : (
            <table
              className="sgrid"
              role="grid"
              aria-label={`Grafik: ${period.label}`}
              aria-rowcount={nRows}
              aria-colcount={nCols}
              style={{ ['--cw' as string]: mode === 'month' ? '42px' : '104px' }}
            >
              <thead>
                <tr role="row">
                  <th className="person" scope="col" role="columnheader">
                    Osoba
                  </th>
                  {days.map((d, c) => {
                    const wd = weekdayOf(d);
                    return (
                      <th
                        key={d}
                        scope="col"
                        role="columnheader"
                        className={`${wd === 0 || wd === 6 ? 'weekend' : ''}${d === today ? ' today' : ''}`}
                        title={formatDayLong(d)}
                        onClick={() => {
                          setSel(selectCol(c, nRows));
                          containerRef.current?.focus();
                        }}
                      >
                        {Number(d.slice(8))}
                        <small>{['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'][wd]}</small>
                      </th>
                    );
                  })}
                  <th className="sum" scope="col" role="columnheader">
                    Σ godz.
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p, r) => (
                  <tr key={p.id} role="row" style={{ ['--pc' as string]: colorVar(p.color) }}>
                    <th
                      className="person"
                      scope="row"
                      role="rowheader"
                      title={fullName(p)}
                      onClick={() => {
                        setSel(selectRow(r, nCols));
                        containerRef.current?.focus();
                      }}
                    >
                      <span
                        className="dot"
                        style={{ background: colorVar(p.color), marginRight: 8 }}
                        aria-hidden
                      />
                      {names.get(p.id)}
                      {p.archived && <span className="muted"> (arch.)</span>}
                    </th>
                    {days.map((d, c) => {
                      const s = bySlot.get(`${p.id}|${d}`);
                      const wd = weekdayOf(d);
                      const isSel = !!rect && inRect(rect, { row: r, col: c });
                      const isFocus = !!sel && sel.focus.row === r && sel.focus.col === c;
                      return (
                        <td
                          key={d}
                          role="gridcell"
                          aria-selected={isSel}
                          aria-label={`${names.get(p.id)}, ${formatDayLong(d)}: ${s ? shiftLabel(s) : 'brak zmiany'}`}
                          title={s?.note}
                          className={`cell${s ? ` k-${s.kind}` : ''}${s?.note ? ' has-note' : ''}${wd === 0 || wd === 6 ? ' weekend' : ''}${isSel ? ' sel' : ''}${isFocus ? ' focus' : ''}`}
                          onMouseDown={(e) => {
                            if (e.button !== 0 || edit) return;
                            dragging.current = true;
                            setSel(
                              e.shiftKey && sel
                                ? { anchor: sel.anchor, focus: { row: r, col: c } }
                                : single({ row: r, col: c }),
                            );
                            containerRef.current?.focus();
                          }}
                          onMouseEnter={() => {
                            if (dragging.current && sel)
                              setSel({ anchor: sel.anchor, focus: { row: r, col: c } });
                          }}
                          onDoubleClick={() => {
                            setSel(single({ row: r, col: c }));
                            setEdit({ text: s ? specText(specFromShift(s)) : '', invalid: false });
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            if (!rect || !inRect(rect, { row: r, col: c }))
                              setSel(single({ row: r, col: c }));
                            setMenu({ x: e.clientX, y: e.clientY });
                          }}
                        >
                          {s && <div className="c">{cellText(s)}</div>}
                          {isFocus && edit && (
                            <input
                              className={`cell-edit${edit.invalid ? ' invalid' : ''}`}
                              autoFocus
                              aria-label="Zawartość komórki"
                              value={edit.text}
                              onFocus={(e) =>
                                e.currentTarget.setSelectionRange(
                                  e.currentTarget.value.length,
                                  e.currentTarget.value.length,
                                )
                              }
                              onChange={(e) => setEdit({ text: e.target.value, invalid: false })}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  void commitEdit('down');
                                } else if (e.key === 'Tab') {
                                  e.preventDefault();
                                  void commitEdit('right');
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  setEdit(null);
                                  containerRef.current?.focus();
                                }
                              }}
                              onBlur={() => setEdit((cur) => (cur ? null : cur))}
                            />
                          )}
                        </td>
                      );
                    })}
                    <td className="sum" role="gridcell">
                      {totals.get(p.id) ? formatHours(totals.get(p.id)!) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr role="row">
                  <th className="person" scope="row" role="rowheader">
                    Obsada (osób w pracy)
                  </th>
                  {days.map((d) => (
                    <td key={d} role="gridcell">
                      {staffing.get(d) ?? 0}
                    </td>
                  ))}
                  <td className="sum" role="gridcell">
                    {formatHours(grand)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {inspector && (
          <Inspector
            key={sel ? `${sel.focus.row}:${sel.focus.col}` : 'none'}
            summary={selSummary}
            focusShift={sel ? shiftAt(sel.focus) : undefined}
            focusLabel={
              sel
                ? `${names.get(rows[sel.focus.row]?.id ?? '') ?? ''}, ${days[sel.focus.col] ? formatDayLong(days[sel.focus.col]!) : ''}`
                : ''
            }
            onApply={(spec) =>
              void applySpecToSelection(spec, spec ? 'Ustawiono komórki' : 'Wyczyszczono komórki')
            }
          />
        )}
      </div>

      <div
        className="toolbar legend"
        style={{ borderTop: '1px solid var(--line)', borderBottom: 0 }}
      >
        <span>
          <i style={{ background: 'color-mix(in srgb, var(--accent) 25%, var(--panel))' }} />
          Praca
        </span>
        <span>
          <i style={{ background: 'var(--panel-2)', border: '1px solid var(--line)' }} />W — wolne
        </span>
        <span>
          <i style={{ background: 'var(--warn-soft)' }} />U — urlop
        </span>
        <span>
          <i style={{ background: 'var(--danger-soft)' }} />
          L4
        </span>
        <span>
          <i style={{ background: 'var(--accent-soft)' }} />I — inne
        </span>
        <span className="grow" />
        <span>
          Wpisz <b>10-22</b>, <b>x</b> (domyślne), <b>w</b>, <b>u</b>, <b>l4</b>, <b>i</b> ·{' '}
          <span className="kbd">Enter</span> edytuj · <span className="kbd">Del</span> wyczyść ·{' '}
          <span className="kbd">Ctrl+C/V</span> · <span className="kbd">Ctrl+D/R</span> wypełnij ·{' '}
          <span className="kbd">PgUp/PgDn</span> okres
        </span>
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </>
  );
}

/* ------------------------------------------------------------------------ Panel */

type InspectorKind = 'work-default' | 'work-custom' | ShiftKind;

function Inspector({
  summary,
  focusShift,
  focusLabel,
  onApply,
}: {
  summary: { cells: number; shifts: number; minutes: number; rows: number; cols: number } | null;
  focusShift: Shift | undefined;
  focusLabel: string;
  onApply: (spec: CellSpec | null) => void;
}) {
  const initialKind: InspectorKind = !focusShift
    ? 'work-default'
    : focusShift.kind === 'work'
      ? focusShift.usesDefaultHours
        ? 'work-default'
        : 'work-custom'
      : focusShift.kind;
  const [kind, setKind] = useState<InspectorKind>(initialKind);
  const [start, setStart] = useState(focusShift?.start ?? '10:00');
  const [end, setEnd] = useState(focusShift?.end ?? '22:00');
  const [note, setNote] = useState(focusShift?.note ?? '');
  const [noteTouched, setNoteTouched] = useState(false);
  const [error, setError] = useState('');

  if (!summary) {
    return (
      <aside className="inspector" aria-label="Panel zaznaczenia">
        <h2>Zaznaczenie</h2>
        <p className="muted">
          Kliknij komórkę albo przeciągnij, aby zaznaczyć zakres. Kliknięcie nazwy osoby zaznacza
          cały wiersz, a dnia — całą kolumnę.
        </p>
        <p className="muted">
          Skróty: <span className="kbd">Ctrl+A</span> wszystko,{' '}
          <span className="kbd">Shift+strzałki</span> rozciąga.
        </p>
      </aside>
    );
  }

  const apply = () => {
    setError('');
    let spec: CellSpec;
    if (kind === 'work-default') spec = { kind: 'work', useDefault: true };
    else if (kind === 'work-custom') {
      const parsed = parseCellCode(`${start}-${end}`);
      if (parsed === 'invalid' || !parsed) {
        setError('Podaj poprawne, różne godziny (np. 10:00 i 22:00).');
        return;
      }
      spec = parsed;
    } else spec = { kind };
    if (noteTouched) spec = { ...spec, note };
    onApply(spec);
  };

  return (
    <aside className="inspector" aria-label="Panel zaznaczenia">
      <h2>Zaznaczenie</h2>
      <div className="muted">
        {summary.cells === 1 ? (
          <>
            {focusLabel}
            <br />
            <b>{focusShift ? shiftLabel(focusShift) : 'brak zmiany'}</b>
          </>
        ) : (
          <>
            {summary.rows} os. × {summary.cols} dni = {summary.cells} komórek
            <br />
            ze zmianą: <b>{summary.shifts}</b>, razem <b>{formatHours(summary.minutes)}</b>
          </>
        )}
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">Ustaw jako</legend>
        <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
          {(
            [
              ['work-default', 'Praca — godziny domyślne'],
              ['work-custom', 'Praca — własne godziny'],
              ['off', KIND_LABELS.off],
              ['vacation', KIND_LABELS.vacation],
              ['sick', KIND_LABELS.sick],
              ['other', KIND_LABELS.other],
            ] as [InspectorKind, string][]
          ).map(([v, label]) => (
            <label key={v} className="row">
              <input type="radio" name="kind" checked={kind === v} onChange={() => setKind(v)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {kind === 'work-custom' && (
        <div className="row">
          <label className="field">
            <span>Początek</span>
            <input
              className="input"
              style={{ width: 90 }}
              value={start}
              onChange={(e) => setStart(e.target.value)}
              aria-label="Początek zmiany"
            />
          </label>
          <label className="field">
            <span>Koniec</span>
            <input
              className="input"
              style={{ width: 90 }}
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              aria-label="Koniec zmiany"
            />
          </label>
        </div>
      )}
      <label className="field">
        <span>Notatka {summary.cells > 1 && '(zostaw puste, by nie zmieniać)'}</span>
        <textarea
          className="textarea"
          rows={2}
          value={note}
          aria-label="Notatka"
          onChange={(e) => {
            setNote(e.target.value);
            setNoteTouched(true);
          }}
        />
      </label>
      {error && (
        <div className="alert danger" role="alert">
          {error}
        </div>
      )}
      <div className="row">
        <button type="button" className="btn primary grow" onClick={apply}>
          Zastosuj
        </button>
        <button type="button" className="btn danger" onClick={() => onApply(null)}>
          Wyczyść
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        Zmiany są od razu zapisywane i można je cofnąć (<span className="kbd">Ctrl+Z</span>).
        Usunięte zmiany trafiają do Kosza na 30 dni.
      </p>
    </aside>
  );
}
