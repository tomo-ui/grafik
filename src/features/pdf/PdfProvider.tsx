import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { todayISO } from '../../domain/dates';
import type { Settings } from '../../domain/types';
import { useUi } from '../../store/ui';
import { PdfSheet } from './PdfSheet';

interface Api {
  openPdf: () => void;
}
const Ctx = createContext<Api>({ openPdf: () => {} });
export const usePdfExport = () => useContext(Ctx);

/** Trzyma sheet eksportu; zakres startowy = okres z widoku Zespół (jeśli wybrany) albo bieżący miesiąc. */
export function PdfProvider({ settings, children }: { settings: Settings; children: ReactNode }) {
  const [state, setState] = useState<{
    key: number;
    open: boolean;
    initial?: { kind: 'week' | 'month'; anchor: string };
  }>({ key: 0, open: false });

  const openPdf = useCallback(() => {
    const ui = useUi.getState();
    const today = todayISO();
    const initial =
      ui.teamAnchor !== null
        ? { kind: ui.teamMode, anchor: ui.teamAnchor }
        : { kind: 'month' as const, anchor: today };
    setState((s) => ({ key: s.key + 1, open: true, initial }));
  }, []);

  const api = useMemo(() => ({ openPdf }), [openPdf]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <PdfSheet
        key={state.key}
        open={state.open}
        settings={settings}
        initial={state.initial}
        onClose={() => setState((s) => ({ ...s, open: false }))}
      />
    </Ctx.Provider>
  );
}
