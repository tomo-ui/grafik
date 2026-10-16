import { lazy, Suspense } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { ToastProvider } from '../ui';
import styles from './App.module.css';

// Katalog komponentów tylko w trybie dev
const UiCatalog = import.meta.env.DEV
  ? lazy(() => import('./UiCatalog').then((m) => ({ default: m.UiCatalog })))
  : null;

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
        <main className={`app-shell ${styles.shell}`}>
          <h1 className={styles.title}>Grafik</h1>
          <p>Szkielet aplikacji działa.</p>
          <label className={styles.field}>
            <span>Pole testowe</span>
            <input type="text" placeholder="Wpisz coś" />
          </label>
        </main>
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
