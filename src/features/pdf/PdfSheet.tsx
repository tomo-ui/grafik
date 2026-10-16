import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Eye, Share2, Download, X, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Alert,
  Button,
  GroupedList,
  ListRow,
  SegmentedControl,
  Sheet,
  Spinner,
  Toggle,
  useBackClose,
  useToast,
} from '../../ui';
import { repos } from '../../db/repos';
import { usePersons } from '../../app/data';
import { detectPlatform } from '../../app/install';
import { todayISO } from '../../domain/dates';
import { colorVar, displayNames } from '../../domain/people';
import type { Settings } from '../../domain/types';
import { buildPdf } from './build';
import { generatePdfBlob } from './generate';
import {
  defaultOptions,
  periodTitle,
  rangeFor,
  validateRange,
  type PdfOptions,
  type RangeKind,
} from './model';
import { renderPdfPages, revokePreview, type PreviewPage } from './render';
import { shiftPeriod } from '../../domain/views';

import styles from './Pdf.module.css';

type Status =
  | { kind: 'idle' }
  | { kind: 'generating' }
  | { kind: 'empty'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; file: File; forOptions: PdfOptions };

const kb = (n: number) =>
  n < 1024 * 1024
    ? `${Math.max(1, Math.round(n / 1024))} kB`
    : `${(n / 1048576).toFixed(1)} MB`.replace('.', ',');

/**
 * Sheet „Eksportuj PDF” (8.7). PDF powstaje w tle po każdej zmianie opcji (debounce 300 ms),
 * dzięki czemu „Udostępnij” może wywołać navigator.share() bez żadnego await (P-02).
 */
