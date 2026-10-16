import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  GroupedList,
  ListRow,
  SegmentedControl,
  Sheet,
  TextRow,
  Toggle,
  useToast,
} from '../../ui';
import { repos } from '../../db/repos';
import { checkTimes } from '../../domain/hours';
import { formatDayLong } from '../../domain/i18n';
import { describeDefaults } from '../../domain/shiftForm';
import { defaultHoursFor } from '../../domain/hours';
import { fullName } from '../../domain/people';
import type { Person, Settings, Shift, ShiftKind } from '../../domain/types';
import { TimeField } from '../settings/HoursEditor';
import styles from './ShiftEditor.module.css';

const KIND_OPTIONS: { value: ShiftKind; label: string }[] = [
  { value: 'work', label: 'Praca' },
  { value: 'off', label: 'Wolne' },
  { value: 'vacation', label: 'Urlop' },
  { value: 'sick', label: 'L4' },
];

/** Sheet edycji pojedynczej zmiany (osoba i dzień są stałe). Montowany od nowa przy każdym otwarciu. */
export function EditShiftSheet({
  open,
  shift,
  person,
  settings,
  onClose,
}: {
  open: boolean;
  shift: Shift;
  person?: Person;
  settings: Settings;
  onClose: () => void;
}) {
  const toast = useToast();
  const dflt = defaultHoursFor(shift.date, settings.defaultHours);
  const [kind, setKind] = useState<ShiftKind>(shift.kind);
  const [useDefault, setUseDefault] = useState(
    shift.kind === 'work' ? shift.usesDefaultHours : true,
  );
  const [start, setStart] = useState(shift.start ?? dflt.start);
  const [end, setEnd] = useState(shift.end ?? dflt.end);
  const [note, setNote] = useState(shift.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const lock = useRef(false);

  const times =
    kind === 'work'
      ? useDefault
        ? checkTimes(dflt.start, dflt.end)
        : checkTimes(start, end)
      : null;
  const valid = times === null || times.ok;

  const save = async () => {
    if (lock.current || !valid) return;
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      const work = kind === 'work';
      await repos.shifts.update(shift.id, {
        kind,
        start: work ? (useDefault ? dflt.start : start) : undefined,
        end: work ? (useDefault ? dflt.end : end) : undefined,
        usesDefaultHours: work ? useDefault : false,
        note: note.trim() || undefined,
      });
      onClose();
    } catch {
      setError('Nie udało się zapisać zmiany. Spróbuj ponownie.');
    } finally {
      lock.current = false;
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await repos.shifts.softDelete([shift.id]);
      onClose();
      toast('Usunięto zmianę', () => {
        repos.shifts.restore([shift.id]).catch(() => toast('Nie udało się cofnąć usunięcia.'));
      });
    } catch {
      setError('Nie udało się usunąć zmiany.');
    }
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} title="Edytuj zmianę" detent="large">
        <GroupedList>
          <ListRow title="Osoba" value={person ? fullName(person) : '—'} />
          <ListRow title="Dzień" value={formatDayLong(shift.date)} last />
        </GroupedList>

        <GroupedList header="Typ">
          <ListRow
            title="Typ"
            trailing={
              <SegmentedControl
                label="Typ wpisu"
                value={kind}
                onChange={setKind}
                options={KIND_OPTIONS}
              />
            }
            last
          />
        </GroupedList>

        {kind === 'work' && (
          <GroupedList
            header="Godziny"
            footer={useDefault ? describeDefaults(settings.defaultHours) : undefined}
          >
            <ListRow
              title="Domyślne wg dnia"
              subtitle={useDefault ? `${dflt.start}–${dflt.end}` : undefined}
              trailing={
                <Toggle label="Domyślne wg dnia" checked={useDefault} onChange={setUseDefault} />
              }
              last={useDefault}
            />
            {!useDefault && (
              <ListRow
                title="Od – do"
                trailing={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <TimeField label="Początek zmiany" value={start} onChange={setStart} />–
                    <TimeField label="Koniec zmiany" value={end} onChange={setEnd} />
                  </span>
                }
                last
              />
            )}
          </GroupedList>
        )}

        <GroupedList>
          <TextRow
            label="Notatka"
            value={note}
            onChange={setNote}
            placeholder="Opcjonalnie"
            autoCapitalize="sentences"
          />
        </GroupedList>

        {times && !times.ok && (
          <p role="alert" className={styles.err}>
            {times.error}
          </p>
        )}
        {times && times.ok && times.crossesMidnight && (
          <p role="status" className={styles.warn}>
            Zmiana kończy się następnego dnia (+1 dzień). Upewnij się, że to nie pomyłka.
          </p>
        )}
        {error && (
          <p role="alert" className={styles.err}>
            {error}
          </p>
        )}

        <div className={styles.sectionPad} style={{ display: 'grid', gap: 8 }}>
          <Button onClick={() => void save()} disabled={!valid || saving}>
            Zapisz
          </Button>
          <Button variant="tinted" destructive onClick={() => setConfirm(true)}>
            Usuń zmianę
          </Button>
        </div>
      </Sheet>

      <Alert
        open={confirm}
        title="Usunąć zmianę?"
        message="Możesz ją przywrócić przyciskiem Cofnij tuż po usunięciu."
        onClose={() => setConfirm(false)}
        actions={[
          { label: 'Anuluj', onSelect: () => {} },
          { label: 'Usuń', destructive: true, onSelect: () => void remove() },
        ]}
      />
    </>
  );
}
