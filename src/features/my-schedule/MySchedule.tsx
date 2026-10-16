import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLocation } from 'wouter';
import { Button, GroupedList, ListRow, Screen, SwipeActions, useToast } from '../../ui';
import { repos } from '../../db/repos';
import { usePersons } from '../../app/data';
import { useNow } from '../../app/useNow';
import { addDays, monthDays, todayISO } from '../../domain/dates';
import { formatDayLong, formatHours, pluralForm, SHIFTS } from '../../domain/i18n';
import { shiftLabel } from '../../domain/labels';
import { colorVar, displayNames, initials } from '../../domain/people';
import { shiftWorkMinutes } from '../../domain/totals';
import { coworkersOn, groupByWeek, monthSummary, nextShift, relativeDay } from '../../domain/views';
import type { Settings, Shift } from '../../domain/types';
import { useShiftEditor } from '../shift-editor/ShiftEditorContext';
import styles from './MySchedule.module.css';

const HORIZON_DAYS = 90;

/** Mój grafik: najbliższa zmiana, podsumowanie miesiąca, nadchodzące zmiany po tygodniach (8.2). */
export function MySchedule({ settings }: { settings: Settings }) {
  const [, navigate] = useLocation();
  const toast = useToast();
  const { openAdd, openEdit } = useShiftEditor();
  const now = useNow();
  const today = todayISO(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const persons = usePersons(true);
  const me = persons?.find((p) => p.isMe);
  const names = useMemo(() => displayNames(persons ?? []), [persons]);

  const monthFrom = `${today.slice(0, 7)}-01`;
  const days = monthDays(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
  const monthTo = days[days.length - 1]!;
  const horizon = addDays(today, HORIZON_DAYS);

  // wszystkie zmiany od początku miesiąca do horyzontu (współpracownicy potrzebni do karty)
  const from = monthFrom < today ? monthFrom : today;
  const shifts = useLiveQuery(() => repos.shifts.range(from, horizon), [from, horizon]);

  const mine = (shifts ?? []).filter((s) => s.personId === me?.id);
  const next = me && shifts ? nextShift(shifts, me.id, today, nowMin) : null;
  const summary =
    me && shifts ? monthSummary(shifts, me.id, monthFrom, monthTo, shiftWorkMinutes) : null;
  const groups = groupByWeek(mine, today, settings.weekStartsOn);

  if (persons === undefined || shifts === undefined) {
    return (
      <Screen title="Mój grafik">
        <p className={styles.note} role="status">
          Ładowanie…
        </p>
      </Screen>
    );
  }

  if (!me) {
    return (
      <Screen title="Mój grafik">
        <div className={styles.empty}>
          <p>Nie wybrano, która osoba to Ty.</p>
          <Button onClick={() => navigate('/settings/people')}>Wybierz siebie z listy osób</Button>
        </div>
      </Screen>
    );
  }

  const del = async (s: Shift) => {
    try {
      await repos.shifts.softDelete([s.id]);
      toast('Usunięto zmianę', () => {
        repos.shifts.restore([s.id]).catch(() => toast('Nie udało się cofnąć usunięcia.'));
      });
    } catch {
      toast('Nie udało się usunąć.');
    }
  };

  const mates = next ? coworkersOn(shifts, next) : [];
  const byId = new Map((persons ?? []).map((p) => [p.id, p]));

  return (
    <Screen title="Mój grafik">
      <section className={styles.cardWrap} aria-label="Najbliższa zmiana">
        <div
          className={styles.blob}
          aria-hidden="true"
          style={{ background: colorVar(me.color) }}
        />
        <div className={`${styles.card} glass`} data-testid="next-shift">
          <p className={styles.cardKicker}>Najbliższa zmiana</p>
          {next ? (
            <>
              <p className={styles.cardDay}>{formatDayLong(next.date)}</p>
              <p className={styles.cardTime}>{shiftLabel(next)}</p>
              <p className={styles.cardRel}>{relativeDay(next.date, today)}</p>
              {mates.length > 0 && (
                <div className={styles.mates} aria-label="Na zmianie z">
                  {mates.slice(0, 6).map((id) => {
                    const p = byId.get(id);
                    return p ? (
                      <span
                        key={id}
                        className={styles.mate}
                        style={{ background: colorVar(p.color) }}
                        title={names.get(id)}
                        aria-label={names.get(id)}
                      >
                        {initials(p)}
                      </span>
                    ) : null;
                  })}
                  <span className={styles.mateNote}>
                    z Tobą:{' '}
                    {mates
                      .map((id) => names.get(id))
                      .slice(0, 3)
                      .join(', ')}
                    {mates.length > 3 ? ` +${mates.length - 3}` : ''}
                  </span>
                </div>
              )}
            </>
          ) : (
            <>
              <p className={styles.cardDay}>Brak zaplanowanych zmian</p>
              <div className={styles.cardAction}>
                <Button variant="tinted" onClick={() => openAdd({ personIds: [me.id] })}>
                  Dodaj zmianę
                </Button>
              </div>
            </>
          )}
        </div>
      </section>

      {summary && (
        <section
          className={styles.stats}
          aria-label="Podsumowanie miesiąca"
          data-testid="month-summary"
        >
          <div className={styles.stat}>
            <span className={styles.statNum}>{summary.shifts}</span>
            <span className={styles.statLabel}>{pluralForm(summary.shifts, SHIFTS)}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statNum}>{formatHours(summary.minutes)}</span>
            <span className={styles.statLabel}>w tym miesiącu</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statNum}>{summary.off}</span>
            <span className={styles.statLabel}>{summary.off === 1 ? 'wolne' : 'wolnych'}</span>
          </div>
        </section>
      )}

      {groups.length === 0 ? (
        <p className={styles.note}>Brak nadchodzących zmian.</p>
      ) : (
        groups.map((g) => (
          <GroupedList key={g.key} header={g.label}>
            {g.shifts.map((s, i) => (
              <SwipeActions
                key={s.id}
                actions={[
                  { label: 'Edytuj', color: 'blue', onAction: () => openEdit(s) },
                  { label: 'Usuń', color: 'red', onAction: () => void del(s) },
                ]}
              >
                <ListRow
                  title={`${formatDayLong(s.date)}${s.date === today ? ' · dziś' : ''}`}
                  subtitle={s.note ? `${shiftLabel(s)} · ${s.note}` : shiftLabel(s)}
                  chevron
                  onClick={() => openEdit(s)}
                  last={i === g.shifts.length - 1}
                />
              </SwipeActions>
            ))}
          </GroupedList>
        ))
      )}
    </Screen>
  );
}
