import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'wouter';
import { runWhenSettled, useToast } from '../../ui';
import { repos } from '../../db/repos';
import { uuid } from '../../db/db';
import { usePersons } from '../../app/data';
import type { Crop, ImageSource, ScanImage } from '../../ai/image';
import type { ImportDecisions } from '../../ai/importPlan';
import type { NormalizedImport } from '../../ai/normalize';
import { plural, SHIFTS } from '../../domain/i18n';
import { todayISO } from '../../domain/dates';
import type { ScanDraft, Settings } from '../../domain/types';
import { useUi } from '../../store/ui';
import { imageFromClipboardData } from './clipboard';

// ciężkie ekrany i logika ładowane dopiero przy pierwszym użyciu (pakiet startowy < 200 kB gzip)
const ScanSheet = lazy(() => import('./ScanSheet').then((m) => ({ default: m.ScanSheet })));
const ReviewScreen = lazy(() =>
  import('./ReviewScreen').then((m) => ({ default: m.ReviewScreen })),
);
const loadEngine = () => import('./engine');
const revokeScanImage = (i: ScanImage) => URL.revokeObjectURL(i.url);

export type ScanStep = 'closed' | 'pick' | 'preview' | 'running' | 'review';

export interface ReviewData {
  normalized: NormalizedImport;
  decisions: ImportDecisions;
  thumb: string;
  model: string;
  promptVersion: string;
  createdAt: number;
}

export interface ScanApi {
  step: ScanStep;
  images: ScanImage[];
  active: number;
  period: { year: number; month: number } | null;
  /** komunikat o problemie (AI lub obrazu); `goToSettings` = pokaż skrót do ustawień */
  error: { message: string; goToSettings: boolean } | null;
  notice: string;
  waitSec: number | null;
  privacyPrompt: boolean;
  settings: Settings;
  review: ReviewData | null;
  importing: boolean;
  openScan: () => void;
  close: () => void;
  addBlobs: (blobs: Blob[], source: ImageSource) => Promise<void>;
  removeImage: (id: string) => void;
  setActive: (i: number) => void;
  rotate: (id: string) => void;
  setCrop: (id: string, crop: Crop | null) => void;
  setPeriod: (p: { year: number; month: number } | null) => void;
  analyze: () => Promise<void>;
  cancelAnalysis: () => void;
  backToPick: () => void;
  backToPreview: () => void;
  confirmPrivacy: () => Promise<void>;
  dismissPrivacy: () => void;
  setNotice: (s: string) => void;
  updateDecisions: (fn: (d: ImportDecisions) => ImportDecisions) => void;
  importNow: () => Promise<void>;
  discardReview: () => Promise<void>;
}

const Ctx = createContext<ScanApi | null>(null);
export const useScan = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useScan poza ScanProvider');
  return v;
};

const isEditable = (t: EventTarget | null) =>
  !!(t as HTMLElement | null)?.closest?.(
    'input, textarea, select, [contenteditable="true"]:not([data-paste-zone])',
  );

/**
 * Maszyna stanów skanowania: wybór → podgląd → analiza → weryfikacja → import.
 * Stan weryfikacji jest zapisywany jako szkic w IndexedDB (P-12) i odtwarzany po ubiciu aplikacji.
 */
