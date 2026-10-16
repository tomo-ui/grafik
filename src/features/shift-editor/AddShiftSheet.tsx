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
import { uuid } from '../../db/db';
import { findConflicts } from '../../domain/conflicts';
import { addDays, todayISO } from '../../domain/dates';
import { colorVar, displayNames } from '../../domain/people';
import { KOLIZJE, plural, SHIFTS } from '../../domain/i18n';
import {
  buildShifts,
  describeDefaults,
  quickDates,
  repeatWeekly,
  validateForm,
  type QuickPick,
  type ShiftFormInput,
} from '../../domain/shiftForm';
import type { ISODate, Person, Settings, Shift, ShiftKind } from '../../domain/types';
import { TimeField } from '../settings/HoursEditor';
import { clearDraft, loadDraft, useDraftOnHide } from './draft';
import { MultiDateCalendar } from './MultiDateCalendar';
import styles from './ShiftEditor.module.css';

const DRAFT_KEY = 'grafik:draft:add-shift';
const LAST_KEY = 'grafik:last-persons';

export interface AddPrefill {
  personIds?: string[];
  dates?: ISODate[];
  /** „Duplikuj na…”: typ, godziny i notatka kopiowane z istniejącej zmiany */
  template?: Pick<Shift, 'kind' | 'start' | 'end' | 'usesDefaultHours' | 'note'>;
}

const KIND_OPTIONS: { value: ShiftKind; label: string }[] = [
  { value: 'work', label: 'Praca' },
  { value: 'off', label: 'Wolne' },
  { value: 'vacation', label: 'Urlop' },
  { value: 'sick', label: 'L4' },
];

function lastUsedPersons(valid: Set<string>): string[] {
  try {
    const ids = JSON.parse(localStorage.getItem(LAST_KEY) ?? '[]') as string[];
    return ids.filter((id) => valid.has(id));
  } catch {
    return [];
  }
}

function initialForm(persons: Person[], prefill?: AddPrefill): ShiftFormInput {
  const valid = new Set(persons.map((p) => p.id));
  const draft = prefill ? null : loadDraft<ShiftFormInput>(DRAFT_KEY);
  if (draft) return { ...draft, personIds: draft.personIds.filter((id) => valid.has(id)) };
  const last = lastUsedPersons(valid);
  const me = persons.find((p) => p.isMe)?.id;
  const t = prefill?.template;
  return {
    personIds: prefill?.personIds ?? (last.length ? last : me ? [me] : []),
    dates: prefill?.dates ?? [],
    kind: t?.kind ?? 'work',
    useDefault: t ? t.kind !== 'work' || t.usesDefaultHours : true,
    start: t?.start ?? '10:00',
    end: t?.end ?? '22:00',
    note: t?.note ?? '',
  };
}

