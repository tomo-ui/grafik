import { DAY_NAMES, formatHours } from '../../domain/i18n';
import { checkTimes, normalizeTimeInput, parseHHMM } from '../../domain/hours';
import type { DefaultHours, Weekday } from '../../domain/types';
import styles from './Settings.module.css';

export function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className={styles.timePill}>
      <span className="sr-only">{label}</span>
      <input
        type="time"
        value={value}
        step={60}
        aria-label={label}
        onChange={(e) => {
          // P-20: zawsze HH:MM (bez sekund); puste pole (wyczyszczone) ignorujemy
          const v = normalizeTimeInput(e.target.value);
          if (parseHHMM(v) !== null) onChange(v);
        }}
      />
    </label>
  );
}

/** Kolejność wyświetlania dni: od poniedziałku lub niedzieli. */
export function weekOrder(weekStartsOn: 0 | 1): Weekday[] {
  return weekStartsOn === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
}

export function hoursValid(h: DefaultHours): boolean {
  return ([0, 1, 2, 3, 4, 5, 6] as Weekday[]).every((d) => checkTimes(h[d].start, h[d].end).ok);
}

/** 7 wierszy (dni tygodnia) z pickerami czasu i podglądem długości. */
export function HoursEditor({
  value,
  onChange,
  weekStartsOn,
}: {
  value: DefaultHours;
  onChange: (v: DefaultHours) => void;
  weekStartsOn: 0 | 1;
}) {
  return (
    <>
      {weekOrder(weekStartsOn).map((d, i, arr) => {
        const h = value[d];
        const r = checkTimes(h.start, h.end);
        const set = (patch: Partial<{ start: string; end: string }>) =>
          onChange({ ...value, [d]: { ...h, ...patch } });
        return (
          <div
            key={d}
            className={`${styles.hoursRow} ${i === arr.length - 1 ? styles.hoursLast : ''}`}
            data-testid={`hours-${d}`}
          >
            <div className={styles.hoursDay}>
              <span>{DAY_NAMES[d]}</span>
              <span
                className={r.ok ? styles.hoursInfo : styles.hoursError}
                role={r.ok ? undefined : 'alert'}
              >
                {r.ok
                  ? `${formatHours(r.minutes)}${r.crossesMidnight ? ' · +1 dzień' : ''}`
                  : r.error}
              </span>
            </div>
            <TimeField
              label={`${DAY_NAMES[d]} — początek`}
              value={h.start}
              onChange={(v) => set({ start: v })}
            />
            <span aria-hidden="true">–</span>
            <TimeField
              label={`${DAY_NAMES[d]} — koniec`}
              value={h.end}
              onChange={(v) => set({ end: v })}
            />
          </div>
        );
      })}
    </>
  );
}
