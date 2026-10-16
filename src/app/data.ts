import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '../db/repos';
import type { Person, Settings } from '../domain/types';

/** Dane domenowe tylko z Dexie (liveQuery) — nie kopiujemy ich do Zustand (P-18). */
export function useSettings(): Settings | undefined {
  return useLiveQuery(() => repos.settings.get(), []);
}

export function usePersons(includeArchived = false): Person[] | undefined {
  return useLiveQuery(() => repos.persons.list({ includeArchived }), [includeArchived]);
}
