import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCw, Trash2, Upload } from 'lucide-react';
import { Link } from 'wouter';
import type { ScanImage, ImageSource } from '../../ai/image';
import {
  blockers,
  hasBlockers,
  resolveEntries,
  type ConflictMode,
  type EntryEdit,
  type ImportDecisions,
  type PersonDecision,
} from '../../ai/importPlan';
import {
  shiftYM,
  type NormalizedEntry,
  type NormalizedImport,
  type NormalizedPerson,
} from '../../ai/normalize';
import { usePersons } from '../../app/data';
import { uuid } from '../../db/db';
import { repos } from '../../db/repos';
import { formatDayShort, plural, SHIFTS } from '../../domain/i18n';
import { KIND_LABELS } from '../../domain/labels';
import { fullName } from '../../domain/people';
import { todayISO } from '../../domain/dates';
import type { ScanDraft, Settings, ShiftKind } from '../../domain/types';
import { imageFromClipboardData } from '../../features/scan/clipboard';
import { Modal, useToast } from '../ui';
import { usePc } from '../store';

interface ReviewData {
  normalized: NormalizedImport;
  decisions: ImportDecisions;
  thumb: string;
  model: string;
  promptVersion: string;
  createdAt: number;
}

const loadEngine = () => import('../../features/scan/engine');
const revokeImage = (i: ScanImage) => URL.revokeObjectURL(i.url);
const monthName = (m: number) =>
  new Intl.DateTimeFormat('pl-PL', { month: 'long' }).format(new Date(2026, m - 1, 1));

