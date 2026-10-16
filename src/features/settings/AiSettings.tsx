import { useRef, useState } from 'react';
import { ChevronLeft, Eye, EyeOff } from 'lucide-react';
import { useLocation } from 'wouter';
import { Alert, Button, GroupedList, ListRow, Screen, Spinner, useToast } from '../../ui';
import { repos } from '../../db/repos';
import { useSettings } from '../../app/data';
import { AiError, maskKey } from '../../ai/errors';
import { listModels, MODEL_SUGGESTIONS, testConnection, type ModelInfo } from '../../ai/gemini';
import type { Settings } from '../../domain/types';
import styles from './Settings.module.css';

export const PRIVACY_TEXT =
  'Na darmowym planie Google może wykorzystywać przesłane zdjęcia (z imionami współpracowników) do ulepszania modeli. Wysyłaj tylko zdjęcia, które możesz udostępnić.';

/** Ustawienia → Skanowanie AI: klucz (lokalnie), model, test połączenia, informacja o prywatności. */
function AiForm({ settings }: { settings: Settings }) {
  const [, navigate] = useLocation();
  const toast = useToast();
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [model, setModel] = useState(settings.geminiModel);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [busy, setBusy] = useState<'test' | 'models' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const lock = useRef(false);

  const saved = settings.geminiApiKey;
  const effectiveKey = key.trim() || saved || '';

  const saveKey = async () => {
    const k = key.trim();
    if (!k) return;
    try {
      await repos.settings.update({ geminiApiKey: k });
      setKey('');
      setShow(false);
      toast('Zapisano klucz API');
    } catch {
      toast('Nie udało się zapisać klucza.');
    }
  };

  const saveModel = async (m: string) => {
    const v = m.trim();
    if (!v || v === settings.geminiModel) return;
    try {
      await repos.settings.update({ geminiModel: v });
    } catch {
      toast('Nie udało się zapisać modelu.');
    }
  };

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
        const t = await testConnection(effectiveKey, model);
        setModels(t.models);
        setResult({
          ok: true,
          text: t.modelListed
            ? 'Połączenie działa, model jest dostępny.'
            : 'Połączenie działa. Wybranego modelu nie ma na liście (aliasy „-latest” często się na niej nie pojawiają) — sprawdzimy go przy pierwszym skanie.',
        });
      }
    } catch (e) {
      setResult({ ok: false, text: e instanceof AiError ? e.message : 'Nie udało się połączyć.' });
    } finally {
      lock.current = false;
      setBusy(null);
    }
  };

  return (
    <Screen
      title="Skanowanie AI"
      leading={
        <button type="button" className={styles.backBtn} onClick={() => navigate('/settings')}>
          <ChevronLeft size={22} /> Wróć
        </button>
      }
    >
      <GroupedList
        header="Klucz API Gemini"
        footer="Klucz zapisujemy tylko na tym urządzeniu i wysyłamy wyłącznie do Google. Nie trafia do kopii zapasowej. Klucz możesz wygenerować za darmo w Google AI Studio (aistudio.google.com → API keys)."
      >
        <ListRow title="Stan" value={saved ? `Zapisany (${maskKey(saved)})` : 'Brak klucza'} />
        <label className={styles.keyRow}>
          <span className="sr-only">Klucz API</span>
          <input
            type={show ? 'text' : 'password'}
            value={key}
            placeholder={saved ? 'Wklej nowy klucz, aby zastąpić' : 'Wklej klucz API'}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Klucz API"
            onChange={(e) => setKey(e.target.value)}
          />
          <button
            type="button"
            className={styles.eye}
            aria-label={show ? 'Ukryj klucz' : 'Pokaż klucz'}
            onClick={() => setShow((v) => !v)}
          >
            {show ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        </label>
      </GroupedList>
      <div className={styles.formActions}>
        <Button onClick={() => void saveKey()} disabled={!key.trim()}>
          Zapisz klucz
        </Button>
        {saved && (
          <Button variant="tinted" destructive onClick={() => setConfirmRemove(true)}>
            Usuń klucz
          </Button>
        )}
      </div>

      <GroupedList
        header="Model"
        footer="Domyślnie alias „gemini-flash-latest”, który sam przechodzi na nowszą wersję Flash. Możesz wpisać inny model lub pobrać listę dostępnych."
      >
        <label className={styles.keyRow}>
          <span className="sr-only">Model</span>
          <input
            type="text"
            list="gemini-models"
            value={model}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Model"
            onChange={(e) => setModel(e.target.value)}
            onBlur={() => void saveModel(model)}
          />
          <datalist id="gemini-models">
            {[...new Set([...MODEL_SUGGESTIONS, ...models.map((m) => m.id)])].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
      </GroupedList>
      <div className={styles.formActions}>
        <Button
          variant="tinted"
          onClick={() => void run('models')}
          disabled={!effectiveKey || busy !== null}
        >
          {busy === 'models' ? <Spinner size={18} /> : null} Pobierz listę modeli
        </Button>
        <Button onClick={() => void run('test')} disabled={!effectiveKey || busy !== null}>
          {busy === 'test' ? <Spinner size={18} /> : null} Testuj połączenie
        </Button>
        {result && (
          <p
            role={result.ok ? 'status' : 'alert'}
            className={styles.note}
            style={{ color: result.ok ? 'var(--green)' : 'var(--red)', padding: 0 }}
          >
            {result.text}
          </p>
        )}
      </div>

      <GroupedList header="Prywatność" footer={PRIVACY_TEXT}>
        <ListRow
          title="Informacja przy pierwszym skanie"
          value={settings.aiPrivacyAcknowledged ? 'Potwierdzona' : 'Jeszcze nie'}
          last
        />
      </GroupedList>

      <Alert
        open={confirmRemove}
        title="Usunąć klucz API?"
        message="Skanowanie przestanie działać, dopóki nie wkleisz nowego klucza."
        onClose={() => setConfirmRemove(false)}
        actions={[
          { label: 'Anuluj', onSelect: () => {} },
          {
            label: 'Usuń',
            destructive: true,
            onSelect: () => {
              void repos.settings
                .update({ geminiApiKey: undefined })
                .then(() => toast('Usunięto klucz'));
            },
          },
        ]}
      />
    </Screen>
  );
}

export function AiSettings() {
  const settings = useSettings();
  return settings ? <AiForm settings={settings} /> : null;
}
