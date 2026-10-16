import Dexie, { type EntityTable } from 'dexie';
import type { ImportBatch, Person, ScanDraft, Settings, Shift } from '../domain/types';

export class GrafikDB extends Dexie {
  persons!: EntityTable<Person, 'id'>;
  shifts!: EntityTable<Shift, 'id'>;
  importBatches!: EntityTable<ImportBatch, 'id'>;
  scanDrafts!: EntityTable<ScanDraft, 'id'>;
  settings!: EntityTable<Settings, 'id'>;

  constructor(name = 'grafik') {
    super(name);
    // Migracje wersjonowane od początku. Unikalność [personId+date] egzekwuje repozytorium
    // (soft-delete zostawia stare rekordy), nie indeks.
    this.version(1).stores({
      persons: '&id, order, archived, deletedAt',
      shifts: '&id, personId, date, [personId+date], importBatchId, deletedAt',
      importBatches: '&id, createdAt',
      scanDrafts: '&id',
      settings: '&id',
    });
  }
}

export const db = new GrafikDB();

export function uuid(): string {
  return globalThis.crypto.randomUUID();
}

/** Prosi przeglądarkę o trwały magazyn (iOS może czyścić dane nieużywanych stron). */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}
