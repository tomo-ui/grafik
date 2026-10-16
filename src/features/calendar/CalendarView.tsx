import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Button, GroupedList, ListRow, Screen } from '../../ui';
import { repos } from '../../db/repos';
import { usePersons } from '../../app/data';
import { useToday } from '../../app/useNow';
import { monthDays, weekdayOf } from '../../domain/dates';
import { DAY_SHORT, formatDayLong, formatMonth } from '../../domain/i18n';
import { shiftLabel } from '../../domain/labels';
import { colorVar, displayNames, initials } from '../../domain/people';
import { dotsForDay, shiftPeriod } from '../../domain/views';
import type { ISODate, Settings, Weekday } from '../../domain/types';
import { useUi } from '../../store/ui';
import { useShiftEditor } from '../shift-editor/ShiftEditorContext';
import styles from './Calendar.module.css';

/** Kalendarz miesięczny: kropki osób w pracy (max 4 + „+N”), tap w dzień → lista „Kto pracuje” (8.4). */
export function CalendarView({ settings }: { settings: Settings }) {
  const today = useToday();
  const { calMonth, calDay, setCal } = useUi();
  const { openAdd, openEdit } = useShiftEditor();

  const month = calMonth ?? `${today.slice(0, 7)}-01`;
  const [y, m] = month.split('-').map(Number) as [number, number];
  const days = useMemo(() => monthDays(y, m), [y, m]);
  const from = days[0]!;
  const to = days[days.length - 1]!;
  const selected = calDay && calDay.slice(0, 7) === month.slice(0, 7) ? calDay : null;

  const persons = usePersons(true);
  const shifts = useLiveQuery(() => repos.shifts.range(from, to), [from, to]);
  const byId = useMemo(() => new Map((persons ?? []).map((p) => [p.id, p])), [persons]);
  const names = useMemo(() => displayNames(persons ?? []), [persons]);

  const lead = (weekdayOf(from) - settings.weekStartsOn + 7) % 7;
  const headers: Weekday[] =
    settings.weekStartsOn === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];

  const dayShifts = useMemo(
    () =>
      selected
        ? (shifts ?? [])
            .filter((s) => s.date === selected && byId.has(s.personId))
            .sort(
              (a, b) =>
                (persons ?? []).findIndex((p) => p.id === a.personId) -
                (persons ?? []).findIndex((p) => p.id === b.personId),
            )
        : [],
    [shifts, selected, byId, persons],
  );

  const loaded = shifts !== undefined && persons !== undefined;

  const go = (delta: number) => setCal(shiftPeriod(month, 'month', delta), null);
  const pick = (d: ISODate) => setCal(month, d === selected ? null : d);

  return (
    <Screen title="Kalendarz">
      <div className={styles.monthBar}>
        <button
          type="button"
          aria-label="Poprzedni miesiąc"
          className={styles.navBtn}
          onClick={() => go(-1)}
        >
          <ChevronLeft size={22} />
        </button>
        <button
          type="button"
          className={styles.monthTitle}
          aria-label={`${formatMonth(month)} — wróć do bieżącego miesiąca`}
          onClick={() => setCal(null, null)}
        >
          {formatMonth(month)}
        </button>
        <button
          type="button"
          aria-label="Następny miesiąc"
          className={styles.navBtn}
          onClick={() => go(1)}
        >
          <ChevronRight size={22} />
        </button>
      </div>

      <div className={styles.cal} data-testid="calendar">
        <div className={styles.week} aria-hidden="true">
          {headers.map((d) => (
            <span key={d}>{DAY_SHORT[d]}</span>
          ))}
        </div>
        <div className={styles.grid}>
          {Array.from({ length: lead }, (_, i) => (
            <span key={`b${i}`} />
          ))}
          {days.map((d) => {
            const dots = dotsForDay(shifts ?? [], byId, d, 4);
            const isSel = d === selected;
            const wd = weekdayOf(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={isSel}
                aria-label={`${formatDayLong(d)}${
                  dots.colors.length + dots.extra > 0
                    ? `, w pracy: ${dots.colors.length + dots.extra}`
                    : ''
                }`}
                className={`${styles.day} ${isSel ? styles.sel : ''} ${wd === 0 || wd === 6 ? styles.weekend : ''}`}
                onClick={() => pick(d)}
              >
                <span className={`${styles.num} ${d === today ? styles.today : ''}`}>
                  {Number(d.slice(8))}
                </span>
                <span className={styles.dots} aria-hidden="true">
                  {dots.colors.map((c, i) => (
                    <i key={i} style={{ background: c }} />
                  ))}
                  {dots.extra > 0 && <b>+{dots.extra}</b>}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {selected && loaded && (
        <>
          <GroupedList header={`Kto pracuje · ${formatDayLong(selected)}`}>
            {dayShifts.length === 0 ? (
              <ListRow title="Nikogo w tym dniu" last />
            ) : (
              dayShifts.map((s, i) => {
                const p = byId.get(s.personId)!;
                return (
                  <ListRow
                    key={s.id}
                    title={names.get(p.id) ?? p.firstName}
                    subtitle={s.note ? `${shiftLabel(s)} · ${s.note}` : shiftLabel(s)}
                    leading={
                      <span className={styles.avatar} style={{ background: colorVar(p.color) }}>
                        {initials(p)}
                      </span>
                    }
                    chevron
                    onClick={() => openEdit(s)}
                    last={i === dayShifts.length - 1}
                  />
                );
              })
            )}
          </GroupedList>
          <div className={styles.add}>
            <Button variant="tinted" onClick={() => openAdd({ dates: [selected] })}>
              <Plus size={18} /> Dodaj zmianę w tym dniu
            </Button>
          </div>
        </>
      )}
    </Screen>
  );
}
