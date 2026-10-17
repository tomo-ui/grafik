import { useRef, useState } from 'react';
import { listModels, MODEL_SUGGESTIONS, testConnection, type ModelInfo } from '../../ai/gemini';
import { AiError, maskKey } from '../../ai/errors';
import { repos } from '../../db/repos';
import { todayISO } from '../../domain/dates';
import { DAY_NAMES, formatHours, plural, SHIFTS } from '../../domain/i18n';
import { checkTimes, DEFAULT_HOURS } from '../../domain/hours';
import type { DefaultHours, Settings, Weekday } from '../../domain/types';
import { Seg, useConfirm, useToast } from '../ui';

const ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

export function SettingsPage({ settings }: { settings: Settings }) {
  const toast = useToast();
  const confirm = useConfirm();

  /* ---------------------------------------------------------- godziny domyślne */
  const [draftHours, setHours] = useState<DefaultHours | null>(null);
  const hours = draftHours ?? settings.defaultHours;
  const [applyFuture, setApplyFuture] = useState(true);
  const [savingHours, setSavingHours] = useState(false);

  const checks = ORDER.map((d) => ({ d, r: checkTimes(hours[d].start, hours[d].end) }));
  const invalid = checks.some((c) => !c.r.ok);
  const dirty = JSON.stringify(hours) !== JSON.stringify(settings.defaultHours);

  const saveHours = async () => {
    if (invalid || savingHours) return;
    setSavingHours(true);
    try {
      await repos.settings.update({ defaultHours: hours });
      setHours(null);
      if (applyFuture) {
        const n = await repos.shifts.applyDefaultHours(todayISO(), hours);
        toast(
          `Zapisano godziny domyślne${n ? `; zaktualizowano ${plural(n, SHIFTS)} od dziś` : ''}.`,
        );
      } else toast('Zapisano godziny domyślne (istniejące zmiany bez zmian).');
    } catch {
      toast('Nie udało się zapisać godzin.');
    } finally {
      setSavingHours(false);
    }
  };

  /* ------------------------------------------------------------------- Gemini */
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [model, setModel] = useState(settings.geminiModel);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<'test' | 'models' | null>(null);
  const lock = useRef(false);
  const effectiveKey = key.trim() || settings.geminiApiKey || '';

  const run = async (kind: 'test' | 'models') => {
    if (lock.current) return;
    lock.current = true;
    setBusy(kind);
    setResult(null);
    try {
      if (kind === 'models') {
        const list = await listModels(effectiveKey);
        setModels(list);
        setResult({ ok: true, text: `Znaleziono modeli: ${list.length}.` });
      } else {
        const r = await testConnection(effectiveKey, model);
        setModels(r.models);
        setResult({
          ok: true,
          text: r.modelListed
            ? 'Połączenie działa, model jest dostępny.'
            : 'Klucz działa. Wybranego modelu nie ma na liście (aliasy „-latest” mogą się nie pojawiać) — spróbuj skanu.',
        });
      }
    } catch (e) {
      setResult({
        ok: false,
        text: e instanceof AiError ? e.message : 'Nie udało się połączyć z usługą Gemini.',
      });
    } finally {
      lock.current = false;
      setBusy(null);
    }
  };

  const saveKey = async () => {
    const k = key.trim();
    if (!k) return;
    try {
      await repos.settings.update({ geminiApiKey: k });
      setKey('');
      setShow(false);
      toast('Zapisano klucz API (tylko w tej przeglądarce).');
    } catch {
      toast('Nie udało się zapisać klucza.');
    }
  };
  const removeKey = async () => {
    const ok = await confirm({
      title: 'Usunąć klucz API?',
      message: 'Skanowanie ze zdjęć przestanie działać, dopóki nie wpiszesz nowego klucza.',
      confirmLabel: 'Usuń klucz',
      danger: true,
    });
    if (!ok) return;
    await repos.settings.update({ geminiApiKey: undefined });
    toast('Usunięto klucz API.');
  };
  const saveModel = async (m: string) => {
    const v = m.trim();
    if (v && v !== settings.geminiModel)
      await repos.settings
        .update({ geminiModel: v })
        .catch(() => toast('Nie udało się zapisać modelu.'));
  };

  return (
    <>
      <div className="pc-head">
        <h1>Ustawienia</h1>
      </div>
      <div className="pc-page" style={{ maxWidth: 980 }}>
        <section className="card" style={{ marginTop: 0 }} aria-label="Wygląd i tydzień">
          <h2>Wygląd i kalendarz</h2>
          <div className="row" style={{ gap: 28 }}>
            <div className="field">
              <span>Motyw</span>
              <Seg
                label="Motyw"
                value={settings.theme}
                onChange={(theme) => void repos.settings.update({ theme })}
                options={[
                  { value: 'system', label: 'Systemowy' },
                  { value: 'light', label: 'Jasny' },
                  { value: 'dark', label: 'Ciemny' },
                ]}
              />
            </div>
            <div className="field">
              <span>Tydzień zaczyna się od</span>
              <Seg
                label="Pierwszy dzień tygodnia"
                value={String(settings.weekStartsOn) as '0' | '1'}
                onChange={(v) => void repos.settings.update({ weekStartsOn: Number(v) as 0 | 1 })}
                options={[
                  { value: '1', label: 'Poniedziałku' },
                  { value: '0', label: 'Niedzieli' },
                ]}
              />
            </div>
          </div>
        </section>

        <section className="card" aria-label="Godziny domyślne">
          <h2>Godziny domyślne zmian</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Używane przy dodawaniu zmiany „z godzinami domyślnymi” (klawisz{' '}
            <span className="kbd">x</span> w siatce). Koniec wcześniejszy niż początek oznacza
            następny dzień.
          </p>
          <table
            className="table"
            aria-label="Godziny domyślne wg dnia tygodnia"
            style={{ maxWidth: 560 }}
          >
            <thead>
              <tr>
                <th>Dzień</th>
                <th>Początek</th>
                <th>Koniec</th>
                <th className="num">Długość</th>
              </tr>
            </thead>
            <tbody>
              {checks.map(({ d, r }) => (
                <tr key={d}>
                  <td>{DAY_NAMES[d]}</td>
                  {(['start', 'end'] as const).map((f) => (
                    <td key={f}>
                      <input
                        className={`input${r.ok ? '' : ' invalid'}`}
                        style={{ width: 90 }}
                        inputMode="numeric"
                        aria-label={`${f === 'start' ? 'Początek' : 'Koniec'}: ${DAY_NAMES[d]}`}
                        value={hours[d][f]}
                        onChange={(e) =>
                          setHours({
                            ...hours,
                            [d]: { ...hours[d], [f]: e.target.value.trim().slice(0, 5) },
                          })
                        }
                      />
                    </td>
                  ))}
                  <td className="num">
                    {r.ok ? formatHours(r.minutes) : <span className="badge danger">błąd</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 12 }}>
            <label className="row">
              <input
                type="checkbox"
                checked={applyFuture}
                onChange={(e) => setApplyFuture(e.target.checked)}
              />
              Zaktualizuj też przyszłe zmiany z godzinami domyślnymi (od dziś; historia bez zmian)
            </label>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="btn primary"
              disabled={!dirty || invalid || savingHours}
              onClick={() => void saveHours()}
            >
              Zapisz godziny
            </button>
            <button
              type="button"
              className="btn"
              disabled={JSON.stringify(hours) === JSON.stringify(DEFAULT_HOURS)}
              onClick={() => setHours(structuredClone(DEFAULT_HOURS))}
            >
              Przywróć fabryczne (10–22, Pt/Sb 10–23)
            </button>
            {dirty && (
              <button type="button" className="btn ghost" onClick={() => setHours(null)}>
                Cofnij zmiany
              </button>
            )}
          </div>
        </section>

        <section className="card" aria-label="Skanowanie AI">
          <h2>Skanowanie AI (Gemini)</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Klucz zapisuje się wyłącznie lokalnie w tej przeglądarce, trafia tylko do{' '}
            <b>generativelanguage.googleapis.com</b> i nie jest częścią kopii zapasowej. Stan:{' '}
            <b>
              {settings.geminiApiKey
                ? `zapisany (${maskKey(settings.geminiApiKey)})`
                : 'brak klucza'}
            </b>
            .
          </p>
          <div className="row">
            <label className="field grow" style={{ maxWidth: 460 }}>
              <span>{settings.geminiApiKey ? 'Zastąp klucz API' : 'Klucz API'}</span>
              <input
                className="input"
                type={show ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                aria-label="Klucz API Gemini"
                placeholder="AIza…"
              />
            </label>
            <label className="row" style={{ alignSelf: 'flex-end', paddingBottom: 6 }}>
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
              pokaż
            </label>
            <button
              type="button"
              className="btn primary"
              style={{ alignSelf: 'flex-end' }}
              disabled={!key.trim()}
              onClick={() => void saveKey()}
            >
              Zapisz klucz
            </button>
            {settings.geminiApiKey && (
              <button
                type="button"
                className="btn danger"
                style={{ alignSelf: 'flex-end' }}
                onClick={() => void removeKey()}
              >
                Usuń klucz
              </button>
            )}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <label className="field" style={{ minWidth: 300 }}>
              <span>Model</span>
              <input
                className="input"
                list="pc-models"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                onBlur={() => void saveModel(model)}
                aria-label="Model Gemini"
              />
              <datalist id="pc-models">
                {[...MODEL_SUGGESTIONS, ...models.map((m) => m.id)].map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            <button
              type="button"
              className="btn"
              style={{ alignSelf: 'flex-end' }}
              disabled={!effectiveKey || busy !== null}
              onClick={() => void run('test')}
            >
              {busy === 'test' ? 'Testuję…' : 'Testuj połączenie'}
            </button>
            <button
              type="button"
              className="btn"
              style={{ alignSelf: 'flex-end' }}
              disabled={!effectiveKey || busy !== null}
              onClick={() => void run('models')}
            >
              {busy === 'models' ? 'Pobieram…' : 'Pobierz listę modeli'}
            </button>
          </div>
          {result && (
            <div
              className={`alert ${result.ok ? 'ok' : 'danger'}`}
              role="status"
              style={{ marginTop: 10 }}
            >
              {result.text}
            </div>
          )}
          <label className="row" style={{ marginTop: 12 }}>
            <input
              type="checkbox"
              checked={settings.aiPrivacyAcknowledged}
              onChange={(e) =>
                void repos.settings.update({ aiPrivacyAcknowledged: e.target.checked })
              }
            />
            Rozumiem, że na darmowym planie Google może używać przesłanych zdjęć do ulepszania
            modeli (pomija pytanie przed skanem)
          </label>
        </section>

        <section className="card" aria-label="Skróty klawiszowe">
          <h2>Skróty klawiszowe</h2>
          <table className="table" aria-label="Lista skrótów" style={{ maxWidth: 720 }}>
            <tbody>
              {(
                [
                  ['Ctrl+K', 'Paleta poleceń (przejścia, osoby, motyw)'],
                  ['Alt+1 … Alt+7', 'Przejście między zakładkami'],
                  ['Strzałki, Tab, Home/End', 'Poruszanie po siatce (Ctrl+strzałka — na skraj)'],
                  [
                    'Shift+strzałki, kliknięcie z Shift, przeciągnięcie',
                    'Zaznaczanie zakresu; kliknięcie osoby/dnia zaznacza wiersz/kolumnę',
                  ],
                  ['Ctrl+A', 'Zaznacz całą siatkę'],
                  [
                    'Wpisz 10-22 / x / w / u / l4 / i + Enter',
                    'Ustaw zawartość zaznaczonych komórek (x = godziny domyślne)',
                  ],
                  ['Enter lub F2, podwójne kliknięcie', 'Edytuj komórkę'],
                  ['Delete lub Backspace', 'Wyczyść zaznaczone komórki'],
                  [
                    'Ctrl+C / Ctrl+X / Ctrl+V',
                    'Kopiuj, wytnij, wklej (także z i do Excela jako tekst)',
                  ],
                  [
                    'Ctrl+D / Ctrl+R',
                    'Wypełnij w dół / w prawo wartością z pierwszego wiersza/kolumny',
                  ],
                  ['Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y)', 'Cofnij / ponów'],
                  ['PageUp / PageDown', 'Poprzedni / następny okres'],
                  ['Prawy przycisk myszy', 'Menu kontekstowe komórek'],
                ] as [string, string][]
              ).map(([k, d]) => (
                <tr key={k}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span className="kbd">{k}</span>
                  </td>
                  <td>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card" aria-label="O aplikacji">
          <h2>O aplikacji</h2>
          <p className="muted" style={{ margin: 0 }}>
            Grafik — konsola na komputer · wersja {__APP_VERSION__} · dane lokalne w przeglądarce
            (bez konta i serwera).
          </p>
        </section>
      </div>
    </>
  );
}
