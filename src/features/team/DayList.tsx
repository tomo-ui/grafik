import { useMemo } from 'react';
import { Check } from 'lucide-react';
import { Button, GroupedList, ListRow, SwipeActions } from '../../ui';
import { formatDayLong } from '../../domain/i18n';
import { shiftLabel } from '../../domain/labels';
import { colorVar, initials } from '../../domain/people';
import type { ISODate, Person, Shift } from '../../domain/types';
import styles from './Team.module.css';

/**
 * Widok „Lista dni”: każdy dzień okresu jako sekcja z osobami i godzinami (8.3, widok alternatywny
 * dla wąskich ekranów, czytników ekranu i większego tekstu). Czysto prezentacyjny.
 */
export function DayListView({
  shifts,
  people,
  names,
  today,
  selecting,
  selected,
  onToggleSelect,
  onEdit,
  onDelete,
  onAddEmpty,
}: {
  shifts: Shift[];
  people: Person[];
  names: Map<string, string>;
  today: ISODate;
  selecting: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onEdit: (s: Shift) => void;
  onDelete: (ids: string[]) => void;
  onAddEmpty: () => void;
}) {
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const order = useMemo(() => new Map(people.map((p, i) => [p.id, i])), [people]);

  const grouped = useMemo(() => {
    const map = new Map<ISODate, Shift[]>();
    for (const s of shifts) {
      if (!byId.has(s.personId)) continue;
      map.set(s.date, [...(map.get(s.date) ?? []), s]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (order.get(a.personId) ?? 0) - (order.get(b.personId) ?? 0));
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [shifts, byId, order]);

  if (grouped.length === 0) {
    return (
      <div className={styles.empty}>
        <p>Brak zmian w tym okresie.</p>
        <Button onClick={onAddEmpty}>Dodaj zmianę</Button>
      </div>
    );
  }

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
    const subtitle = s.note ? `${label} · ${s.note}` : label;

    if (selecting) {
      return (
        <div
          key={s.id}
          role="checkbox"
          aria-checked={selected.has(s.id)}
          aria-label={`${name}, ${formatDayLong(s.date)}, ${label}`}
          data-testid={`row-${s.id}`}
        >
          <ListRow
            title={name}
            subtitle={subtitle}
            leading={avatar}
            trailing={
              <span
                className={`${styles.check} ${selected.has(s.id) ? styles.checkOn : ''}`}
                aria-hidden="true"
              >
                {selected.has(s.id) && <Check size={16} strokeWidth={3} />}
              </span>
            }
            onClick={() => onToggleSelect(s.id)}
            last={last}
          />
        </div>
      );
    }
    return (
      <SwipeActions
        key={s.id}
        actions={[
          { label: 'Edytuj', color: 'blue', onAction: () => onEdit(s) },
          { label: 'Usuń', color: 'red', onAction: () => onDelete([s.id]) },
        ]}
      >
        <ListRow
          title={name}
          subtitle={subtitle}
          leading={avatar}
          chevron
          onClick={() => onEdit(s)}
          last={last}
        />
      </SwipeActions>
    );
  };

  return (
    <>
      {grouped.map(([date, list]) => (
        <GroupedList key={date} header={`${formatDayLong(date)}${date === today ? ' · dziś' : ''}`}>
          {list.map((s, i) => renderRow(s, i === list.length - 1))}
        </GroupedList>
      ))}
    </>
  );
}
