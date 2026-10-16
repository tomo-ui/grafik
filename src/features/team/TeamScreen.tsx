import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft, ChevronRight, LayoutGrid, List, Trash2 } from 'lucide-react';
import { useLocation } from 'wouter';
import { Alert, Button, Screen, SegmentedControl, useToast } from '../../ui';
import { repos } from '../../db/repos';
import { usePersons } from '../../app/data';
import { useLargeText, useNow } from '../../app/useNow';
import { todayISO } from '../../domain/dates';
import { plural, SHIFTS } from '../../domain/i18n';
import { displayNames } from '../../domain/people';
import { staffingByDay, totalsByPerson } from '../../domain/totals';
import { periodOf, shiftPeriod } from '../../domain/views';
import type { Settings, Shift } from '../../domain/types';
import { useUi } from '../../store/ui';
import { useShiftEditor } from '../shift-editor/ShiftEditorContext';
import { DayListView } from './DayList';
import { TeamGrid } from './TeamGrid';
import styles from './Team.module.css';

/** Zespół: siatka tydzień/miesiąc albo lista dni, filtry, zaznaczanie i usuwanie zbiorcze. */
export function TeamScreen({ settings }: { settings: Settings }) {
  const ui = useUi();
  const toast = useToast();
  const { openAdd, openEdit } = useShiftEditor();
  const [, navigate] = useLocation();
  const today = todayISO(useNow());
  const largeText = useLargeText();

  const mode = ui.teamMode;
  const anchor = ui.teamAnchor ?? (mode === 'month' ? `${today.slice(0, 7)}-01` : today);
  const period = useMemo(
    () => periodOf(anchor, mode, settings.weekStartsOn),
    [anchor, mode, settings.weekStartsOn],
  );

  const persons = usePersons(true);
  const shifts = useLiveQuery(
    () => repos.shifts.range(period.from, period.to),
    [period.from, period.to],
  );

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);

  // widoczne osoby: zarchiwizowane tylko gdy mają zmiany w okresie; filtr; ukrywanie pustych
  const people = useMemo(() => {
    const withShifts = new Set((shifts ?? []).map((s) => s.personId));
    return (persons ?? []).filter((p) => {
      if (p.archived && !withShifts.has(p.id)) return false;
      if (ui.filterIds.length > 0 && !ui.filterIds.includes(p.id)) return false;
      if (ui.hideEmpty && !withShifts.has(p.id)) return false;
      return true;
    });
  }, [persons, shifts, ui.filterIds, ui.hideEmpty]);

  const names = useMemo(() => displayNames(persons ?? []), [persons]);
  const visibleIds = useMemo(() => new Set(people.map((p) => p.id)), [people]);
  const visibleShifts = useMemo(
    () => (shifts ?? []).filter((s) => visibleIds.has(s.personId)),
    [shifts, visibleIds],
  );
  const totals = useMemo(
    () => totalsByPerson(visibleShifts, period.from, period.to),
    [visibleShifts, period.from, period.to],
  );
  const staffing = useMemo(
    () => staffingByDay(visibleShifts, period.from, period.to),
    [visibleShifts, period.from, period.to],
  );

  const view = largeText ? 'list' : ui.teamView;
  const loading = persons === undefined || shifts === undefined;

  const go = (delta: -1 | 1) => ui.setTeamAnchor(shiftPeriod(anchor, mode, delta));
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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

  const isCurrent = period.days.includes(today);

  const controls = (
    <div className={styles.controls}>
      <div className={styles.segWrap}>
        <SegmentedControl
          label="Zakres widoku"
          value={mode}
          onChange={(m) => ui.setTeamMode(m, today)}
          options={[
            { value: 'week', label: 'Tydzień' },
            { value: 'month', label: 'Miesiąc' },
          ]}
        />
      </div>
      <div className={styles.monthBar}>
        <button
          type="button"
          aria-label={mode === 'week' ? 'Poprzedni tydzień' : 'Poprzedni miesiąc'}
          className={styles.monthBtn}
          onClick={() => go(-1)}
        >
          <ChevronLeft size={22} />
        </button>
        <span className={styles.periodTitle} aria-live="polite" data-testid="period-label">
          {period.label}
        </span>
        <button
          type="button"
          aria-label={mode === 'week' ? 'Następny tydzień' : 'Następny miesiąc'}
          className={styles.monthBtn}
          onClick={() => go(1)}
        >
          <ChevronRight size={22} />
        </button>
        <button type="button" className={styles.todayBtn} onClick={() => ui.setTeamAnchor(null)}>
          Dziś
        </button>
      </div>
      {(persons ?? []).length > 1 && (
        <div className={styles.filters} role="group" aria-label="Filtr osób">
          <button
            type="button"
            aria-pressed={ui.filterIds.length === 0}
            className={`${styles.chip} ${ui.filterIds.length === 0 ? styles.chipOn : ''}`}
            onClick={ui.clearFilter}
          >
            Wszyscy
          </button>
          {(persons ?? [])
            .filter((p) => !p.archived)
            .map((p) => {
              const on = ui.filterIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  className={`${styles.chip} ${on ? styles.chipOn : ''}`}
                  onClick={() => ui.toggleFilter(p.id)}
                >
                  {names.get(p.id)}
                </button>
              );
            })}
          <button
            type="button"
            aria-pressed={ui.hideEmpty}
            className={`${styles.chip} ${ui.hideEmpty ? styles.chipOn : ''}`}
            onClick={() => ui.setHideEmpty(!ui.hideEmpty)}
          >
            Ukryj bez zmian
          </button>
        </div>
      )}
    </div>
  );

  const toolbar = (
    <div className={styles.toolbar}>
      {!largeText && (
        <button
          type="button"
          className={styles.navBtn}
          aria-label={view === 'grid' ? 'Przełącz na listę dni' : 'Przełącz na siatkę'}
          onClick={() => ui.setTeamView(view === 'grid' ? 'list' : 'grid')}
        >
          {view === 'grid' ? <List size={22} /> : <LayoutGrid size={22} />}
        </button>
      )}
      {visibleShifts.length > 0 && (
        <button
          type="button"
          className={styles.navBtn}
          onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
        >
          {selecting ? 'Gotowe' : 'Wybierz'}
        </button>
      )}
    </div>
  );

  const empty =
    !loading && (persons ?? []).filter((p) => !p.archived).length === 0 ? (
      <div className={styles.empty}>
        <p>Najpierw dodaj osoby w Ustawieniach.</p>
        <Button onClick={() => navigate('/settings/people')}>Przejdź do osób</Button>
      </div>
    ) : null;

  const selectBar = selecting && (
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
  );

  const alert = (
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
  );

  if (view === 'list') {
    return (
      <Screen title="Zespół" trailing={toolbar}>
        {controls}
        {empty ??
          (loading ? (
            <p className={styles.empty} role="status">
              Ładowanie…
            </p>
          ) : (
            <DayListView
              shifts={visibleShifts}
              people={people}
              names={names}
              today={today}
              selecting={selecting}
              selected={selected}
              onToggleSelect={toggle}
              onEdit={openEdit}
              onDelete={(ids) => void deleteShifts(ids)}
              onAddEmpty={() => openAdd({ dates: [isCurrent ? today : period.from] })}
            />
          ))}
        {selectBar}
        {alert}
      </Screen>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <h1 className={styles.pageTitle}>Zespół</h1>
        {toolbar}
      </header>
      {controls}
      {empty ??
        (loading ? (
          <p className={styles.empty} role="status">
            Ładowanie…
          </p>
        ) : (
          <>
            {visibleShifts.length === 0 && (
              <p className={styles.hint}>
                Brak zmian w tym okresie. Dotknij pustej komórki, aby dodać zmianę.
              </p>
            )}
            <TeamGrid
              period={period}
              people={people}
              names={names}
              shifts={visibleShifts}
              today={today}
              totals={totals}
              staffing={staffing}
              selecting={selecting}
              selected={selected}
              onToggleSelect={toggle}
              onAdd={(personId, date) => openAdd({ personIds: [personId], dates: [date] })}
              onEdit={openEdit}
              onDuplicate={(s: Shift) =>
                openAdd({ personIds: [s.personId], dates: [], template: s })
              }
              onDelete={(s: Shift) => void deleteShifts([s.id])}
              onSwipePeriod={mode === 'week' ? go : undefined}
            />
          </>
        ))}
      {selectBar}
      {alert}
    </div>
  );
}