export function ScanProvider({ settings, children }: { settings: Settings; children: ReactNode }) {
  const toast = useToast();
  const [, navigate] = useLocation();
  const persons = usePersons(true);

  const [step, setStep] = useState<ScanStep>('closed');
  const [images, setImages] = useState<ScanImage[]>([]);
  const [active, setActive] = useState(0);
  const [period, setPeriod] = useState<ScanApi['period']>(null);
  const [error, setError] = useState<ScanApi['error']>(null);
  const [notice, setNotice] = useState('');
  const [waitSec, setWaitSec] = useState<number | null>(null);
  const [privacyPrompt, setPrivacyPrompt] = useState(false);
  const [review, setReview] = useState<ReviewData | null>(null);
  const [importing, setImporting] = useState(false);
  // leniwe ekrany montujemy po pierwszym otwarciu
  const [mounted, setMounted] = useState(false);
  if (!mounted && step !== 'closed') setMounted(true);

  const lock = useRef(false);
  const ctrl = useRef<AbortController | null>(null);
  const imagesRef = useRef(images);
  const reviewRef = useRef(review);
  useEffect(() => {
    imagesRef.current = images;
    reviewRef.current = review;
  });

  /* ---------- sprzątanie object URL-i przy odmontowaniu (audyt: wycieki) ---------- */
  useEffect(
    () => () => {
      imagesRef.current.forEach(revokeScanImage);
      ctrl.current?.abort();
    },
    [],
  );

  /* ---------- odtworzenie szkicu po ubiciu aplikacji (P-12) ---------- */
  useEffect(() => {
    let cancelled = false;
    repos.imports
      .getDraft()
      .then((d) => {
        if (cancelled || !d) return;
        const data = d.parsed as Partial<ReviewData> | undefined;
        if (!data?.normalized || !d.decisions) {
          void repos.imports.clearDraft();
          return;
        }
        setReview({
          normalized: data.normalized,
          decisions: d.decisions as ImportDecisions,
          thumb: d.imageThumb,
          model: data.model ?? settings.geminiModel,
          promptVersion: data.promptVersion ?? '',
          createdAt: d.createdAt,
        });
        setStep('review');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // tylko przy starcie
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistDraft = useCallback((r: ReviewData) => {
    const draft: ScanDraft = {
      id: 'current',
      createdAt: r.createdAt,
      parsed: {
        normalized: r.normalized,
        model: r.model,
        promptVersion: r.promptVersion,
      },
      decisions: r.decisions,
      imageThumb: r.thumb,
    };
    return repos.imports.saveDraft(draft).catch(() => {});
  }, []);

  // zapis szkicu z opóźnieniem po każdej decyzji + natychmiast przy ukryciu aplikacji
  useEffect(() => {
    if (!review) return;
    const t = window.setTimeout(() => {
      if (reviewRef.current === review) void persistDraft(review);
    }, 300);
    return () => window.clearTimeout(t);
  }, [review, persistDraft]);
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden' && reviewRef.current) {
        void persistDraft(reviewRef.current);
      }
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, [persistDraft]);

  /* ---------- obrazy ---------- */
  const resetImages = useCallback(() => {
    imagesRef.current.forEach(revokeScanImage);
    setImages([]);
    setActive(0);
  }, []);

  const addBlobs = useCallback(async (blobs: Blob[], source: ImageSource) => {
    setNotice('');
    const eng = await loadEngine();
    let list = imagesRef.current;
    for (const blob of blobs) {
      if (list.length >= eng.MAX_IMAGES) {
        setNotice(new eng.ImageError('limit').message);
        break;
      }
      try {
        const img = await eng.ingestImage(blob, source);
        list = [...list, img];
        setImages(list);
        setActive(list.length - 1);
      } catch (e) {
        setNotice(e instanceof eng.ImageError ? e.message : new eng.ImageError('decode').message);
      }
    }
    if (list.length > 0) setStep('preview');
  }, []);

  const openScan = useCallback(() => {
    setError(null);
    setNotice('');
    setStep(imagesRef.current.length > 0 ? 'preview' : 'pick');
  }, []);

  const close = useCallback(() => {
    ctrl.current?.abort();
    resetImages();
    setError(null);
    setNotice('');
    setStep('closed');
  }, [resetImages]);

  const removeImage = useCallback((id: string) => {
    const img = imagesRef.current.find((i) => i.id === id);
    if (img) revokeScanImage(img);
    const next = imagesRef.current.filter((i) => i.id !== id);
    setImages(next);
    setActive((a) => Math.max(0, Math.min(a, next.length - 1)));
    if (next.length === 0) setStep('pick');
  }, []);

  const rotate = useCallback((id: string) => {
    setImages((list) =>
      list.map((i) =>
        i.id === id
          ? { ...i, rotation: ((i.rotation + 90) % 360) as ScanImage['rotation'], crop: null }
          : i,
      ),
    );
  }, []);
  const setCrop = useCallback((id: string, crop: Crop | null) => {
    setImages((list) => list.map((i) => (i.id === id ? { ...i, crop } : i)));
  }, []);

  /* ---------- analiza ---------- */
  const analyzeNow = useCallback(async () => {
    if (lock.current) return;
    lock.current = true;
    const eng = await loadEngine();
    if (!settings.geminiApiKey) {
      lock.current = false;
      setError({ message: new eng.AiError('bad-key').message, goToSettings: true });
      return;
    }
    if (!navigator.onLine) {
      lock.current = false;
      setError({ message: new eng.AiError('offline').message, goToSettings: false });
      return;
    }
    setError(null);
    setWaitSec(null);
    setStep('running');
    const ac = new AbortController();
    ctrl.current = ac;
    try {
      const rendered = await Promise.all(imagesRef.current.map(eng.renderForUpload));
      if (!eng.batchWithinLimit(rendered.map((r) => r.base64.length))) {
        throw new eng.ImageError('too-large');
      }
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
        onWait: (s) => setWaitSec(s > 0 ? s : null),
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
      await persistDraft(data);
      setReview(data);
      resetImages();
      setStep('review');
    } catch (e) {
      if (e instanceof eng.AiError && e.code === 'aborted') {
        setStep('preview');
      } else {
        setError({
          message:
            e instanceof eng.AiError || e instanceof eng.ImageError
              ? e.message
              : new eng.AiError('unknown').message,
          goToSettings: e instanceof eng.AiError && e.goToSettings,
        });
        setStep('preview'); // zdjęcia zostają — „Ponów” bez ponownego wyboru (P-25)
      }
    } finally {
      lock.current = false;
      ctrl.current = null;
      setWaitSec(null);
    }
  }, [settings, persons, period, persistDraft, resetImages]);

  const analyze = useCallback(async () => {
    if (!settings.aiPrivacyAcknowledged) {
      setPrivacyPrompt(true); // jednorazowa informacja o prywatności przed pierwszym skanem
      return;
    }
    await analyzeNow();
  }, [settings.aiPrivacyAcknowledged, analyzeNow]);

  const confirmPrivacy = useCallback(async () => {
    setPrivacyPrompt(false);
    await repos.settings.update({ aiPrivacyAcknowledged: true });
    await analyzeNow();
  }, [analyzeNow]);

  /* ---------- weryfikacja i import ---------- */
  const updateDecisions = useCallback((fn: (d: ImportDecisions) => ImportDecisions) => {
    setReview((r) => (r ? { ...r, decisions: fn(r.decisions) } : r));
  }, []);

  const discardReview = useCallback(async () => {
    reviewRef.current = null; // anuluje oczekujący zapis szkicu (opóźniony o 300 ms)
    setReview(null);
    setStep('closed');
    await repos.imports.clearDraft().catch(() => {});
  }, []);

  const importNow = useCallback(async () => {
    const r = reviewRef.current;
    if (!r || lock.current) return;
    lock.current = true;
    setImporting(true);
    try {
      const eng = await loadEngine();
      const batchId = uuid();
      const allPersons = (persons ?? []).filter((p) => !p.deletedAt);
      const dates = r.normalized.persons.flatMap((p) => p.entries.map((e) => e.date)).sort();
      const existing =
        dates.length > 0
          ? await repos.shifts.range(
              // z zapasem na przesunięcie okresu przez użytkownika
              `${Number(dates[0]!.slice(0, 4)) - 1}-01-01`,
              `${Number(dates[dates.length - 1]!.slice(0, 4)) + 1}-12-31`,
            )
          : [];
      const plan = eng.buildImportPlan(r.normalized, r.decisions, {
        persons: allPersons,
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
      reviewRef.current = null;
      setReview(null);
      setStep('closed');
      await repos.imports.clearDraft();
      const skipped = res.skipped ? `, pominięto ${res.skipped}` : '';
      toast(`Zaimportowano ${plural(res.added, SHIFTS)}${skipped}`, () => {
        repos.imports
          .revert(batchId)
          .then(() => toast('Wycofano import'))
          .catch(() => toast('Nie udało się wycofać importu.'));
      });
      // po imporcie widok przechodzi do zaimportowanego okresu
      const first = plan.shifts.map((s) => s.date).sort()[0];
      if (first) useUi.setState({ teamMode: 'month', teamAnchor: `${first.slice(0, 7)}-01` });
      runWhenSettled(() => navigate('/team'));
    } catch {
      toast('Import nie powiódł się. Dane nie zostały zmienione.');
    } finally {
      lock.current = false;
      setImporting(false);
    }
  }, [persons, toast, navigate]);

  /* ---------- globalne wklejanie (Ctrl/Cmd+V) ---------- */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (reviewRef.current || lock.current) return;
      if (isEditable(e.target)) return;
      const blob = imageFromClipboardData(e.clipboardData);
      if (!blob) return;
      e.preventDefault();
      setStep((s) => (s === 'closed' ? 'pick' : s));
      void addBlobs([blob], 'paste');
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [addBlobs]);

  const api: ScanApi = useMemo(
    () => ({
      step,
      images,
      active,
      period,
      error,
      notice,
      waitSec,
      privacyPrompt,
      settings,
      review,
      importing,
      openScan,
      close,
      addBlobs,
      removeImage,
      setActive,
      rotate,
      setCrop,
      setPeriod,
      analyze,
      cancelAnalysis: () => ctrl.current?.abort(),
      backToPick: () => setStep('pick'),
      backToPreview: () => setStep('preview'),
      confirmPrivacy,
      dismissPrivacy: () => setPrivacyPrompt(false),
      setNotice,
      updateDecisions,
      importNow,
      discardReview,
    }),
    [
      step,
      images,
      active,
      period,
      error,
      notice,
      waitSec,
      privacyPrompt,
      settings,
      review,
      importing,
      openScan,
      close,
      addBlobs,
      removeImage,
      rotate,
      setCrop,
      analyze,
      confirmPrivacy,
      updateDecisions,
      importNow,
      discardReview,
    ],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {/* osobne granice Suspense: ładowanie ekranu weryfikacji nie może ukrywać arkusza skanowania */}
      <Suspense fallback={null}>{mounted && <ScanSheet />}</Suspense>
      <Suspense fallback={null}>{review && step === 'review' && <ReviewScreen />}</Suspense>
    </Ctx.Provider>
  );
}