/** Sheet dodawania: osoby × dni, typ, godziny, notatka (8.5). Montowany od nowa przy każdym otwarciu. */
export function AddShiftSheet({
  open,
  persons,
  settings,
  prefill,
  onClose,
}: {
  open: boolean;
  persons: Person[];
  settings: Settings;
  prefill?: AddPrefill;
  onClose: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<ShiftFormInput>(() => initialForm(persons, prefill));
  const [repeatUntil, setRepeatUntil] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<{ shifts: Shift[]; count: number } | null>(null);
  const lock = useRef(false);
  const names = displayNames(persons);

  useDraftOnHide(DRAFT_KEY, form, open);

  const set = <K extends keyof ShiftFormInput>(k: K, v: ShiftFormInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const check = validateForm(form);
  const today = todayISO();
  const anchor = form.dates[form.dates.length - 1] ?? today;

  const quick = (pick: QuickPick) =>
    set(
      'dates',
      [...new Set([...form.dates, ...quickDates(pick, anchor, settings.weekStartsOn)])].sort(),
    );

  const close = (discard: boolean) => {
    if (discard) clearDraft(DRAFT_KEY);
    onClose();
  };

  const commit = async (shifts: Shift[], policy: 'error' | 'replace' | 'skip') => {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      const r = await repos.shifts.addMany(shifts, policy);
      try {
        localStorage.setItem(LAST_KEY, JSON.stringify(form.personIds));
      } catch {
        /* opcjonalne */
      }
      clearDraft(DRAFT_KEY);
      const skipped = r.skipped.length ? `, pominięto ${r.skipped.length}` : '';
      if (r.added.length === 0) {
        toast('Nic nie dodano — wszystkie dni były już zajęte');
      } else {
        toast(`Dodano ${plural(r.added.length, SHIFTS)}${skipped}`, () => {
          repos.shifts.undoAdd(r.added, r.replaced).catch(() => toast('Nie udało się cofnąć.'));
        });
      }
      onClose();
    } catch {
      setError('Nie udało się zapisać zmian. Spróbuj ponownie.');
    } finally {
      lock.current = false;
      setSaving(false);
    }
  };

  const save = async () => {
    if (lock.current || !check.ok) return;
    setError('');
    try {
      const shifts = buildShifts(form, settings.defaultHours, uuid, Date.now());
      const dates = shifts.map((s) => s.date).sort();
      const existing = await repos.shifts.range(dates[0]!, dates[dates.length - 1]!);
      const conflicts = findConflicts(existing, shifts);
      if (conflicts.length > 0) setConflict({ shifts, count: conflicts.length });
      else await commit(shifts, 'error');
    } catch {
      setError('Nie udało się sprawdzić kolizji. Spróbuj ponownie.');
    }
  };

  return (
    <>
      <Sheet open={open} onClose={() => close(true)} title="Dodaj zmianę" detent="large">
        <div className={styles.headRow}>
          <h2>Osoby</h2>
        </div>
        <div className={styles.sectionPad}>
          <div className={styles.chips} style={{ borderRadius: 'var(--radius-group)' }}>
            {persons.length === 0 && (
              <span className={styles.previewNote}>Najpierw dodaj osoby w Ustawieniach.</span>
            )}
            {persons.map((p) => {
              const on = form.personIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  className={`${styles.personChip} ${on ? styles.personChipOn : ''}`}
                  onClick={() =>
                    set(
                      'personIds',
                      on ? form.personIds.filter((x) => x !== p.id) : [...form.personIds, p.id],
                    )
                  }
                >
                  <span className={styles.dot} style={{ background: colorVar(p.color) }} />
                  {names.get(p.id)}
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.headRow}>
          <h2>Dni · {form.dates.length}</h2>
          {form.dates.length > 0 && (
            <button type="button" onClick={() => set('dates', [])}>
              Wyczyść
            </button>
          )}
        </div>
        <div className={styles.quick} role="group" aria-label="Szybkie zaznaczenia dni">
          <button type="button" className={styles.quickBtn} onClick={() => quick('week')}>
            Cały tydzień
          </button>
          <button type="button" className={styles.quickBtn} onClick={() => quick('workdays')}>
            Pn–Pt
          </button>
          <button type="button" className={styles.quickBtn} onClick={() => quick('weekend')}>
            Weekendy
          </button>
          <button
            type="button"
            className={styles.quickBtn}
            disabled={form.dates.length === 0}
            onClick={() => setRepeatUntil((v) => !v)}
          >
            Powtórz co tydzień do…
          </button>
        </div>
        {repeatUntil && (
          <div className={styles.sectionPad}>
            <label className={styles.dateRow}>
              <span>Powtarzaj do</span>
              <input
                type="date"
                min={form.dates[0]}
                defaultValue={addDays(anchor, 28)}
                aria-label="Powtarzaj do"
                onChange={(e) => {
                  if (e.target.value) set('dates', repeatWeekly(form.dates, e.target.value));
                }}
              />
            </label>
          </div>
        )}
        <div className={styles.sectionPad}>
          <MultiDateCalendar
            selected={form.dates}
            onChange={(d) => set('dates', d)}
            weekStartsOn={settings.weekStartsOn}
            initialMonth={prefill?.dates?.[0]}
          />
        </div>

        <GroupedList header="Typ">
          <ListRow
            title="Typ"
            trailing={
              <SegmentedControl
                label="Typ wpisu"
                value={form.kind}
                onChange={(v) => set('kind', v)}
                options={KIND_OPTIONS}
              />
            }
            last
          />
        </GroupedList>

        {form.kind === 'work' && (
          <GroupedList
            header="Godziny"
            footer={form.useDefault ? describeDefaults(settings.defaultHours) : undefined}
          >
            <ListRow
              title="Domyślne wg dnia"
              trailing={
                <Toggle
                  label="Domyślne wg dnia"
                  checked={form.useDefault}
                  onChange={(v) => set('useDefault', v)}
                />
              }
              last={form.useDefault}
            />
            {!form.useDefault && (
              <ListRow
                title="Od – do"
                trailing={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <TimeField
                      label="Początek zmiany"
                      value={form.start}
                      onChange={(v) => set('start', v)}
                    />
                    –
                    <TimeField
                      label="Koniec zmiany"
                      value={form.end}
                      onChange={(v) => set('end', v)}
                    />
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
            value={form.note}
            onChange={(v) => set('note', v)}
            placeholder="Opcjonalnie"
            autoCapitalize="sentences"
          />
        </GroupedList>

        {check.ok &&
          check.warnings.map((w) => (
            <p key={w} className={styles.warn} role="status">
              {w}
            </p>
          ))}
        {!check.ok && form.dates.length + form.personIds.length > 0 && (
          <p className={styles.err}>{check.errors[0]}</p>
        )}
        {error && (
          <p role="alert" className={styles.err}>
            {error}
          </p>
        )}

        <div className={styles.sectionPad}>
          <Button onClick={() => void save()} disabled={!check.ok || saving}>
            {check.ok ? `Dodaj ${plural(check.count, SHIFTS)}` : 'Dodaj zmiany'}
          </Button>
        </div>
      </Sheet>

      <Alert
        open={conflict !== null}
        title={conflict ? `${plural(conflict.count, KOLIZJE)}` : ''}
        message="Niektóre osoby mają już wpis w wybranych dniach. Co zrobić?"
        onClose={() => setConflict(null)}
        actions={[
          { label: 'Anuluj', onSelect: () => {} },
          {
            label: 'Pomiń kolidujące',
            onSelect: () => conflict && void commit(conflict.shifts, 'skip'),
          },
          {
            label: 'Zastąp',
            destructive: true,
            onSelect: () => conflict && void commit(conflict.shifts, 'replace'),
          },
        ]}
      />
    </>
  );
}
