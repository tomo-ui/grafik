import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ISODate } from '../domain/types';
import type { PeriodMode } from '../domain/views';

/** Stan interfejsu konsoli na komputer (nie dane domenowe — te zostają w Dexie, P-18). */
interface PcState {
  mode: PeriodMode;
  /** null = bieżący okres („dziś”) */
  anchor: ISODate | null;
  inspector: boolean;
  hideEmpty: boolean;
  showArchived: boolean;
  /** jednorazowa prośba o akcję po przejściu na stronę (np. otwórz „Dodaj osobę”) */
  intent: 'add-person' | null;
  peopleQuery: string;
  setIntent: (v: PcState['intent']) => void;
  setPeopleQuery: (v: string) => void;
  setMode: (m: PeriodMode) => void;
  setAnchor: (a: ISODate | null) => void;
  setInspector: (v: boolean) => void;
  setHideEmpty: (v: boolean) => void;
  setShowArchived: (v: boolean) => void;
}

export const usePc = create<PcState>()(
  persist(
    (set) => ({
      mode: 'month',
      anchor: null,
      inspector: true,
      hideEmpty: false,
      showArchived: false,
      intent: null,
      peopleQuery: '',
      setIntent: (intent) => set({ intent }),
      setPeopleQuery: (peopleQuery) => set({ peopleQuery }),
      setMode: (mode) => set({ mode }),
      setAnchor: (anchor) => set({ anchor }),
      setInspector: (inspector) => set({ inspector }),
      setHideEmpty: (hideEmpty) => set({ hideEmpty }),
      setShowArchived: (showArchived) => set({ showArchived }),
    }),
    {
      name: 'grafik:pc',
      // intencje i wyszukiwanie żyją tylko w bieżącej sesji
      partialize: ({ mode, anchor, inspector, hideEmpty, showArchived }) => ({
        mode,
        anchor,
        inspector,
        hideEmpty,
        showArchived,
      }),
    },
  ),
);
