import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ISODate } from '../domain/types';
import type { PeriodMode } from '../domain/views';

/**
 * Tylko stan UI (wybrany okres, tryb, filtry). Dane domenowe zostają w Dexie (P-18).
 * Wartości z `persist` przetrwają ponowne uruchomienie (plan 8.3).
 */
interface UiState {
  teamMode: PeriodMode;
  teamView: 'grid' | 'list';
  /** null = bieżący okres („dziś”) */
  teamAnchor: ISODate | null;
  hideEmpty: boolean;
  filterIds: string[];
  /** kalendarz — tylko na czas sesji */
  calMonth: ISODate | null;
  calDay: ISODate | null;

  setTeamMode: (m: PeriodMode, today: ISODate) => void;
  setTeamView: (v: 'grid' | 'list') => void;
  setTeamAnchor: (a: ISODate | null) => void;
  setHideEmpty: (v: boolean) => void;
  toggleFilter: (id: string) => void;
  clearFilter: () => void;
  setCal: (month: ISODate | null, day: ISODate | null) => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      teamMode: 'week',
      teamView: 'grid',
      teamAnchor: null,
      hideEmpty: false,
      filterIds: [],
      calMonth: null,
      calDay: null,

      setTeamMode: (m, today) =>
        set((s) => {
          const base = s.teamAnchor ?? today;
          return {
            teamMode: m,
            // miesiąc: kotwica = 1. dzień; tydzień: dzień z tego miesiąca (dziś, jeśli w nim leży)
            teamAnchor:
              m === 'month'
                ? `${base.slice(0, 7)}-01`
                : today.slice(0, 7) === base.slice(0, 7)
                  ? today
                  : `${base.slice(0, 7)}-01`,
          };
        }),
      setTeamView: (v) => set({ teamView: v }),
      setTeamAnchor: (a) => set({ teamAnchor: a }),
      setHideEmpty: (v) => set({ hideEmpty: v }),
      toggleFilter: (id) =>
        set((s) => ({
          filterIds: s.filterIds.includes(id)
            ? s.filterIds.filter((x) => x !== id)
            : [...s.filterIds, id],
        })),
      clearFilter: () => set({ filterIds: [] }),
      setCal: (month, day) => set({ calMonth: month, calDay: day }),
    }),
    {
      name: 'grafik:ui',
      partialize: (s) => ({
        teamMode: s.teamMode,
        teamView: s.teamView,
        teamAnchor: s.teamAnchor,
        hideEmpty: s.hideEmpty,
        filterIds: s.filterIds,
      }),
    },
  ),
);