export function ImportPage({ settings }: { settings: Settings }) {
  const persons = usePersons(true);
  const toast = useToast();
  const setAnchor = usePc((s) => s.setAnchor);
  const [images, setImages] = useState<ScanImage[]>([]);
  const [period, setPeriod] = useState<{ year: number; month: number } | null>(null);
  const [review, setReview] = useState<ReviewData | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'importing'>('idle');
  const [wait, setWait] = useState<number | null>(null);
  const [error, setError] = useState<{ text: string; settings: boolean } | null>(null);
  const [over, setOver] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const imagesRef = useRef(images);
  const reviewRef = useRef(review);
  const ctrl = useRef<AbortController | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    imagesRef.current = images;
    reviewRef.current = review;
  });
  useEffect(
    () => () => {
      imagesRef.current.forEach(revokeImage);
      ctrl.current?.abort();
    },
    [],
  );

  /* ---- szkic (wspólny format z aplikacją mobilną, P-12) ---- */
  useEffect(() => {
    let cancelled = false;
    void repos.imports.getDraft().then((d) => {
      if (cancelled || !d) return;
      const data = d.parsed as Partial<ReviewData> | undefined;
      if (!data?.normalized || !d.decisions) return;
      setReview({
        normalized: data.normalized,
        decisions: d.decisions as ImportDecisions,
        thumb: d.imageThumb,
        model: data.model ?? settings.geminiModel,
        promptVersion: data.promptVersion ?? '',
        createdAt: d.createdAt,
      });
    });
    return () => {
      cancelled = true;
    };
    // tylko przy wejściu na stronę
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!review) return;
    const t = window.setTimeout(() => {
      if (reviewRef.current !== review) return; // odrzucony/zaimportowany w międzyczasie
      const draft: ScanDraft = {
        id: 'current',
        createdAt: review.createdAt,
        parsed: {
          normalized: review.normalized,
          model: review.model,
          promptVersion: review.promptVersion,
        },
        decisions: review.decisions,
        imageThumb: review.thumb,
      };
      void repos.imports.saveDraft(draft).catch(() => {});
    }, 300);
    return () => window.clearTimeout(t);
  }, [review]);

  /* ---- zdjęcia ---- */
  // wiele szybkich dodań (przeciągnięcie, dwa wklejenia) ustawiamy w kolejce — inaczej nadpisywałyby sobie listę
  const queue = useRef<Promise<void>>(Promise.resolve());
  const addFiles = useCallback((files: Blob[], source: ImageSource) => {
    queue.current = queue.current.then(async () => {
      setError(null);
      const eng = await loadEngine();
      let list = imagesRef.current;
      for (const f of files) {
        if (list.length >= eng.MAX_IMAGES) {
          setError({ text: new eng.ImageError('limit').message, settings: false });
          break;
        }
        try {
          list = [...list, await eng.ingestImage(f, source)];
          imagesRef.current = list;
          setImages(list);
        } catch (e) {
          setError({
            text: e instanceof eng.ImageError ? e.message : new eng.ImageError('decode').message,
            settings: false,
          });
        }
      }
    });
    return queue.current;
  }, []);

  // Ctrl+V ze zrzutem ekranu w dowolnym miejscu strony
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (reviewRef.current || lock.current) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea')) return;
      const blob = imageFromClipboardData(e.clipboardData);
      if (!blob) return;
      e.preventDefault();
      void addFiles([blob], 'paste');
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [addFiles]);

  const removeImage = (id: string) => {
    const img = images.find((i) => i.id === id);
    if (img) revokeImage(img);
    setImages(images.filter((i) => i.id !== id));
  };
  const rotate = (id: string) =>
    setImages((l) =>
      l.map((i) =>
        i.id === id
          ? { ...i, rotation: ((i.rotation + 90) % 360) as ScanImage['rotation'], crop: null }
          : i,
      ),
    );

  /* ---- analiza ---- */
  const analyzeNow = async () => {
    if (lock.current) return;
    lock.current = true;
    setError(null);
    const eng = await loadEngine();
    if (!settings.geminiApiKey) {
      lock.current = false;
      setError({ text: new eng.AiError('bad-key').message, settings: true });
      return;
    }
    if (!navigator.onLine) {
      lock.current = false;
      setError({ text: new eng.AiError('offline').message, settings: false });
      return;
    }
    setStatus('running');
    setWait(null);
    const ac = new AbortController();
    ctrl.current = ac;
    try {
      const rendered = await Promise.all(imagesRef.current.map(eng.renderForUpload));
      if (!eng.batchWithinLimit(rendered.map((r) => r.base64.length)))
        throw new eng.ImageError('too-large');
      const today = todayISO();
      const people = (persons ?? []).filter((p) => !p.deletedAt);
      const prompt = eng.buildPrompt({
        today,
        suggestedPeriod: period
          ? `${period.year}-${String(period.month).padStart(2, '0')}`
          : undefined,
        people,
        defaults: settings.defaultHours,
      });
      const res = await eng.generateSchedule({
        apiKey: settings.geminiApiKey,
        model: settings.geminiModel,
        prompt,
        images: rendered.map((r) => ({ mime: 'image/jpeg', base64: r.base64 })),
        signal: ac.signal,
        onWait: (s) => setWait(s > 0 ? s : null),
      });
      const normalized = eng.normalizeSchedule(res.parsed, {
        today,
        suggestedPeriod: period ?? undefined,
        people,
        defaults: settings.defaultHours,
      });
      if (normalized.persons.every((p) => p.entries.length === 0)) throw new eng.AiError('empty');
      const data: ReviewData = {
        normalized,
        decisions: eng.initialDecisions(normalized),
        thumb: await eng.makeThumbnail(rendered[0]!.blob),
        model: res.model,
        promptVersion: eng.PROMPT_VERSION,
        createdAt: Date.now(),
      };
      setReview(data);
      imagesRef.current.forEach(revokeImage);
      setImages([]);
    } catch (e) {
      if (!(e instanceof eng.AiError && e.code === 'aborted')) {
        setError({
          text:
            e instanceof eng.AiError || e instanceof eng.ImageError
              ? e.message
              : new eng.AiError('unknown').message,
          settings: e instanceof eng.AiError && e.goToSettings,
        });
      }
    } finally {
      lock.current = false;
      ctrl.current = null;
      setStatus('idle');
      setWait(null);
    }
  };
  const analyze = () => {
    if (!settings.aiPrivacyAcknowledged) setPrivacy(true);
    else void analyzeNow();
  };

  /* ---- decyzje ---- */
  const updateDecisions = useCallback((fn: (d: ImportDecisions) => ImportDecisions) => {
    setReview((r) => (r ? { ...r, decisions: fn(r.decisions) } : r));
  }, []);

  // podgląd planu: ile zmian dojdzie i ile koliduje z istniejącymi
  const [planInfo, setPlanInfo] = useState<{ add: number; conflicts: number } | null>(null);
  useEffect(() => {
    if (!review || !persons) return;
    let cancelled = false;
    void (async () => {
      try {
        const eng = await loadEngine();
        const dates = review.normalized.persons
          .flatMap((p) => resolveEntries(p, review.decisions).map((e) => e.date))
          .sort();
        const existing = dates.length
          ? await repos.shifts.range(dates[0]!, dates[dates.length - 1]!)
          : [];
        const plan = eng.buildImportPlan(review.normalized, review.decisions, {
          persons: persons.filter((p) => !p.deletedAt),
          existing,
          newId: uuid,
          now: Date.now(),
          batchId: 'preview',
          pickColor: eng.nextColor,
        });
        if (!cancelled) setPlanInfo({ add: plan.shifts.length, conflicts: plan.conflicts.length });
      } catch {
        if (!cancelled) setPlanInfo(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [review, persons]);

  const importNow = async () => {
    const r = reviewRef.current;
    if (!r || lock.current || !persons) return;
    lock.current = true;
    setStatus('importing');
    try {
      const eng = await loadEngine();
      const batchId = uuid();
      const dates = r.normalized.persons
        .flatMap((p) => resolveEntries(p, r.decisions).map((e) => e.date))
        .sort();
      const existing = dates.length
        ? await repos.shifts.range(
            `${Number(dates[0]!.slice(0, 4)) - 1}-01-01`,
            `${Number(dates[dates.length - 1]!.slice(0, 4)) + 1}-12-31`,
          )
        : [];
      const plan = eng.buildImportPlan(r.normalized, r.decisions, {
        persons: persons.filter((p) => !p.deletedAt),
        existing,
        newId: uuid,
        now: Date.now(),
        batchId,
        pickColor: eng.nextColor,
      });
      const res = await repos.imports.apply({
        batch: {
          id: batchId,
          createdAt: Date.now(),
          model: r.model,
          promptVersion: r.promptVersion,
          imageThumb: r.thumb,
        },
        newPersons: plan.newPersons,
        aliasUpdates: plan.aliasUpdates,
        shifts: plan.shifts,
        choose: eng.conflictPolicy(r.decisions),
      });
      // najpierw znika ekran (i oczekujący zapis szkicu), dopiero potem czyścimy szkic w bazie
      reviewRef.current = null;
      setReview(null);
      await repos.imports.clearDraft();
      const skipped = res.skipped ? `, pominięto ${res.skipped}` : '';
      toast(`Zaimportowano ${plural(res.added, SHIFTS)}${skipped}`, {
        label: 'Cofnij',
        run: () => {
          repos.imports
            .revert(batchId)
            .then(() => toast('Wycofano import.'))
            .catch(() => toast('Nie udało się wycofać importu.'));
        },
      });
      const first = plan.shifts.map((s) => s.date).sort()[0];
      if (first) setAnchor(`${first.slice(0, 7)}-01`);
    } catch {
      toast('Import nie powiódł się. Dane nie zostały zmienione.');
    } finally {
      lock.current = false;
      setStatus('idle');
    }
  };

  const discard = async () => {
    reviewRef.current = null;
    setReview(null);
    await repos.imports.clearDraft().catch(() => {});
  };

  const block = useMemo(
    () => (review ? blockers(review.normalized, review.decisions) : null),
    [review],
  );
  const canImport =
    !!review && !!block && !hasBlockers(block) && (planInfo?.add ?? 0) > 0 && status === 'idle';
  const nowY = Number(todayISO().slice(0, 4));

  return (
    <>
      <div className="pc-head">
        <h1>Import ze zdjęcia</h1>
        {review && (
          <>
            <button type="button" className="btn" onClick={() => void discard()}>
              Odrzuć
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!canImport}
              onClick={() => void importNow()}
            >
              {status === 'importing'
                ? 'Importuję…'
                : `Importuj${planInfo ? ` ${plural(planInfo.add, SHIFTS)}` : ''}`}
            </button>
          </>
        )}
      </div>
      <div className="pc-page">
        {error && (
          <div className="alert danger" role="alert" style={{ marginBottom: 12 }}>
            {error.text}{' '}
            {error.settings && (
              <Link href="/ustawienia" style={{ color: 'inherit', fontWeight: 700 }}>
                Przejdź do ustawień
              </Link>
            )}
          </div>
        )}

        {!review && (
          <div className="card" style={{ marginTop: 0 }}>
            <h2>1. Dodaj zdjęcia grafiku</h2>
            <label
              className={`dropzone${over ? ' over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                void addFiles([...e.dataTransfer.files], 'drop');
              }}
              style={{ display: 'block', cursor: 'pointer' }}
            >
              <Upload size={26} aria-hidden />
              <div>
                <b>Przeciągnij zdjęcia tutaj</b>, wklej zrzut ekranu (
                <span className="kbd">Ctrl+V</span>) albo kliknij, aby wybrać pliki.
              </div>
              <div style={{ fontSize: 12 }}>
                Do 4 stron, JPG/PNG/WebP. Zdjęcia nie są nigdzie zapisywane — trafiają tylko do
                Gemini.
              </div>
              <input
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                aria-label="Wybierz pliki ze zdjęciami"
                onChange={(e) => {
                  void addFiles([...(e.target.files ?? [])], 'library');
                  e.target.value = '';
                }}
              />
            </label>
            {images.length > 0 && (
              <div className="thumbs" style={{ marginTop: 14 }}>
                {images.map((img, i) => (
                  <div key={img.id} className="thumb">
                    <img
                      src={img.url}
                      alt={`Strona ${i + 1}`}
                      style={{ transform: `rotate(${img.rotation}deg)` }}
                    />
                    <div className="row">
                      <span className="muted">Strona {i + 1}</span>
                      <span>
                        <button
                          type="button"
                          className="btn icon sm ghost"
                          aria-label={`Obróć stronę ${i + 1}`}
                          onClick={() => rotate(img.id)}
                        >
                          <RotateCw size={14} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="btn icon sm ghost"
                          aria-label={`Usuń stronę ${i + 1}`}
                          onClick={() => removeImage(img.id)}
                        >
                          <Trash2 size={14} aria-hidden />
                        </button>
                      </span>
                    </div>
                    {img.small && (
                      <div className="alert" style={{ fontSize: 11 }}>
                        Małe zdjęcie — może być nieczytelne.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <h2 style={{ marginTop: 18 }}>2. Okres (opcjonalnie)</h2>
            <div className="row">
              <select
                className="select"
                aria-label="Miesiąc grafiku"
                value={period ? period.month : ''}
                onChange={(e) =>
                  setPeriod(
                    e.target.value
                      ? { year: period?.year ?? nowY, month: Number(e.target.value) }
                      : null,
                  )
                }
              >
                <option value="">Wykryj ze zdjęcia</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {monthName(m)}
                  </option>
                ))}
              </select>
              {period && (
                <select
                  className="select"
                  aria-label="Rok grafiku"
                  value={period.year}
                  onChange={(e) => setPeriod({ ...period, year: Number(e.target.value) })}
                >
                  {[nowY - 1, nowY, nowY + 1].map((y) => (
                    <option key={y}>{y}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="row" style={{ marginTop: 18 }}>
              <button
                type="button"
                className="btn primary"
                disabled={images.length === 0 || status !== 'idle'}
                onClick={analyze}
              >
                {status === 'running' ? 'Analizuję…' : 'Analizuj zdjęcia'}
              </button>
              {status === 'running' && (
                <button type="button" className="btn" onClick={() => ctrl.current?.abort()}>
                  Anuluj
                </button>
              )}
              {wait !== null && (
                <span className="badge warn">Limit darmowego API — ponowię za {wait} s</span>
              )}
              {!settings.geminiApiKey && (
                <span className="muted">
                  Brak klucza API — dodaj go w <Link href="/ustawienia">Ustawieniach</Link>.
                </span>
              )}
            </div>
          </div>
        )}

        {review && block && (
          <ReviewPanel
            review={review}
            block={block}
            planInfo={review ? planInfo : null}
            persons={persons ?? []}
            updateDecisions={updateDecisions}
          />
        )}
      </div>

      {privacy && (
        <Modal
          title="Prywatność darmowego API"
          onClose={() => setPrivacy(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setPrivacy(false)}>
                Anuluj
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setPrivacy(false);
                  void repos.settings.update({ aiPrivacyAcknowledged: true }).then(analyzeNow);
                }}
              >
                Rozumiem, analizuj
              </button>
            </>
          }
        >
          <p>
            Na darmowym planie Google może wykorzystywać przesłane dane (zdjęcia z imionami
            współpracowników) do ulepszania modeli. Jeśli grafik zawiera dane, których nie chcesz
            udostępniać, zasłoń je albo użyj płatnego klucza.
          </p>
        </Modal>
      )}
    </>
  );
}

/* ----------------------------------------------------------------- Weryfikacja */

function ReviewPanel({
  review,
  block,
  planInfo,
  persons,
  updateDecisions,
}: {
  review: ReviewData;
  block: ReturnType<typeof blockers>;
  planInfo: { add: number; conflicts: number } | null;
  persons: ReturnType<typeof usePersons> & object;
  updateDecisions: (fn: (d: ImportDecisions) => ImportDecisions) => void;
}) {
  const { normalized, decisions } = review;
  const live = persons.filter((p) => !p.deletedAt);
  const shift = decisions.periodShift;

  return (
    <>
      <div className="card" style={{ marginTop: 0 }}>
        <div className="row">
          <h2 style={{ margin: 0 }}>Weryfikacja odczytu</h2>
          <span className="badge">{review.model}</span>
          {review.thumb && (
            <img
              src={review.thumb}
              alt="Miniatura zdjęcia"
              height={40}
              style={{ borderRadius: 6 }}
            />
          )}
          <span className="grow" />
          <label className="row">
            Przesuń okres:
            <button
              type="button"
              className="btn sm"
              aria-label="Miesiąc wstecz"
              onClick={() =>
                updateDecisions((d) => ({
                  ...d,
                  periodShift: { ...d.periodShift, months: d.periodShift.months - 1 },
                }))
              }
            >
              −1 mies.
            </button>
            <button
              type="button"
              className="btn sm"
              aria-label="Miesiąc naprzód"
              onClick={() =>
                updateDecisions((d) => ({
                  ...d,
                  periodShift: { ...d.periodShift, months: d.periodShift.months + 1 },
                }))
              }
            >
              +1 mies.
            </button>
            <button
              type="button"
              className="btn sm"
              aria-label="Rok wstecz"
              onClick={() =>
                updateDecisions((d) => ({
                  ...d,
                  periodShift: { ...d.periodShift, years: d.periodShift.years - 1 },
                }))
              }
            >
              −1 rok
            </button>
            <button
              type="button"
              className="btn sm"
              aria-label="Rok naprzód"
              onClick={() =>
                updateDecisions((d) => ({
                  ...d,
                  periodShift: { ...d.periodShift, years: d.periodShift.years + 1 },
                }))
              }
            >
              +1 rok
            </button>
            {(shift.years !== 0 || shift.months !== 0) && (
              <span className="badge warn">
                {shift.years ? `${shift.years > 0 ? '+' : ''}${shift.years} r. ` : ''}
                {shift.months ? `${shift.months > 0 ? '+' : ''}${shift.months} mies.` : ''}
              </span>
            )}
          </label>
        </div>
        {normalized.period && (
          <p className="muted" style={{ margin: '8px 0 0' }}>
            Wykryty okres: {monthName(normalized.period.month)} {normalized.period.year}
          </p>
        )}
        {normalized.warnings.length > 0 && (
          <ul
            className="alert"
            style={{ margin: '10px 0 0', paddingLeft: 28 }}
            aria-label="Ostrzeżenia"
          >
            {normalized.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
        {normalized.excluded.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary>Pominięte wpisy ({normalized.excluded.length})</summary>
            <ul>
              {normalized.excluded.map((e, i) => (
                <li key={i}>
                  {e.person} · {e.date} · „{e.rawCell}” — {e.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <label className="row">
            Gdy zmiana już istnieje:
            <select
              className="select"
              aria-label="Postępowanie z kolizjami"
              value={decisions.conflictMode === 'ask' ? 'skip' : decisions.conflictMode}
              onChange={(e) =>
                updateDecisions((d) => ({ ...d, conflictMode: e.target.value as ConflictMode }))
              }
            >
              <option value="skip">Pomiń (zostaw istniejącą)</option>
              <option value="replace">Zastąp importowaną</option>
            </select>
          </label>
          {planInfo && (
            <span className="muted">
              Do zapisu: <b>{plural(planInfo.add, SHIFTS)}</b>
              {planInfo.conflicts > 0 && (
                <>
                  {' '}
                  · kolizje z istniejącymi: <b>{planInfo.conflicts}</b>
                </>
              )}
            </span>
          )}
        </div>
        {hasBlockers(block) && (
          <div className="alert" role="status" style={{ marginTop: 12 }}>
            Import jest zablokowany:
            {block.unresolved.length > 0 && (
              <> {block.unresolved.length} os. czeka na przypisanie lub potwierdzenie;</>
            )}
            {block.duplicate.length > 0 && <> kilka nazw wskazuje tę samą osobę;</>}
            {block.entryConflicts.length > 0 && (
              <> sprzeczne wpisy z różnych stron wymagają wyboru;</>
            )}
            {block.invalid.length > 0 && <> niepoprawne godziny lub daty.</>}
          </div>
        )}
      </div>

      {normalized.persons.map((p) => (
        <PersonReview
          key={p.key}
          person={p}
          decisions={decisions}
          live={live}
          block={block}
          updateDecisions={updateDecisions}
        />
      ))}
    </>
  );
}

function PersonReview({
  person,
  decisions,
  live,
  block,
  updateDecisions,
}: {
  person: NormalizedPerson;
  decisions: ImportDecisions;
  live: { id: string; firstName: string; lastName?: string }[];
  block: ReturnType<typeof blockers>;
  updateDecisions: (fn: (d: ImportDecisions) => ImportDecisions) => void;
}) {
  const dec = decisions.persons[person.key];
  const entries = displayEntries(person, decisions);
  const setDecision = (v: PersonDecision | undefined) =>
    updateDecisions((d) => ({ ...d, persons: { ...d.persons, [person.key]: v } }));
  const edit = (id: string, patch: EntryEdit) =>
    updateDecisions((d) => ({
      ...d,
      entryEdits: { ...d.entryEdits, [id]: { ...d.entryEdits[id], ...patch } },
    }));
  const selectValue = !dec ? '' : dec.mode === 'existing' ? `p:${dec.personId}` : dec.mode;
  const unresolved = block.unresolved.includes(person.key);
  const dup = block.duplicate.includes(person.key);

  return (
    <section className="card" aria-label={`Osoba z grafiku: ${person.nameAsWritten}`}>
      <div className="row">
        <h2 style={{ margin: 0 }}>„{person.nameAsWritten}”</h2>
        {unresolved && <span className="badge warn">do rozstrzygnięcia</span>}
        {dup && <span className="badge danger">ta sama osoba co inna nazwa</span>}
        {dec?.mode === 'existing' && !dec.confirmed && (
          <button
            type="button"
            className="btn sm primary"
            onClick={() => setDecision({ ...dec, confirmed: true })}
          >
            Potwierdź dopasowanie
          </button>
        )}
        <span className="grow" />
        <label className="row">
          Przypisz do:
          <select
            className="select"
            aria-label={`Przypisanie: ${person.nameAsWritten}`}
            value={selectValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') setDecision(undefined);
              else if (v === 'skip') setDecision({ mode: 'skip' });
              else if (v === 'new') {
                const [first, ...rest] = person.nameAsWritten.trim().split(/\s+/);
                setDecision({
                  mode: 'new',
                  firstName: first ?? person.nameAsWritten,
                  lastName: rest.join(' ') || undefined,
                });
              } else setDecision({ mode: 'existing', personId: v.slice(2), confirmed: true });
            }}
          >
            <option value="">— wybierz —</option>
            {live.map((x) => (
              <option key={x.id} value={`p:${x.id}`}>
                {fullName(x)}
                {person.match.personId === x.id ? ' (podpowiedź)' : ''}
              </option>
            ))}
            <option value="new">Nowa osoba…</option>
            <option value="skip">Pomiń tę osobę</option>
          </select>
        </label>
      </div>
      {dec?.mode === 'new' && (
        <div className="row" style={{ marginTop: 8 }}>
          <input
            className="input"
            aria-label="Imię nowej osoby"
            value={dec.firstName}
            onChange={(e) => setDecision({ ...dec, firstName: e.target.value })}
          />
          <input
            className="input"
            aria-label="Nazwisko nowej osoby"
            placeholder="Nazwisko"
            value={dec.lastName ?? ''}
            onChange={(e) => setDecision({ ...dec, lastName: e.target.value })}
          />
        </div>
      )}
      {person.conflicts.length > 0 && (
        <div className="alert" style={{ marginTop: 10 }}>
          <b>Sprzeczne wpisy z różnych stron:</b>
          {person.conflicts.map((c) => {
            const key = `${person.key}|${c.date}`;
            return (
              <div
                key={c.date}
                className="row"
                role="radiogroup"
                aria-label={`Wybór dla ${c.date}`}
              >
                <span>{c.date}:</span>
                {(['first', 'second'] as const).map((w) => {
                  const e = c[w];
                  return (
                    <label key={w} className="row">
                      <input
                        type="radio"
                        name={key}
                        checked={decisions.entryChoice[key] === w}
                        onChange={() =>
                          updateDecisions((d) => ({
                            ...d,
                            entryChoice: { ...d.entryChoice, [key]: w },
                          }))
                        }
                      />
                      {e.kind === 'work' ? `${e.start}–${e.end}` : KIND_LABELS[e.kind]}
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      {dec?.mode !== 'skip' && (
        <div className="table-wrap" style={{ marginTop: 10, maxHeight: 360 }}>
          <table className="table" aria-label={`Wpisy: ${person.nameAsWritten}`}>
            <thead>
              <tr>
                <th>Data</th>
                <th>Rodzaj</th>
                <th>Początek</th>
                <th>Koniec</th>
                <th>Odczytano</th>
                <th>Uwagi</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    Brak wykrytych dni.
                  </td>
                </tr>
              )}
              {entries.map((e) => {
                const removed = decisions.entryEdits[e.id]?.removed;
                return (
                  <tr
                    key={e.id}
                    className={`${e.lowConfidence || e.suspicious ? 'conflict' : ''}${removed ? ' removed' : ''}`}
                  >
                    <td>{formatDayShort(e.date)}</td>
                    <td>
                      <select
                        className="select"
                        aria-label={`Rodzaj ${e.date}`}
                        value={e.kind}
                        onChange={(ev) => edit(e.id, { kind: ev.target.value as ShiftKind })}
                      >
                        {(Object.keys(KIND_LABELS) as ShiftKind[]).map((k) => (
                          <option key={k} value={k}>
                            {KIND_LABELS[k]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {e.kind === 'work' && (
                        <input
                          className="input"
                          style={{ width: 76 }}
                          aria-label={`Początek ${e.date}`}
                          value={e.start ?? ''}
                          onChange={(ev) =>
                            edit(e.id, { start: ev.target.value, usesDefaultHours: false })
                          }
                        />
                      )}
                    </td>
                    <td>
                      {e.kind === 'work' && (
                        <input
                          className="input"
                          style={{ width: 76 }}
                          aria-label={`Koniec ${e.date}`}
                          value={e.end ?? ''}
                          onChange={(ev) =>
                            edit(e.id, { end: ev.target.value, usesDefaultHours: false })
                          }
                        />
                      )}
                    </td>
                    <td className="muted">{e.rawCell}</td>
                    <td>
                      {e.lowConfidence && <span className="badge warn">niska pewność</span>}{' '}
                      {e.suspicious && <span className="badge warn">sprawdź godziny</span>}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => edit(e.id, { removed: !removed })}
                      >
                        {removed ? 'Przywróć' : 'Usuń'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Wszystkie wpisy osoby do tabeli — także usunięte (żeby dało się je przywrócić). Logika jak w resolveEntries. */
function displayEntries(person: NormalizedPerson, d: ImportDecisions): NormalizedEntry[] {
  const { years, months } = d.periodShift;
  return person.entries
    .map((e) => {
      const conflict = person.conflicts.find((c) => c.date === e.date);
      const entry =
        conflict && d.entryChoice[`${person.key}|${e.date}`] === 'second' ? conflict.second : e;
      const ed = d.entryEdits[entry.id] ?? d.entryEdits[e.id];
      const merged: NormalizedEntry = {
        ...entry,
        ...(ed?.kind ? { kind: ed.kind } : {}),
        ...(ed?.start ? { start: ed.start } : {}),
        ...(ed?.end ? { end: ed.end } : {}),
      };
      if (merged.kind !== 'work') {
        merged.start = undefined;
        merged.end = undefined;
      }
      return {
        ...merged,
        date: years || months ? shiftYM(merged.date, years, months) : merged.date,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
