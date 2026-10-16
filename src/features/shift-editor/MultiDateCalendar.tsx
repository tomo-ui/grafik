import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { monthDays, todayISO, weekdayOf } from '../../domain/dates';
import { DAY_SHORT, formatDayLong, formatMonth } from '../../domain/i18n';
import { datesBetween } from '../../domain/shiftForm';
import type { ISODate, Weekday } from '../../domain/types';
import styles from './ShiftEditor.module.css';

function shiftMonth(first: ISODate, delta: number): ISODate {
  const [y, m] = first.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`;
}

/**
 * Mini-kalendarz z wielokrotnym zaznaczaniem: tap przełącza dzień, przeciągnięcie palcem
 * w poziomie zaznacza (lub odznacza) zakres. touch-action: pan-y zostawia przewijanie sheetu.
 */
export function MultiDateCalendar({
  selected,
  onChange,
  weekStartsOn,
  initialMonth,
}: {
  selected: ISODate[];
  onChange: (dates: ISODate[]) => void;
  weekStartsOn: 0 | 1;
  initialMonth?: ISODate;
}) {
  const today = todayISO();
  const [month, setMonth] = useState<ISODate>(() => {
    const seed = initialMonth ?? selected[0] ?? today;
    return `${seed.slice(0, 7)}-01`;
  });
  const drag = useRef<{
    anchor: ISODate;
    base: Set<ISODate>;
    removing: boolean;
    moved: boolean;
  } | null>(null);

  const [y, m] = month.split('-').map(Number) as [number, number];
  const days = monthDays(y, m);
  const lead = (weekdayOf(days[0]!) - weekStartsOn + 7) % 7;
  const headers: Weekday[] = weekStartsOn === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  const sel = new Set(selected);

  const dateAt = (target: EventTarget | null): ISODate | null => {
    const el = (target as HTMLElement | null)?.closest?.('[data-date]');
    return (el?.getAttribute('data-date') as ISODate | null) ?? null;
  };

  return (
    <div className={styles.cal}>
      <div className={styles.calHead}>
        <button
          type="button"
          aria-label="Poprzedni miesiąc"
          className={styles.calNav}
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          <ChevronLeft size={22} />
        </button>
        <span className={styles.calTitle} aria-live="polite">
          {formatMonth(month)}
        </span>
        <button
          type="button"
          aria-label="Następny miesiąc"
          className={styles.calNav}
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          <ChevronRight size={22} />
        </button>
      </div>
      <div className={styles.calWeek} aria-hidden="true">
        {headers.map((d) => (
          <span key={d}>{DAY_SHORT[d]}</span>
        ))}
      </div>
      <div
        className={styles.calGrid}
        onPointerDown={(e) => {
          const d = dateAt(e.target);
          if (!d) return;
          drag.current = { anchor: d, base: new Set(sel), removing: sel.has(d), moved: false };
        }}
        onPointerMove={(e) => {
          const st = drag.current;
          if (!st || e.buttons === 0) return;
          const el = document.elementFromPoint(e.clientX, e.clientY);
          const d = dateAt(el);
          if (!d || (d === st.anchor && !st.moved)) return;
          st.moved = true;
          const next = new Set(st.base);
          for (const x of datesBetween(st.anchor, d)) {
            if (st.removing) next.delete(x);
            else next.add(x);
          }
          onChange([...next].sort());
        }}
        onPointerUp={(e) => {
          const st = drag.current;
          drag.current = null;
          if (!st || st.moved) return;
          const d = dateAt(e.target);
          if (!d) return;
          const next = new Set(sel);
          if (next.has(d)) next.delete(d);
          else next.add(d);
          onChange([...next].sort());
        }}
        onPointerCancel={() => (drag.current = null)}
        onClick={(e) => {
          // detail === 0: klawiatura / czytnik ekranu (zwykły tap obsługuje onPointerUp)
          if (e.detail !== 0) return;
          const d = dateAt(e.target);
          if (!d) return;
          const next = new Set(sel);
          if (next.has(d)) next.delete(d);
          else next.add(d);
          onChange([...next].sort());
        }}
      >
        {Array.from({ length: lead }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {days.map((d) => {
          const on = sel.has(d);
          const day = Number(d.slice(8));
          return (
            <button
              key={d}
              type="button"
              data-date={d}
              aria-pressed={on}
              aria-label={formatDayLong(d)}
              className={`${styles.calDay} ${on ? styles.calOn : ''} ${d === today ? styles.calToday : ''} ${
                [0, 6].includes(weekdayOf(d)) ? styles.calWeekend : ''
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
