import { useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useLocation } from 'wouter';
import { Alert, Button, GroupedList, Screen, useToast } from '../../ui';
import { repos } from '../../db/repos';
import { useSettings } from '../../app/data';
import { todayISO } from '../../domain/dates';
import { plural, SHIFTS } from '../../domain/i18n';
import type { DefaultHours, Settings } from '../../domain/types';
import { HoursEditor, hoursValid } from './HoursEditor';
import styles from './Settings.module.css';

function HoursForm({ settings }: { settings: Settings }) {
  const [, navigate] = useLocation();
  const toast = useToast();
  const [draft, setDraft] = useState<DefaultHours>(settings.defaultHours);
  const [pending, setPending] = useState<{ count: number; hours: DefaultHours } | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);

  const changed = JSON.stringify(draft) !== JSON.stringify(settings.defaultHours);
  const valid = hoursValid(draft);

  const save = async () => {
    if (lock.current || !changed || !valid) return;
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      await repos.settings.update({ defaultHours: draft });
      // Zmiana ustawień nie rusza historii; pytamy tylko o przyszłe zmiany z flagą „domyślne”
      const count = (await repos.shifts.futureUsingDefaults(todayISO())).length;
      if (count > 0) setPending({ count, hours: draft });
      else {
        toast('Zapisano godziny domyślne');
        navigate('/settings');
      }
    } catch {
      setError('Nie udało się zapisać godzin. Spróbuj ponownie.');
    } finally {
      lock.current = false;
      setSaving(false);
    }
  };

  const finish = (updated: number) => {
    toast(updated > 0 ? `Zaktualizowano ${plural(updated, SHIFTS)}` : 'Zapisano godziny domyślne');
    navigate('/settings');
  };

  return (
    <Screen
      title="Godziny domyślne"
      leading={
        <button type="button" className={styles.backBtn} onClick={() => navigate('/settings')}>
          <ChevronLeft size={22} /> Wróć
        </button>
      }
    >
      <GroupedList footer="Te godziny wypełniają się automatycznie przy dodawaniu zmiany. Zmianę końca przed początkiem traktujemy jako kończącą się następnego dnia.">
        <HoursEditor value={draft} onChange={setDraft} weekStartsOn={settings.weekStartsOn} />
      </GroupedList>
      {error && (
        <p role="alert" className={styles.note} style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}
      <div className={styles.formActions}>
        <Button onClick={() => void save()} disabled={!changed || !valid || saving}>
          Zapisz
        </Button>
        <Button
          variant="plain"
          onClick={() => setDraft(structuredClone(settings.defaultHours))}
          disabled={!changed}
        >
          Cofnij zmiany
        </Button>
      </div>

      <Alert
        open={pending !== null}
        title={pending ? `Zaktualizować ${plural(pending.count, SHIFTS)}?` : ''}
        message="Dotyczy przyszłych zmian, które korzystają z godzin domyślnych. Historia zostaje bez zmian."
        onClose={() => setPending(null)}
        actions={[
          { label: 'Nie', onSelect: () => finish(0) },
          {
            label: 'Tak',
            onSelect: () => {
              if (!pending) return;
              repos.shifts
                .applyDefaultHours(todayISO(), pending.hours)
                .then(finish)
                .catch(() => toast('Nie udało się zaktualizować zmian.'));
            },
          },
        ]}
      />
    </Screen>
  );
}

export function HoursScreen() {
  const settings = useSettings();
  return settings ? <HoursForm settings={settings} /> : null;
}
