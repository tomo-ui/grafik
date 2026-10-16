import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { Alert, Button, GroupedList, ListRow, Screen, SwipeActions, useToast } from '../../ui';
import { repos } from '../../db/repos';
import { usePersons } from '../../app/data';
import { monthDays, todayISO } from '../../domain/dates';
import { formatDayLong, formatMonth, plural, SHIFTS } from '../../domain/i18n';
import { shiftLabel } from '../../domain/labels';
import { colorVar, displayNames, initials } from '../../domain/people';
import type { ISODate, Shift } from '../../domain/types';
import { useShiftEditor } from '../shift-editor/ShiftEditorContext';
import styles from './Team.module.css';

function shiftMonth(first: ISODate, delta: number): ISODate {
  const [y, m] = first.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`;
}

/**
 * Widok „Lista dni”: każdy dzień jako sekcja z osobami i godzinami (8.3, widok alternatywny).
 * Zawiera edycję (tap), swipe Edytuj/Usuń i tryb zaznaczania z usuwaniem zbiorczym.
 */
export function DayList() {
  const [month, setMonth] = useState<ISODate>(() => `${todayISO().slice(0, 7)}-01`);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const days = useMemo(() => monthDays(y, m), [y, m]);
  const from = days[0]!;
  const to = days[days.length - 1]!;

  const persons = usePersons(true);
  const shifts = useLiveQuery(() => repos.shifts.range(from, to), [from, to]);
  const { openAdd, openEdit } = useShiftEditor();
  const toast = useToast();

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);

  const byId = useMemo(() => new Map((persons ?? []).map((p) => [p.id, p])), [persons]);
  const names = useMemo(() => displayNames(persons ?? []), [persons]);
  const order = useMemo(() => new Map((persons ?? []).map((p, i) => [p.id, i])), [persons]);

  const grouped = useMemo(() => {
    const map = new Map<ISODate, Shift[]>();
    for (const s of shifts ?? []) {
      // osoby usunięte kaskadowo nie mają aktywnych zmian; zarchiwizowane zostają widoczne
      if (!byId.has(s.personId)) continue;
      map.set(s.date, [...(map.get(s.date) ?? []), s]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (order.get(a.personId) ?? 0) - (order.get(b.personId) ?? 0));
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [shifts, byId, order]);

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const deleteShifts = async (ids: string[]) => {
    try {
      await repos.shifts.softDelete(ids);
      toast(`Usunięto ${plural(ids.length, SHIFTS)}`, () => {
        repos.shifts.restore(ids).catch(() => toast('Nie udało się cofnąć usunięcia.'));
      });
    } catch {
      toast('Nie udało się usunąć.');
    }
  };

  const today = todayISO();
  const loading = shifts === undefined || persons === undefined;

  const renderRow = (s: Shift, last: boolean) => {
    const p = byId.get(s.personId);
    if (!p) return null;
    const name = names.get(p.id) ?? p.firstName;
    const avatar = (
      <span className={styles.avatar} style={{ background: colorVar(p.color) }}>
        {initials(p)}
      </span>
    );
    const label = shiftLabel(s);
    const row = selecting ? (
      <ListRow
        title={name}
        subtitle={s.note ? `${label} · ${s.note}` : label}
        leading={avatar}
        trailing={
          <span
            className={`${styles.check} ${selected.has(s.id) ? styles.checkOn : ''}`}
            aria-hidden="true"
          >
            {selected.has(s.id) && <Check size={16} strokeWidth={3} />}
          </span>
        }
        onClick={() => toggle(s.id)}
        last={last}
      />
    ) : (
      <ListRow
        title={name}
        subtitle={s.note ? `${label} · ${s.note}` : label}
        leading={avatar}
        chevron
        onClick={() => openEdit(s)}
        last={last}
      />
    );
    return selecting ? (
      <div
        key={s.id}
        role="checkbox"
        aria-checked={selected.has(s.id)}
        aria-label={`${name}, ${formatDayLong(s.date)}, ${label}`}
        data-testid={`row-${s.id}`}
      >
        {row}
      </div>
    ) : (
      <SwipeActions
        key={s.id}
        actions={[
          { label: 'Edytuj', color: 'blue', onAction: () => openEdit(s) },
          { label: 'Usuń', color: 'red', onAction: () => void deleteShifts([s.id]) },
        ]}
      >
        {row}
      </SwipeActions>
    );
  };

  return (
    <Screen
      title="Zespół"
      trailing={
        grouped.length > 0 ? (
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
          >
            {selecting ? 'Gotowe' : 'Wybierz'}
          </button>
        ) : undefined
      }
    >
      <div className={styles.monthBar}>
        <button
          type="button"
          aria-label="Poprzedni miesiąc"
          className={styles.monthBtn}
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          <ChevronLeft size={22} />
        </button>
        <button
          type="button"
          className={styles.monthTitle}
          aria-label={`${formatMonth(month)} — wróć do bieżącego miesiąca`}
          onClick={() => setMonth(`${todayISO().slice(0, 7)}-01`)}
        >
          {formatMonth(month)}
        </button>
        <button
          type="button"
          aria-label="Następny miesiąc"
          className={styles.monthBtn}
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          <ChevronRight size={22} />
        </button>
      </div>

      {loading ? (
        <p className={styles.empty} role="status">
          Ładowanie…
        </p>
      ) : (persons ?? []).length === 0 ? (
        <div className={styles.empty}>
          <p>Najpierw dodaj osoby w Ustawieniach.</p>
        </div>
      ) : grouped.length === 0 ? (
        <div className={styles.empty}>
          <p>Brak zmian w tym miesiącu.</p>
          <Button onClick={() => openAdd({ dates: [days.includes(today) ? today : from] })}>
            Dodaj zmianę
          </Button>
        </div>
      ) : (
        grouped.map(([date, list]) => (
          <GroupedList
            key={date}
            header={`${formatDayLong(date)}${date === today ? ' · dziś' : ''}`}
          >
            {list.map((s, i) => renderRow(s, i === list.length - 1))}
          </GroupedList>
        ))
      )}

      {selecting && (
        <div className={`${styles.selectBar} glass`} role="toolbar" aria-label="Zaznaczone zmiany">
          <span>{selected.size > 0 ? plural(selected.size, SHIFTS) : 'Zaznacz zmiany'}</span>
          <button
            type="button"
            className={styles.deleteBtn}
            disabled={selected.size === 0}
            onClick={() => setConfirm(true)}
          >
            <Trash2 size={18} /> Usuń zaznaczone
          </button>
        </div>
      )}

      <Alert
        open={confirm}
        title={`Usunąć ${plural(selected.size, SHIFTS)}?`}
        message="Możesz je przywrócić przyciskiem Cofnij tuż po usunięciu."
        onClose={() => setConfirm(false)}
        actions={[
          { label: 'Anuluj', onSelect: () => {} },
          {
            label: 'Usuń',
            destructive: true,
            onSelect: () => {
              const ids = [...selected];
              stopSelecting();
              void deleteShifts(ids);
            },
          },
        ]}
      />
    </Screen>
  );
}
