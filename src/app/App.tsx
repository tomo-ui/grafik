import { useRegisterSW } from 'virtual:pwa-register/react';

export function App() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  return (
    <main className="app-shell">
      <h1 className="large-title">Grafik</h1>
      <p>Szkielet aplikacji działa.</p>
      <label className="field">
        <span>Pole testowe</span>
        <input type="text" placeholder="Wpisz coś" />
      </label>
      {needRefresh && (
        <div role="status" className="update-banner">
          Dostępna nowa wersja
          <button type="button" onClick={() => void updateServiceWorker(true)}>
            Odśwież
          </button>
        </div>
      )}
    </main>
  );
}
