import { requestPersistence } from './db';
import { repos } from './repos';

/** Start aplikacji: trwały magazyn + sprzątanie starych rekordów soft-delete. Błędy nie blokują UI. */
export async function initStorage(): Promise<void> {
  await requestPersistence();
  try {
    await repos.shifts.purgeOld();
  } catch (e) {
    console.error('Nie udało się wyczyścić starych rekordów', e);
  }
}
