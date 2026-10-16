import { useState } from 'react';
import { CalendarDays, Plus, Settings, Users, User } from 'lucide-react';
import {
  ActionSheet,
  Alert,
  Button,
  ContextMenu,
  GroupedList,
  ListRow,
  MenuButton,
  Screen,
  SegmentedControl,
  Sheet,
  Skeleton,
  Spinner,
  Stepper,
  SwipeActions,
  TabBar,
  Toggle,
  useToast,
} from '../ui';
import styles from './UiCatalog.module.css';

const PEOPLE = [
  'blue',
  'green',
  'orange',
  'pink',
  'purple',
  'teal',
  'indigo',
  'red',
  'yellow',
  'mint',
  'cyan',
  'brown',
];

const TABS = [
  { id: 'me', label: 'Mój grafik', icon: <User size={22} strokeWidth={1.75} /> },
  { id: 'team', label: 'Zespół', icon: <Users size={22} strokeWidth={1.75} /> },
  { id: 'cal', label: 'Kalendarz', icon: <CalendarDays size={22} strokeWidth={1.75} /> },
  { id: 'set', label: 'Ustawienia', icon: <Settings size={22} strokeWidth={1.75} /> },
];

/** Katalog komponentów — tylko w trybie dev (/_dev/ui). */
export function UiCatalog() {
  const [tab, setTab] = useState('me');
  const [compact, setCompact] = useState(false);
  const [seg, setSeg] = useState<'week' | 'month'>('week');
  const [on, setOn] = useState(true);
  const [n, setN] = useState(2);
  const [sheet, setSheet] = useState(false);
  const [alert, setAlert] = useState(false);
  const [actions, setActions] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [log, setLog] = useState('—');
  const toast = useToast();
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');

  const applyTheme = (t: 'system' | 'light' | 'dark') => {
    setTheme(t);
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  };

  return (
    <>
      <Screen title="Katalog UI" onScrollDirection={(d) => setCompact(d === 'down')}>
        <GroupedList header="Motyw">
          <ListRow
            title="Motyw"
            trailing={
              <SegmentedControl
                label="Motyw"
                value={theme}
                onChange={applyTheme}
                options={[
                  { value: 'system', label: 'Auto' },
                  { value: 'light', label: 'Jasny' },
                  { value: 'dark', label: 'Ciemny' },
                ]}
              />
            }
          />
        </GroupedList>

        <GroupedList header="Kontrolki" footer="Stopka sekcji w stylu iOS.">
          <ListRow
            title="Widok"
            trailing={
              <SegmentedControl
                label="Widok"
                value={seg}
                onChange={setSeg}
                options={[
                  { value: 'week', label: 'Tydzień' },
                  { value: 'month', label: 'Miesiąc' },
                ]}
              />
            }
          />
          <ListRow
            title="Przełącznik"
            trailing={<Toggle checked={on} onChange={setOn} label="Przełącznik" />}
          />
          <ListRow
            title="Liczba zmian"
            value={String(n)}
            trailing={<Stepper value={n} onChange={setN} label="Liczba zmian" />}
          />
          <ListRow title="Z chevronem" value="10:00" chevron onClick={() => setLog('tap row')} />
          <ListRow
            title="Ładowanie"
            trailing={
              <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <Skeleton width={60} />
                <Spinner />
              </span>
            }
          />
        </GroupedList>

        <GroupedList header="Przyciski">
          <div className={styles.buttons}>
            <Button onClick={() => setSheet(true)}>Sheet</Button>
            <Button variant="tinted" onClick={() => setAlert(true)}>
              Alert
            </Button>
            <Button variant="plain" onClick={() => setActions(true)}>
              ActionSheet
            </Button>
            <Button
              variant="tinted"
              onClick={() => toast('Usunięto zmianę', () => setLog('cofnięto'))}
            >
              Toast
            </Button>
            <Button destructive variant="tinted">
              Usuń
            </Button>
          </div>
        </GroupedList>

        <GroupedList header="SwipeActions (przesuń w lewo)">
          {!deleted && (
            <SwipeActions
              actions={[
                { label: 'Edytuj', color: 'blue', onAction: () => setLog('edytuj') },
                {
                  label: 'Usuń',
                  color: 'red',
                  onAction: () => {
                    setDeleted(true);
                    toast('Usunięto', () => setDeleted(false));
                  },
                },
              ]}
            >
              <ListRow title="Katarzyna Nowak" subtitle="wt 4 listopada · 10:00–22:00" />
            </SwipeActions>
          )}
          <ListRow title="Jan Kowalski" subtitle="śr 5 listopada · 10:00–22:00" />
        </GroupedList>

        <GroupedList header="ContextMenu (przytrzymaj 450 ms)">
          <ContextMenu
            items={[
              { label: 'Edytuj', onSelect: () => setLog('menu: edytuj') },
              { label: 'Usuń', destructive: true, onSelect: () => setLog('menu: usuń') },
            ]}
          >
            <ListRow title="Przytrzymaj mnie" subtitle="menu kontekstowe" />
          </ContextMenu>
        </GroupedList>

        <GroupedList header="Paleta osób">
          <div className={styles.palette}>
            {PEOPLE.map((c) => (
              <span
                key={c}
                className={styles.dot}
                style={{ background: `var(--p-${c})` }}
                title={c}
              />
            ))}
          </div>
        </GroupedList>

        <GroupedList header="Wynik">
          <ListRow title="Ostatnia akcja" value={<span data-testid="log">{log}</span>} />
        </GroupedList>
        <div style={{ height: 600 }} />
      </Screen>

      <TabBar
        tabs={TABS}
        active={tab}
        onChange={setTab}
        compact={compact}
        action={
          <MenuButton
            label="Dodaj"
            className={`${styles.fab} glass`}
            items={[
              { label: 'Dodaj zmianę', onSelect: () => setLog('fab: dodaj') },
              { label: 'Skanuj grafik', onSelect: () => setLog('fab: skanuj') },
              { label: 'Eksportuj PDF', onSelect: () => setLog('fab: pdf') },
            ]}
          >
            <Plus size={24} strokeWidth={2} />
          </MenuButton>
        }
      />

      <Sheet open={sheet} onClose={() => setSheet(false)} title="Nowa zmiana">
        <GroupedList>
          <ListRow title="Osoba" value="Katarzyna" chevron />
          <ListRow title="Start" value="10:00" />
          <label className={styles.inputRow}>
            <span>Notatka</span>
            <input type="text" placeholder="Opcjonalnie" />
          </label>
        </GroupedList>
        <div className={styles.buttons}>
          <Button onClick={() => setSheet(false)}>Zapisz</Button>
        </div>
      </Sheet>

      <Alert
        open={alert}
        title="Usunąć zmianę?"
        message="Możesz ją przywrócić przyciskiem Cofnij."
        onClose={() => setAlert(false)}
        actions={[
          { label: 'Anuluj', onSelect: () => setLog('alert: anuluj') },
          { label: 'Usuń', destructive: true, onSelect: () => setLog('alert: usuń') },
        ]}
      />
      <ActionSheet
        open={actions}
        title="Co zrobić ze zmianą?"
        onClose={() => setActions(false)}
        actions={[
          { label: 'Edytuj', onSelect: () => setLog('as: edytuj') },
          { label: 'Usuń', destructive: true, onSelect: () => setLog('as: usuń') },
        ]}
      />
    </>
  );
}
