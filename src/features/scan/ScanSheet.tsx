import { useRef, useState } from 'react';
import {
  Camera,
  ClipboardPaste,
  Crop as CropIcon,
  ImagePlus,
  Images,
  Plus,
  RotateCw,
  Settings as SettingsIcon,
  X,
} from 'lucide-react';
import { useLocation } from 'wouter';
import { Alert, Button, GroupedList, ListRow, Sheet, runWhenSettled } from '../../ui';
import { useOnline } from '../../app/useOnline';
import { detectPlatform } from '../../app/install';
import { MAX_IMAGES } from '../../ai/image';
import { PRIVACY_TEXT } from '../settings/AiSettings';
import { CropEditor } from './CropEditor';
import { CLIPBOARD_MESSAGES, imageFromClipboardData, readClipboardImage } from './clipboard';
import { useScan } from './ScanProvider';
import styles from './Scan.module.css';

const MONTHS = [
  'styczeń',
  'luty',
  'marzec',
  'kwiecień',
  'maj',
  'czerwiec',
  'lipiec',
  'sierpień',
  'wrzesień',
  'październik',
  'listopad',
  'grudzień',
];

/** Sheet „Skanuj grafik”: źródła zdjęcia, podgląd (obrót, kadr, strony), okres, analiza (8.6). */
export function ScanSheet() {
  const s = useScan();
  const open = s.step === 'pick' || s.step === 'preview' || s.step === 'running';
  const [, navigate] = useLocation();
  const online = useOnline();
  const [cropping, setCropping] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const ios = detectPlatform() === 'ios';

  const noKey = !s.settings.geminiApiKey;
  const img = s.images[s.active];
  const year = new Date().getFullYear();

  const files = (list: FileList | null) => {
    if (list && list.length) void s.addBlobs(Array.from(list), 'library');
  };

  const pasteFromButton = async () => {
    // P-01: bez żadnego `await` przed read() — to jest pierwsza operacja w handlerze kliknięcia
    const r = await readClipboardImage();
    s.setNotice('');
    if (r.status === 'image') await s.addBlobs([r.blob], 'clipboard');
    else if (r.status === 'no-image') s.setNotice(CLIPBOARD_MESSAGES.noImage);
    else if (r.status === 'denied') s.setNotice(CLIPBOARD_MESSAGES.denied);
    else if (r.status === 'unsupported') {
      s.setNotice('Ta przeglądarka nie pozwala na odczyt schowka przyciskiem — użyj pola poniżej.');
    }
    // 'dismissed' (iOS: zignorowany dymek „Wklej”) — celowo bez komunikatu
  };

  return (
    <>
      <Sheet open={open} onClose={s.close} title="Skanuj grafik" detent="large">
        {s.step === 'running' ? (
          <div className={styles.running} role="status" aria-live="polite">
            <div className={styles.scanThumb}>
              {img && <img src={img.url} alt="" />}
              <span className={styles.scanLine} aria-hidden="true" />
            </div>
            <p className={styles.runningTitle}>Analizuję zdjęcie…</p>
            {s.waitSec ? (
              <p className={styles.runningNote}>Limit darmowego API — ponawiam za {s.waitSec} s</p>
            ) : (
              <p className={styles.runningNote}>To zwykle trwa kilkanaście sekund.</p>
            )}
            <Button variant="tinted" onClick={s.cancelAnalysis}>
              Anuluj
            </Button>
          </div>
        ) : (
          <>
            {!online && (
              <p role="status" className={styles.banner}>
                Brak połączenia — zdjęcie możesz przygotować, ale analiza wymaga internetu.
              </p>
            )}
            {s.error && (
              <div role="alert" className={`${styles.banner} ${styles.bannerError}`}>
                <span>{s.error.message}</span>
                {s.error.goToSettings && (
                  <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={() => {
                      s.close();
                      runWhenSettled(() => navigate('/settings/ai'));
                    }}
                  >
                    Otwórz ustawienia
                  </button>
                )}
              </div>
            )}
            {s.notice && (
              <p role="status" className={styles.banner}>
                {s.notice}
              </p>
            )}

            {noKey && (
              <GroupedList
                header="Skonfiguruj skanowanie AI"
                footer="Skanowanie używa darmowego Google Gemini. Klucz zostaje tylko na tym urządzeniu."
              >
                <ListRow title="1. Wejdź na aistudio.google.com i zaloguj się kontem Google" />
                <ListRow title="2. Wybierz „API keys” → „Create API key”" />
                <ListRow title="3. Wklej klucz w Ustawieniach → Skanowanie AI" last />
                <div className={styles.cfgBtn}>
                  <Button
                    onClick={() => {
                      s.close();
                      runWhenSettled(() => navigate('/settings/ai'));
                    }}
                  >
                    <SettingsIcon size={18} /> Przejdź do ustawień
                  </Button>
                </div>
              </GroupedList>
            )}

            {s.step === 'pick' || !img ? (
              <>
                {img && (
                  <div className={styles.banner}>
                    <span>
                      Dodajesz kolejną stronę ({s.images.length} z {MAX_IMAGES}).
                    </span>
                    <button type="button" className={styles.linkBtn} onClick={s.backToPreview}>
                      Wróć do podglądu
                    </button>
                  </div>
                )}
                <div className={styles.sources}>
                  <input
                    ref={camera}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    data-testid="input-camera"
                    onChange={(e) => {
                      files(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <input
                    ref={library}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    data-testid="input-library"
                    onChange={(e) => {
                      files(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    className={styles.source}
                    onClick={() => camera.current?.click()}
                  >
                    <Camera size={28} strokeWidth={1.75} />
                    <span>Zrób zdjęcie</span>
                  </button>
                  <button
                    type="button"
                    className={styles.source}
                    onClick={() => library.current?.click()}
                  >
                    <Images size={28} strokeWidth={1.75} />
                    <span>Wybierz z biblioteki</span>
                  </button>
                  <button
                    type="button"
                    className={styles.source}
                    onClick={() => void pasteFromButton()}
                  >
                    <ClipboardPaste size={28} strokeWidth={1.75} />
                    <span>Wklej ze schowka</span>
                  </button>
                </div>
                {ios && <p className={styles.hint}>{CLIPBOARD_MESSAGES.iosHint}</p>}

                <div
                  className={`${styles.pasteZone} ${dragOver ? styles.pasteZoneOver : ''}`}
                  data-paste-zone
                  data-testid="paste-zone"
                  contentEditable
                  suppressContentEditableWarning
                  inputMode="none"
                  role="textbox"
                  aria-label="Przytrzymaj tutaj i wybierz Wklej"
                  spellCheck={false}
                  onBeforeInput={(e) => {
                    // żadnego wpisywania tekstu — tylko wklejanie obrazka
                    const t = (e.nativeEvent as InputEvent).inputType;
                    if (t !== 'insertFromPaste') e.preventDefault();
                  }}
                  onPaste={(e) => {
                    e.preventDefault();
                    const blob = imageFromClipboardData(e.clipboardData);
                    (e.currentTarget as HTMLElement).textContent = '';
                    if (blob) void s.addBlobs([blob], 'paste');
                    else s.setNotice(CLIPBOARD_MESSAGES.noImage);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    files(e.dataTransfer.files);
                  }}
                >
                  {''}
                </div>
                <p className={styles.pasteLabel} aria-hidden="true">
                  Przytrzymaj tutaj i wybierz Wklej
                  <br />
                  <small>albo przeciągnij zdjęcie (komputer)</small>
                </p>
              </>
            ) : (
              <>
                <div className={styles.thumbs} role="tablist" aria-label="Strony grafiku">
                  {s.images.map((im, i) => (
                    <div key={im.id} className={styles.thumbWrap}>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={i === s.active}
                        aria-label={`Strona ${i + 1}`}
                        className={`${styles.thumb} ${i === s.active ? styles.thumbOn : ''}`}
                        onClick={() => {
                          s.setActive(i);
                          setCropping(false);
                        }}
                      >
                        <img src={im.url} alt="" />
                      </button>
                      <button
                        type="button"
                        className={styles.thumbX}
                        aria-label={`Usuń stronę ${i + 1}`}
                        onClick={() => s.removeImage(im.id)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  {s.images.length < MAX_IMAGES && (
                    <button
                      type="button"
                      className={styles.addPage}
                      aria-label="Dodaj kolejną stronę"
                      onClick={s.backToPick}
                    >
                      <Plus size={22} />
                    </button>
                  )}
                </div>

                <CropEditor image={img} cropping={cropping} onCrop={(c) => s.setCrop(img.id, c)} />
                {img.small && (
                  <p role="status" className={styles.banner}>
                    Zdjęcie może być nieczytelne (jest bardzo małe).
                  </p>
                )}
                <div className={styles.tools}>
                  <button type="button" className={styles.tool} onClick={() => s.rotate(img.id)}>
                    <RotateCw size={20} /> Obróć
                  </button>
                  <button
                    type="button"
                    className={`${styles.tool} ${cropping ? styles.toolOn : ''}`}
                    aria-pressed={cropping}
                    onClick={() => setCropping((c) => !c)}
                  >
                    <CropIcon size={20} /> Kadruj
                  </button>
                  {img.crop && (
                    <button
                      type="button"
                      className={styles.tool}
                      onClick={() => s.setCrop(img.id, null)}
                    >
                      Resetuj kadr
                    </button>
                  )}
                  {s.images.length < MAX_IMAGES && (
                    <button type="button" className={styles.tool} onClick={s.backToPick}>
                      <ImagePlus size={20} /> Dodaj kolejną stronę
                    </button>
                  )}
                </div>

                <GroupedList
                  header="Okres (opcjonalnie)"
                  footer="Gdy miesiąc nie jest widoczny na zdjęciu, AI użyje tego okresu."
                >
                  <div className={styles.periodRow}>
                    <select
                      aria-label="Miesiąc"
                      value={s.period?.month ?? 0}
                      onChange={(e) => {
                        const m = Number(e.target.value);
                        s.setPeriod(m ? { month: m, year: s.period?.year ?? year } : null);
                      }}
                    >
                      <option value={0}>Automatycznie</option>
                      {MONTHS.map((m, i) => (
                        <option key={m} value={i + 1}>
                          {m}
                        </option>
                      ))}
                    </select>
                    {s.period && (
                      <select
                        aria-label="Rok"
                        value={s.period.year}
                        onChange={(e) =>
                          s.setPeriod({ month: s.period!.month, year: Number(e.target.value) })
                        }
                      >
                        {[year - 1, year, year + 1].map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </GroupedList>

                <div className={styles.analyze}>
                  <Button onClick={() => void s.analyze()} disabled={noKey || !online}>
                    {s.error ? 'Ponów analizę' : 'Analizuj'}
                  </Button>
                  {!online && <p className={styles.hint}>Brak połączenia</p>}
                </div>
              </>
            )}
          </>
        )}
      </Sheet>

      <Alert
        open={s.privacyPrompt}
        title="Prywatność darmowego API"
        message={PRIVACY_TEXT}
        onClose={s.dismissPrivacy}
        actions={[
          { label: 'Anuluj', onSelect: () => {} },
          { label: 'Rozumiem, kontynuuj', onSelect: () => void s.confirmPrivacy() },
        ]}
      />
    </>
  );
}
