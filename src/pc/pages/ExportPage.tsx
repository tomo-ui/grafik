import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, FileSpreadsheet, Printer } from 'lucide-react';
import { usePersons } from '../../app/data';
import { repos } from '../../db/repos';
import { todayISO } from '../../domain/dates';
import { displayNames, fullName } from '../../domain/people';
import type { Settings } from '../../domain/types';
import { buildPdf, selectPeople } from '../../features/pdf/build';
import {
  defaultOptions,
  rangeDays,
  rangeFor,
  validateRange,
  type PdfOptions,
} from '../../features/pdf/model';
import type { PreviewPage } from '../../features/pdf/render';
import { gridToCsv } from '../logic/report';
import { downloadBlob, Seg } from '../ui';

type RangeKind = 'month' | 'week' | 'custom';
type Status =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'empty'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; blob: Blob; fileName: string; pages: PreviewPage[]; total: number };

const monthName = (m: number) =>
  new Intl.DateTimeFormat('pl-PL', { month: 'long' }).format(new Date(2026, m - 1, 1));

export function ExportPage({ settings }: { settings: Settings }) {
  const persons = usePersons(true);
  const today = todayISO();
  const [opts, setOptions] = useState<PdfOptions>(() => defaultOptions(today));
  const [customRange, setCustomRange] = useState(() => ({
    from: opts.range.from,
    to: opts.range.to,
  }));
  const [kind, setKind] = useState<RangeKind>('month');
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [weekDate, setWeekDate] = useState(today);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const gen = useRef(0);
  const pagesRef = useRef<PreviewPage[]>([]);

  const set = <K extends keyof PdfOptions>(k: K, v: PdfOptions[K]) =>
    setOptions((o) => ({ ...o, [k]: v }));

  // zakres wynika z wybranego rodzaju (bez efektu — liczony przy każdym renderze)
  const range = useMemo<PdfOptions['range']>(
    () =>
      kind === 'custom'
        ? { kind: 'custom', ...customRange }
        : kind === 'week'
          ? rangeFor('week', weekDate, settings.weekStartsOn)
          : rangeFor(
              'month',
              `${year}-${String(month).padStart(2, '0')}-01`,
              settings.weekStartsOn,
            ),
    [kind, customRange, weekDate, year, month, settings.weekStartsOn],
  );
  const options = useMemo<PdfOptions>(() => ({ ...opts, range }), [opts, range]);

  const { from, to } = options.range;
  const rangeError = validateRange(from, to);
  const shifts = useLiveQuery(
    () => (rangeError ? Promise.resolve([]) : repos.shifts.range(from, to)),
    [from, to, rangeError],
  );
  const names = useMemo(() => displayNames(persons ?? []), [persons]);
  const candidates = useMemo(() => (persons ?? []).filter((p) => !p.deletedAt), [persons]);
  const chosen = useMemo(
    () => (persons && shifts ? selectPeople(options, persons, shifts) : []),
    [options, persons, shifts],
  );

  const revoke = () => {
    for (const p of pagesRef.current) URL.revokeObjectURL(p.url);
    pagesRef.current = [];
  };
  useEffect(() => revoke, []);

  // PDF powstaje w tle po każdej zmianie opcji (debounce)
  useEffect(() => {
    if (!persons || !shifts) return;
    if (rangeError) return;
    const id = ++gen.current;
    const t = window.setTimeout(() => {
      const built = buildPdf({
        options,
        persons,
        shifts,
        defaults: settings.defaultHours,
        generatedAt: new Date(),
      });
      if (built.empty) {
        revoke();
        setStatus({ kind: 'empty', message: built.message });
        return;
      }
      setStatus({ kind: 'working' });
      void (async () => {
        try {
          const [{ generatePdfBlob }, { renderPdfPages }] = await Promise.all([
            import('../../features/pdf/generate'),
            import('../../features/pdf/render'),
          ]);
          const blob = await generatePdfBlob(built.doc);
          const { pages, totalPages } = await renderPdfPages(blob, { maxWidth: 1100, maxPages: 8 });
          if (id !== gen.current) {
            for (const p of pages) URL.revokeObjectURL(p.url);
            return;
          }
          revoke();
          pagesRef.current = pages;
          setStatus({ kind: 'ready', blob, fileName: built.fileName, pages, total: totalPages });
        } catch {
          if (id === gen.current) {
            setStatus({
              kind: 'error',
              message: 'Nie udało się wygenerować PDF. Zmień opcje lub spróbuj ponownie.',
            });
          }
        }
      })();
    }, 350);
    return () => window.clearTimeout(t);
  }, [options, persons, shifts, rangeError, settings.defaultHours]);

  const shown: Status = rangeError ? { kind: 'error', message: rangeError } : status;

  const exportCsv = () => {
    const csv = gridToCsv(chosen, rangeDays(from, to), shifts ?? []);
    downloadBlob(
      new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }),
      `Grafik_${from}_${to}.csv`,
    );
  };

  const years = Array.from({ length: 11 }, (_, i) => Number(today.slice(0, 4)) - 8 + i);
  const selectedIds = Array.isArray(options.people) ? options.people : [];

  return (
    <>
      <div className="pc-head">
        <h1>Eksport</h1>
        <button
          type="button"
          className="btn"
          disabled={!chosen.length || !!rangeError}
          onClick={exportCsv}
        >
          <FileSpreadsheet size={15} aria-hidden /> Pobierz CSV (siatka)
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={shown.kind !== 'ready'}
          onClick={() => shown.kind === 'ready' && downloadBlob(shown.blob, shown.fileName)}
        >
          <Download size={15} aria-hidden /> Pobierz PDF
        </button>
      </div>
      <div className="pc-page">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '340px minmax(0, 1fr)',
            gap: 20,
            alignItems: 'start',
          }}
        >
          <div className="card" style={{ marginTop: 0 }}>
            <h2>Opcje</h2>
            <div className="field" style={{ marginBottom: 12 }}>
              <span>Układ</span>
              <Seg
                label="Układ"
                value={options.layout}
                onChange={(v) => set('layout', v)}
                options={[
                  { value: 'team', label: 'Siatka zespołu (A4 poziomo)' },
                  { value: 'person', label: 'Lista osoby (A4 pionowo)' },
                ]}
              />
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <span>Okres</span>
              <Seg
                label="Rodzaj okresu"
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'month', label: 'Miesiąc' },
                  { value: 'week', label: 'Tydzień' },
                  { value: 'custom', label: 'Własny' },
                ]}
              />
              {kind === 'month' && (
                <div className="row">
                  <select
                    className="select"
                    aria-label="Miesiąc"
                    value={month}
                    onChange={(e) => setMonth(Number(e.target.value))}
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
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                  >
                    {years.map((y) => (
                      <option key={y}>{y}</option>
                    ))}
                  </select>
                </div>
              )}
              {kind === 'week' && (
                <input
                  className="input"
                  type="date"
                  aria-label="Dzień w tygodniu"
                  value={weekDate}
                  onChange={(e) => e.target.value && setWeekDate(e.target.value)}
                />
              )}
              {kind === 'custom' && (
                <div className="row">
                  <input
                    className="input"
                    type="date"
                    aria-label="Od dnia"
                    value={from}
                    onChange={(e) => e.target.value && setCustomRange({ from: e.target.value, to })}
                  />
                  <input
                    className="input"
                    type="date"
                    aria-label="Do dnia"
                    value={to}
                    onChange={(e) => e.target.value && setCustomRange({ from, to: e.target.value })}
                  />
                </div>
              )}
              <span className="muted">
                {from} — {to} (maks. 31 dni)
              </span>
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <span>Osoby</span>
              <Seg
                label="Osoby"
                value={options.people === 'all' ? 'all' : options.people === 'me' ? 'me' : 'pick'}
                onChange={(v) => set('people', v === 'pick' ? selectedIds : v)}
                options={[
                  { value: 'all', label: 'Wszyscy' },
                  { value: 'me', label: 'Tylko ja' },
                  { value: 'pick', label: 'Wybrani' },
                ]}
              />
              {Array.isArray(options.people) && (
                <div
                  style={{
                    maxHeight: 180,
                    overflow: 'auto',
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                    padding: 8,
                  }}
                >
                  {candidates.map((p) => (
                    <label key={p.id} className="row" style={{ padding: '2px 0' }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(p.id)}
                        onChange={(e) =>
                          set(
                            'people',
                            e.target.checked
                              ? [...selectedIds, p.id]
                              : selectedIds.filter((x) => x !== p.id),
                          )
                        }
                      />
                      {names.get(p.id) ?? fullName(p)}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="field">
              <span>Zawartość</span>
              <label className="row">
                <input
                  type="checkbox"
                  checked={options.color}
                  onChange={(e) => set('color', e.target.checked)}
                />
                Kolory (odznacz = czarno-biały)
              </label>
              <label className="row">
                <input
                  type="checkbox"
                  checked={options.showTotals}
                  onChange={(e) => set('showTotals', e.target.checked)}
                />
                Sumy godzin
              </label>
              <label className="row">
                <input
                  type="checkbox"
                  checked={options.showStaffing}
                  onChange={(e) => set('showStaffing', e.target.checked)}
                />
                Obsada dzienna
              </label>
              <label className="row">
                <input
                  type="checkbox"
                  checked={options.showNotes}
                  onChange={(e) => set('showNotes', e.target.checked)}
                />
                Notatki
              </label>
            </div>
          </div>

          <div>
            <div className="card" style={{ marginTop: 0, minHeight: 240 }} aria-live="polite">
              <div className="row" style={{ marginBottom: 10 }}>
                <h2 style={{ margin: 0 }}>Podgląd</h2>
                {shown.kind === 'ready' && (
                  <>
                    <span className="badge ok">{shown.fileName}</span>
                    <span className="muted">
                      {shown.total} {shown.total === 1 ? 'strona' : 'stron'}
                      {shown.total > shown.pages.length && ` (podgląd: ${shown.pages.length})`}
                    </span>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => window.print()}
                      title="Drukuj podgląd"
                    >
                      <Printer size={14} aria-hidden /> Drukuj
                    </button>
                  </>
                )}
                {shown.kind === 'working' && <span className="muted">Generowanie…</span>}
              </div>
              {shown.kind === 'empty' && <div className="alert">{shown.message}</div>}
              {shown.kind === 'error' && (
                <div className="alert danger" role="alert">
                  {shown.message}
                </div>
              )}
              {shown.kind === 'ready' && (
                <div className="preview-pages">
                  {shown.pages.map((p, i) => (
                    <img
                      key={p.url}
                      src={p.url}
                      alt={`Strona ${i + 1} z ${shown.total}`}
                      width={p.width / 2}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