export function PdfSheet({
  open,
  settings,
  initial,
  onClose,
}: {
  open: boolean;
  settings: Settings;
  initial?: { kind: 'week' | 'month'; anchor: string };
  onClose: () => void;
}) {
  const toast = useToast();
  const persons = usePersons(true);
  const today = todayISO();

  const [options, setOptions] = useState<PdfOptions>(() => {
    const base = defaultOptions(today);
    if (!initial) return base;
    return { ...base, range: rangeFor(initial.kind, initial.anchor, settings.weekStartsOn) };
  });
  const [anchor, setAnchor] = useState(initial?.anchor ?? today);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [preview, setPreview] = useState<{ pages: PreviewPage[]; total: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [needsShare, setNeedsShare] = useState(false);
  const gen = useRef(0);
  const platform = detectPlatform();

  const set = <K extends keyof PdfOptions>(k: K, v: PdfOptions[K]) =>
    setOptions((o) => ({ ...o, [k]: v }));

  const { from, to } = options.range;
  const rangeError = validateRange(from, to);
  const shifts = useLiveQuery(() => repos.shifts.range(from, to), [from, to]);
  const names = useMemo(() => displayNames(persons ?? []), [persons]);
  const live = useMemo(() => (persons ?? []).filter((p) => !p.deletedAt && !p.archived), [persons]);
  const hasMe = live.some((p) => p.isMe);

  /* ---- generowanie w tle ---- */
  useEffect(() => {
    if (!open || !persons || !shifts) return;
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
        setStatus({ kind: 'empty', message: built.message });
        return;
      }
      setStatus({ kind: 'generating' });
      generatePdfBlob(built.doc)
        .then((blob) => {
          if (id !== gen.current) return; // nowsza wersja opcji już się generuje
          setStatus({
            kind: 'ready',
            file: new File([blob], built.fileName, { type: 'application/pdf' }),
            forOptions: options,
          });
        })
        .catch(() => {
          if (id === gen.current) {
            setStatus({
              kind: 'error',
              message: 'Nie udało się wygenerować PDF. Spróbuj ponownie.',
            });
          }
        });
    }, 300);
    return () => window.clearTimeout(t);
  }, [open, options, persons, shifts, settings.defaultHours]);

  // sprzątanie podglądu (object URL-e) przy zamknięciu i zmianie pliku
  useEffect(() => {
    return () => {
      if (preview) revokePreview(preview.pages);
    };
  }, [preview]);

  // gotowy plik dotyczy konkretnych opcji — po ich zmianie od razu wracamy do spinnera
  const stale = status.kind === 'ready' && status.forOptions !== options;
  const ready = status.kind === 'ready' && !stale ? status.file : null;
  const canShare =
    !!ready && typeof navigator.canShare === 'function' && navigator.canShare({ files: [ready] });

  /** P-02: bez żadnego `await` przed navigator.share() — plik jest już gotowy. */
  const share = () => {
    if (!ready) return;
    if (!navigator.canShare?.({ files: [ready] })) {
      setNeedsShare(true);
      return;
    }
    navigator.share({ files: [ready], title: ready.name }).catch((e: unknown) => {
      if (e instanceof DOMException && e.name === 'AbortError') return; // zamknięcie arkusza ≠ błąd
      toast('Nie udało się udostępnić pliku.');
    });
  };

  const download = () => {
    if (!ready) return;
    // iOS (PWA): <a download> / blob URL potrafi zablokować aplikację (P-03) — tylko arkusz udostępniania
    if (platform === 'ios') {
      share();
      return;
    }
    const url = URL.createObjectURL(ready);
    const a = document.createElement('a');
    a.href = url;
    a.download = ready.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const openPreview = async () => {
    if (!ready) return;
    setPreviewing(true);
    setPreviewError('');
    try {
      const r = await renderPdfPages(ready);
      setPreview({ pages: r.pages, total: r.totalPages });
    } catch {
      setPreviewError('Nie udało się wyświetlić podglądu.');
    } finally {
      setPreviewing(false);
    }
  };

  const rangeKind = options.range.kind;
  const setRangeKind = (k: RangeKind) => {
    if (k === 'custom') {
      set('range', { kind: 'custom', from: options.range.from, to: options.range.to });
    } else {
      set('range', rangeFor(k, anchor, settings.weekStartsOn));
    }
  };
  const nav = (delta: -1 | 1) => {
    if (rangeKind === 'custom') return;
    const next = shiftPeriod(
      rangeKind === 'month' ? `${anchor.slice(0, 7)}-01` : anchor,
      rangeKind,
      delta,
    );
    setAnchor(next);
    set('range', rangeFor(rangeKind, next, settings.weekStartsOn));
  };

  const peopleMode: 'all' | 'me' | 'some' =
    options.people === 'all' ? 'all' : options.people === 'me' ? 'me' : 'some';
  const chosen = Array.isArray(options.people) ? options.people : [];

  return (
    <>
      <Sheet open={open} onClose={onClose} title="Eksportuj PDF" detent="large">
        <GroupedList header="Zakres">
          <div className={styles.seg}>
            <SegmentedControl<RangeKind>
              label="Zakres"
              value={rangeKind}
              onChange={setRangeKind}
              options={[
                { value: 'week', label: 'Tydzień' },
                { value: 'month', label: 'Miesiąc' },
                { value: 'custom', label: 'Własny' },
              ]}
            />
          </div>
          {rangeKind !== 'custom' ? (
            <div className={styles.navRow}>
              <button
                type="button"
                aria-label="Poprzedni okres"
                className={styles.navBtn}
                onClick={() => nav(-1)}
              >
                <ChevronLeft size={22} />
              </button>
              <span data-testid="pdf-range" className={styles.rangeLabel}>
                <strong>{periodTitle(options.range)}</strong>
                <small>
                  {from} — {to}
                </small>
              </span>
              <button
                type="button"
                aria-label="Następny okres"
                className={styles.navBtn}
                onClick={() => nav(1)}
              >
                <ChevronRight size={22} />
              </button>
            </div>
          ) : (
            <div className={styles.dates}>
              <label>
                <span>Od</span>
                <input
                  type="date"
                  aria-label="Od"
                  value={from}
                  onChange={(e) =>
                    e.target.value && set('range', { kind: 'custom', from: e.target.value, to })
                  }
                />
              </label>
              <label>
                <span>Do</span>
                <input
                  type="date"
                  aria-label="Do"
                  value={to}
                  onChange={(e) =>
                    e.target.value && set('range', { kind: 'custom', from, to: e.target.value })
                  }
                />
              </label>
            </div>
          )}
          {rangeError && (
            <p role="alert" className={styles.err}>
              {rangeError}
            </p>
          )}
        </GroupedList>

        <GroupedList header="Osoby">
          <div className={styles.seg}>
            <SegmentedControl<'all' | 'some' | 'me'>
              label="Osoby"
              value={peopleMode}
              onChange={(m) =>
                set('people', m === 'all' ? 'all' : m === 'me' ? 'me' : live.map((p) => p.id))
              }
              options={[
                { value: 'all', label: 'Wszyscy' },
                { value: 'some', label: 'Wybrane' },
                { value: 'me', label: 'Tylko ja' },
              ]}
            />
          </div>
          {peopleMode === 'me' && !hasMe && (
            <p role="status" className={styles.err}>
              Nie wybrano, która osoba to Ty (Ustawienia → Osoby).
            </p>
          )}
          {peopleMode === 'some' && (
            <div className={styles.chips} role="group" aria-label="Wybrane osoby">
              {live.map((p) => {
                const on = chosen.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    className={`${styles.chip} ${on ? styles.chipOn : ''}`}
                    onClick={() =>
                      set('people', on ? chosen.filter((x) => x !== p.id) : [...chosen, p.id])
                    }
                  >
                    <span className={styles.dot} style={{ background: colorVar(p.color) }} />
                    {names.get(p.id)}
                  </button>
                );
              })}
            </div>
          )}
        </GroupedList>

        <GroupedList header="Wygląd">
          <ListRow
            title="Układ"
            trailing={
              <SegmentedControl<'team' | 'person'>
                label="Układ"
                value={options.layout}
                onChange={(v) => set('layout', v)}
                options={[
                  { value: 'team', label: 'Siatka' },
                  { value: 'person', label: 'Lista' },
                ]}
              />
            }
          />
          <ListRow
            title="Kolory"
            trailing={
              <SegmentedControl<'color' | 'bw'>
                label="Kolory"
                value={options.color ? 'color' : 'bw'}
                onChange={(v) => set('color', v === 'color')}
                options={[
                  { value: 'color', label: 'Kolor' },
                  { value: 'bw', label: 'Cz-b' },
                ]}
              />
            }
          />
          <ListRow
            title="Sumy godzin"
            trailing={
              <Toggle
                label="Sumy godzin"
                checked={options.showTotals}
                onChange={(v) => set('showTotals', v)}
              />
            }
          />
          {options.layout === 'team' && (
            <ListRow
              title="Obsada dzienna"
              trailing={
                <Toggle
                  label="Obsada dzienna"
                  checked={options.showStaffing}
                  onChange={(v) => set('showStaffing', v)}
                />
              }
            />
          )}
          <ListRow
            title="Notatki"
            trailing={
              <Toggle
                label="Notatki"
                checked={options.showNotes}
                onChange={(v) => set('showNotes', v)}
              />
            }
            last
          />
        </GroupedList>

        <div className={styles.status} role="status" aria-live="polite" data-testid="pdf-status">
          {(status.kind === 'generating' || stale) && (
            <>
              <Spinner size={18} /> Przygotowuję PDF…
            </>
          )}
          {status.kind === 'empty' && <span className={styles.empty}>{status.message}</span>}
          {status.kind === 'error' && <span className={styles.errText}>{status.message}</span>}
          {status.kind === 'ready' && !stale && (
            <span>
              Gotowe: <strong>{status.file.name}</strong> · {kb(status.file.size)}
            </span>
          )}
        </div>

        <div className={styles.actions}>
          <Button
            variant="tinted"
            onClick={() => void openPreview()}
            disabled={!ready || previewing}
          >
            {previewing ? <Spinner size={18} /> : <Eye size={18} />} Podgląd
          </Button>
          <Button onClick={share} disabled={!ready}>
            {ready ? <Share2 size={18} /> : <Spinner size={18} label="Przygotowuję" />} Udostępnij
          </Button>
          <Button variant="plain" onClick={download} disabled={!ready}>
            <Download size={18} /> {platform === 'ios' ? 'Zapisz w Plikach' : 'Zapisz / pobierz'}
          </Button>
          {status.kind === 'error' && (
            <Button variant="tinted" onClick={() => setOptions((o) => ({ ...o }))}>
              Spróbuj ponownie
            </Button>
          )}
          {previewError && (
            <p role="alert" className={styles.err}>
              {previewError}
            </p>
          )}
          {platform === 'ios' && (
            <p className={styles.hint}>Wybierz „Zachowaj w Plikach” w arkuszu udostępniania.</p>
          )}
          {ready && !canShare && platform !== 'ios' && (
            <p className={styles.hint}>
              Ta przeglądarka nie udostępnia plików — użyj „Zapisz / pobierz”.
            </p>
          )}
        </div>
      </Sheet>

      {preview && (
        <PdfPreview
          pages={preview.pages}
          total={preview.total}
          onClose={() => {
            revokePreview(preview.pages);
            setPreview(null);
          }}
        />
      )}

      <Alert
        open={needsShare}
        title="Nie można udostępnić pliku"
        message="To urządzenie nie obsługuje udostępniania plików z tej przeglądarki. Zainstaluj aplikację lub użyj Chrome."
        onClose={() => setNeedsShare(false)}
        actions={[{ label: 'OK', onSelect: () => {} }]}
      />
    </>
  );
}

