import { lazy, Suspense, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { CalendarDays, Settings as SettingsIcon, UserRound, Users } from 'lucide-react';
import { Route, Switch, useLocation } from 'wouter';
import { Plus } from 'lucide-react';
import { MenuButton, Screen, TabBar, ToastProvider, type Tab } from '../ui';
import { ShiftEditorProvider, useShiftEditor } from '../features/shift-editor/ShiftEditorContext';
import { TeamScreen } from '../features/team/TeamScreen';
import { MySchedule } from '../features/my-schedule/MySchedule';
import { CalendarView } from '../features/calendar/CalendarView';
import { Onboarding } from '../features/onboarding/Onboarding';
import { SettingsHome } from '../features/settings/SettingsHome';
import { PeopleScreen } from '../features/settings/PeopleScreen';
import { HoursScreen } from '../features/settings/HoursScreen';
import { AiSettings } from '../features/settings/AiSettings';
import { ImportHistory } from '../features/settings/ImportHistory';
import { ScanProvider, useScan } from '../features/scan/ScanProvider';
import { PdfProvider, usePdfExport } from '../features/pdf/PdfProvider';
import { useSettings } from './data';
import { useTheme } from './theme';
import styles from './App.module.css';

// Katalog komponentów tylko w trybie dev
const UiCatalog = import.meta.env.DEV
  ? lazy(() => import('./UiCatalog').then((m) => ({ default: m.UiCatalog })))
  : null;

const TABS: (Tab & { path: string })[] = [
  { id: 'me', path: '/', label: 'Mój grafik', icon: <UserRound size={22} strokeWidth={1.75} /> },
  { id: 'team', path: '/team', label: 'Zespół', icon: <Users size={22} strokeWidth={1.75} /> },
  {
    id: 'calendar',
    path: '/calendar',
    label: 'Kalendarz',
    icon: <CalendarDays size={22} strokeWidth={1.75} />,
  },
  {
    id: 'settings',
    path: '/settings',
    label: 'Ustawienia',
    icon: <SettingsIcon size={22} strokeWidth={1.75} />,
  },
];

function Placeholder({ title, text }: { title: string; text: string }) {
  return (
    <Screen title={title}>
      <p className={styles.placeholder}>{text}</p>
    </Screen>
  );
}

function Fab() {
  const { openAdd } = useShiftEditor();
  const { openScan } = useScan();
  const { openPdf } = usePdfExport();
  return (
    <MenuButton
      label="Dodaj"
      className={`${styles.fab} glass`}
      items={[
        { label: 'Dodaj zmianę', onSelect: () => openAdd() },
        { label: 'Skanuj grafik', onSelect: () => openScan() },
        { label: 'Eksportuj PDF', onSelect: () => openPdf() },
      ]}
    >
      <Plus size={26} strokeWidth={2} />
    </MenuButton>
  );
}

function Shell() {
  const settings = useSettings();
  const [location, navigate] = useLocation();
  const [compact, setCompact] = useState(false);
  useTheme(settings?.theme);

  if (!settings) return null; // krótka chwila na odczyt z IndexedDB
  if (!settings.onboardingDone) return <Onboarding />;

  const isSub = location.startsWith('/settings/');
  const active = TABS.find((t) =>
    t.path === '/' ? location === '/' : location.startsWith(t.path),
  );

  return (
    <ShiftEditorProvider settings={settings}>
      <ScanProvider settings={settings}>
        <PdfProvider settings={settings}>
          <Switch>
            <Route path="/">
              <MySchedule settings={settings} />
            </Route>
            <Route path="/team">
              <TeamScreen settings={settings} />
            </Route>
            <Route path="/calendar">
              <CalendarView settings={settings} />
            </Route>
            <Route path="/settings">
              <SettingsHome settings={settings} />
            </Route>
            <Route path="/settings/people">
              <PeopleScreen />
            </Route>
            <Route path="/settings/hours">
              <HoursScreen />
            </Route>
            <Route path="/settings/ai">
              <AiSettings />
            </Route>
            <Route path="/settings/imports">
              <ImportHistory />
            </Route>
            <Route>
              <Placeholder title="Nie znaleziono" text="Ta strona nie istnieje." />
            </Route>
          </Switch>
          {!isSub && (
            <TabBar
              tabs={TABS}
              active={active?.id ?? 'me'}
              compact={compact}
              action={<Fab />}
              onChange={(id) => {
                setCompact(false);
                navigate(TABS.find((t) => t.id === id)?.path ?? '/');
              }}
            />
          )}
        </PdfProvider>
      </ScanProvider>
    </ShiftEditorProvider>
  );
}

export function App() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  const isCatalog = import.meta.env.DEV && window.location.pathname === '/_dev/ui';

  return (
    <ToastProvider>
      {isCatalog && UiCatalog ? (
        <Suspense fallback={null}>
          <UiCatalog />
        </Suspense>
      ) : (
        <Shell />
      )}
      {needRefresh && (
        <div role="status" className={`${styles.banner} glass`}>
          Dostępna nowa wersja
          <button type="button" onClick={() => void updateServiceWorker(true)}>
            Odśwież
          </button>
        </div>
      )}
    </ToastProvider>
  );
}
