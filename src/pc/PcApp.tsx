import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from 'react';
import { registerSW } from 'virtual:pwa-register';
import {
  Archive,
  BarChart3,
  CalendarRange,
  Database,
  FileDown,
  ScanLine,
  Settings as SettingsIcon,
  Users,
} from 'lucide-react';
import { Link, Route, Router, Switch, useLocation } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { applyTheme } from '../app/theme';
import { usePersons, useSettings } from '../app/data';
import { CommandPalette, type Command } from './CommandPalette';
import { OpsProvider, useOps } from './ops';
import { usePc } from './store';
import { ConfirmProvider, Empty, ToastProvider, useToast } from './ui';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- props różnych stron
const lz = <K extends string>(load: () => Promise<Record<K, ComponentType<any>>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const GridPage = lz(() => import('./pages/GridPage'), 'GridPage');
const PeoplePage = lz(() => import('./pages/PeoplePage'), 'PeoplePage');
const HoursPage = lz(() => import('./pages/HoursPage'), 'HoursPage');
const ImportPage = lz(() => import('./pages/ImportPage'), 'ImportPage');
const ExportPage = lz(() => import('./pages/ExportPage'), 'ExportPage');
const DataPage = lz(() => import('./pages/DataPage'), 'DataPage');
const SettingsPage = lz(() => import('./pages/SettingsPage'), 'SettingsPage');

const NAV = [
  { path: '/', label: 'Grafik', icon: CalendarRange, key: '1' },
  { path: '/osoby', label: 'Osoby', icon: Users, key: '2' },
  { path: '/godziny', label: 'Godziny i raporty', icon: BarChart3, key: '3' },
  { path: '/import', label: 'Import ze zdjęcia', icon: ScanLine, key: '4' },
  { path: '/eksport', label: 'Eksport', icon: FileDown, key: '5' },
  { path: '/dane', label: 'Dane i kopie', icon: Database, key: '6' },
  { path: '/ustawienia', label: 'Ustawienia', icon: SettingsIcon, key: '7' },
] as const;

const isTyping = (t: EventTarget | null) =>
  !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');

function Shell() {
  const [location, navigate] = useLocation();
  const settings = useSettings();
  const persons = usePersons(true);
  const ops = useOps();
  const toast = useToast();
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    if (settings) applyTheme(settings.theme);
  }, [settings]);

  // aktualizacja service workera: banner z ręcznym odświeżeniem (nie przerywamy pracy)
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const update = registerSW({
      immediate: true,
      onNeedRefresh: () =>
        toast('Dostępna nowa wersja aplikacji.', {
          label: 'Odśwież',
          run: () => void update(true),
        }),
    });
  }, [toast]);

  const go = useCallback((path: string) => navigate(path), [navigate]);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = NAV.map((n) => ({
      id: `go-${n.path}`,
      label: `Przejdź: ${n.label}`,
      hint: `Alt+${n.key}`,
      run: () => go(n.path),
    }));
    list.push(
      { id: 'undo', label: 'Cofnij ostatnią zmianę', hint: 'Ctrl+Z', run: () => void ops.undo() },
      {
        id: 'redo',
        label: 'Ponów cofniętą zmianę',
        hint: 'Ctrl+Shift+Z',
        run: () => void ops.redo(),
      },
      {
        id: 'add-person',
        label: 'Dodaj osobę',
        run: () => {
          usePc.getState().setIntent('add-person');
          go('/osoby');
        },
      },
      { id: 'backup', label: 'Wykonaj kopię zapasową…', run: () => go('/dane') },
      {
        id: 'theme-dark',
        label: 'Motyw: ciemny',
        run: () =>
          void import('../db/repos').then((m) => m.repos.settings.update({ theme: 'dark' })),
      },
      {
        id: 'theme-light',
        label: 'Motyw: jasny',
        run: () =>
          void import('../db/repos').then((m) => m.repos.settings.update({ theme: 'light' })),
      },
      {
        id: 'theme-system',
        label: 'Motyw: systemowy',
        run: () =>
          void import('../db/repos').then((m) => m.repos.settings.update({ theme: 'system' })),
      },
    );
    for (const p of persons ?? []) {
      list.push({
        id: `person-${p.id}`,
        label: `Osoba: ${[p.firstName, p.lastName].filter(Boolean).join(' ')}`,
        run: () => {
          usePc.getState().setPeopleQuery(p.firstName);
          go('/osoby');
        },
      });
    }
    return list;
  }, [go, ops, persons]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
        return;
      }
      if (e.altKey && !mod) {
        const n = NAV.find((x) => x.key === e.key);
        if (n) {
          e.preventDefault();
          go(n.path);
        }
        return;
      }
      if (isTyping(e.target)) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void (e.shiftKey ? ops.redo() : ops.undo());
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        void ops.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, ops]);

  const route = location;

  return (
    <div className="pc-app">
      <aside className="pc-side">
        <div className="pc-brand">
          <img src="../icons/icon-192.png" alt="" width={28} height={28} />
          Grafik
        </div>
        <nav className="pc-nav" aria-label="Główna nawigacja">
          {NAV.map((n) => (
            <Link key={n.path} href={n.path} aria-current={route === n.path ? 'page' : undefined}>
              <n.icon size={18} aria-hidden />
              {n.label}
              <span className="kbd" aria-hidden>
                Alt+{n.key}
              </span>
            </Link>
          ))}
        </nav>
        <div className="pc-side-foot">
          <button type="button" className="btn" onClick={() => setPalette(true)}>
            Polecenia <span className="kbd">Ctrl+K</span>
          </button>
          <span>
            <Archive size={12} aria-hidden /> Dane są tylko w tej przeglądarce. Przenosisz je kopią
            JSON.
          </span>
          <a href="../">Wersja mobilna</a>
        </div>
      </aside>
      <main className="pc-main">
        <div className="pc-narrow" role="note">
          To okno jest za wąskie — konsola jest projektowana na ekran komputera (min. 1100 px).
        </div>
        <Suspense fallback={<div className="pc-page muted">Ładowanie…</div>}>
          <Switch>
            <Route path="/">
              {settings && persons ? <GridPage settings={settings} /> : <Loading />}
            </Route>
            <Route path="/osoby">{settings ? <PeoplePage /> : <Loading />}</Route>
            <Route path="/godziny">{settings ? <HoursPage /> : <Loading />}</Route>
            <Route path="/import">
              {settings ? <ImportPage settings={settings} /> : <Loading />}
            </Route>
            <Route path="/eksport">
              {settings ? <ExportPage settings={settings} /> : <Loading />}
            </Route>
            <Route path="/dane">{settings ? <DataPage /> : <Loading />}</Route>
            <Route path="/ustawienia">
              {settings ? <SettingsPage settings={settings} /> : <Loading />}
            </Route>
            <Route>
              <div className="pc-page">
                <Empty title="Nie znaleziono strony">
                  <Link href="/">Wróć do grafiku</Link>
                </Empty>
              </div>
            </Route>
          </Switch>
        </Suspense>
      </main>
      {palette && <CommandPalette commands={commands} onClose={() => setPalette(false)} />}
    </div>
  );
}

const Loading = () => <div className="pc-page muted">Ładowanie…</div>;

export function PcApp() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <OpsProvider>
          <Router hook={useHashLocation}>
            <Shell />
          </Router>
        </OpsProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