/** Podgląd w aplikacji (P-03): strony jako obrazy, z przyciskiem zamknięcia i obsługą „wstecz”. */
function PdfPreview({
  pages,
  total,
  onClose,
}: {
  pages: PreviewPage[];
  total: number;
  onClose: () => void;
}) {
  useBackClose(true, onClose);
  // portal do <body>: #root bywa przeskalowany (transform), przez co jego dzieci lądują pod warstwą sheetu
  return createPortal(
    <div
      className={styles.preview}
      role="dialog"
      aria-modal="true"
      aria-label="Podgląd PDF"
      data-testid="pdf-preview"
    >
      <header className={styles.previewBar}>
        <span>
          Podgląd · {total} {total === 1 ? 'strona' : total < 5 ? 'strony' : 'stron'}
        </span>
        <button
          type="button"
          className={styles.previewClose}
          aria-label="Zamknij podgląd"
          onClick={onClose}
        >
          <X size={24} />
        </button>
      </header>
      <div className={styles.previewBody}>
        {pages.map((p, i) => (
          <img
            key={p.url}
            src={p.url}
            alt={`Strona ${i + 1} z ${total}`}
            className={styles.previewPage}
          />
        ))}
        {total > pages.length && (
          <p className={styles.hint}>Pokazano pierwsze {pages.length} stron.</p>
        )}
      </div>
    </div>,
    document.body,
  );
}
