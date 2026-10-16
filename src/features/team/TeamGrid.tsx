import { useRef, type CSSProperties } from 'react';
import { ContextMenu } from '../../ui';
import { weekdayOf } from '../../domain/dates';
import { DAY_SHORT, formatDayLong, formatHours } from '../../domain/i18n';
import { endsNextDay, KIND_SHORT, shiftLabel } from '../../domain/labels';
import { colorVar, fullName } from '../../domain/people';
import type { Period } from '../../domain/views';
import type { ISODate, Person, Shift } from '../../domain/types';
import styles from './TeamGrid.module.css';

export interface TeamGridProps {
  period: Period;
  people: Person[];
  names: Map<string, string>;
  shifts: Shift[];
  today: ISODate;
  totals: Map<string, number>;
  staffing: Map<ISODate, number>;
  selecting: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onAdd: (personId: string, date: ISODate) => void;
  onEdit: (shift: Shift) => void;
  onDuplicate: (shift: Shift) => void;
  onDelete: (shift: Shift) => void;
  /** tylko tryb tygodnia: przesunięcie palcem w bok zmienia tydzień (P-07) */
  onSwipePeriod?: (delta: -1 | 1) => void;
}

/**
 * Siatka zespołu: wiersze = osoby, kolumny = dni. Jeden kontener `overflow: auto` dla obu osi
 * (P-24), lewy górny narożnik z najwyższym z-index. Komórki bez blur (P-10).
 */
export function TeamGrid(p: TeamGridProps) {
  const { period, people, shifts } = p;
  const byKey = new Map<string, Shift>();
  for (const s of shifts) byKey.set(`${s.personId}|${s.date}`, s);
  const isWeek = period.mode === 'week';

  const swipe = useRef<{ x: number; y: number; active: boolean } | null>(null);
  const moved = useRef(false);

  const gridStyle: CSSProperties = {
    gridTemplateColumns: isWeek
      ? `var(--nameW) repeat(${period.days.length}, minmax(0, 1fr))`
      : `var(--nameW) repeat(${period.days.length}, var(--colW))`,
  };

  return (
    <div
      className={`${styles.scroll} ${isWeek ? styles.week : styles.month}`}
      data-testid="team-grid"
      role="group"
      aria-label={`Grafik zespołu, ${period.label}`}
      onPointerDown={(e) => {
        moved.current = false;
        swipe.current =
          isWeek && p.onSwipePeriod && e.clientX > 20
            ? { x: e.clientX, y: e.clientY, active: false }
            : null;
      }}
      onPointerMove={(e) => {
        const s = swipe.current;
        if (!s || e.buttons === 0) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        // kierunek rozpoznawany po 10 px ruchu (P-07)
        if (!s.active && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) s.active = true;
        if (s.active) moved.current = true;
      }}
      onPointerUp={(e) => {
        const s = swipe.current;
        swipe.current = null;
        if (!s?.active) return;
        const dx = e.clientX - s.x;
        if (Math.abs(dx) > 60) p.onSwipePeriod?.(dx < 0 ? 1 : -1);
      }}
      onPointerCancel={() => (swipe.current = null)}
      onClickCapture={(e) => {
        if (moved.current) {
          e.stopPropagation();
          e.preventDefault();
          moved.current = false;
        }
      }}
    >
      <div className={styles.grid} style={gridStyle}>
        <div className={`${styles.corner}`} aria-hidden="true" />
        {period.days.map((d) => {
          const wd = weekdayOf(d);
          const weekend = wd === 0 || wd === 6;
          const n = p.staffing.get(d) ?? 0;
          return (
            <div
              key={d}
              className={`${styles.head} ${weekend ? styles.weekend : ''}`}
              aria-label={formatDayLong(d)}
            >
              <span className={styles.dayName}>{DAY_SHORT[wd]}</span>
              <span className={`${styles.dayNum} ${d === p.today ? styles.todayNum : ''}`}>
                {Number(d.slice(8))}
              </span>
              <span className={styles.staff}>{n > 0 ? `${n} os.` : ' '}</span>
            </div>
          );
        })}

        {people.map((person) => (
          <PersonRow key={person.id} person={person} {...p} byKey={byKey} />
        ))}
      </div>
    </div>
  );
}

function PersonRow({
  person,
  period,
  names,
  totals,
  today,
  selecting,
  selected,
  byKey,
  onToggleSelect,
  onAdd,
  onEdit,
  onDuplicate,
  onDelete,
}: TeamGridProps & { person: Person; byKey: Map<string, Shift> }) {
  const name = names.get(person.id) ?? person.firstName;
  const total = totals.get(person.id) ?? 0;
  return (
    <>
      <div className={styles.nameCell} title={fullName(person)}>
        <span className={styles.dot} style={{ background: colorVar(person.color) }} />
        <span className={styles.nameText}>
          <span className={styles.name}>{name}</span>
          <span className={styles.total}>{total > 0 ? formatHours(total) : '—'}</span>
        </span>
      </div>
      {period.days.map((d) => {
        const wd = weekdayOf(d);
        const weekend = wd === 0 || wd === 6;
        const s = byKey.get(`${person.id}|${d}`);
        const base = `${styles.cell} ${weekend ? styles.weekend : ''} ${d === today ? styles.todayCol : ''}`;
        if (!s) {
          return (
            <button
              key={d}
              type="button"
              className={`${base} ${styles.empty}`}
              aria-label={`${name}, ${formatDayLong(d)}, brak zmiany. Dodaj`}
              disabled={selecting}
              onClick={() => onAdd(person.id, d)}
            />
          );
        }
        const isSel = selected.has(s.id);
        const label = `${name}, ${formatDayLong(d)}, ${shiftLabel(s)}`;
        const cell = (
          <button
            type="button"
            className={`${base} ${isSel ? styles.picked : ''}`}
            aria-label={label}
            aria-pressed={selecting ? isSel : undefined}
            style={{ ['--pc' as string]: colorVar(person.color) }}
            onClick={() => (selecting ? onToggleSelect(s.id) : onEdit(s))}
          >
            {s.kind === 'work' && s.start && s.end ? (
              <span className={styles.pill}>
                <span>{s.start}</span>
                <span>
                  {s.end}
                  {endsNextDay(s) && <sup className={styles.plus1}>+1</sup>}
                </span>
              </span>
            ) : (
              <span className={`${styles.pill} ${styles.off}`}>
                {KIND_SHORT[s.kind === 'work' ? 'other' : s.kind]}
              </span>
            )}
          </button>
        );
        return selecting ? (
          <span key={d} className={styles.contents}>
            {cell}
          </span>
        ) : (
          <ContextMenu
            key={d}
            display="contents"
            items={[
              { label: 'Edytuj', onSelect: () => onEdit(s) },
              { label: 'Duplikuj na…', onSelect: () => onDuplicate(s) },
              { label: 'Usuń', destructive: true, onSelect: () => onDelete(s) },
            ]}
          >
            {cell}
          </ContextMenu>
        );
      })}
    </>
  );
}
