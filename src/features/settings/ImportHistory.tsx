import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronLeft } from 'lucide-react';
import { useLocation } from 'wouter';
import { Alert, GroupedList, ListRow, Screen, useToast } from '../../ui';
import { repos } from '../../db/repos';
import { plural, SHIFTS } from '../../domain/i18n';
import type { ImportBatch } from '../../domain/types';
import styles from './Settings.module.css';

const when = (t: number) =>
  new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(t));

/** Ustawienia → Historia importów AI, z wycofaniem całego importu (przywraca też zastąpione zmiany). */
export function ImportHistory() {
  const [, navigate] = useLocation();
  const toast = useToast();
  const batches = useLiveQuery(() => repos.imports.list(), []);
  const [target, setTarget] = useState<ImportBatch | null>(null);

  const revert = async (b: ImportBatch) => {
    try {
      const r = await repos.imports.revert(b.id);
      toast(
        `Wycofano import: usunięto ${plural(r.removed, SHIFTS)}` +
          (r.restored ? `, przywrócono ${r.restored}` : '') +
          (r.notRestored ? ` (nie przywrócono ${r.notRestored} — miejsce zajęte)` : ''),
      );
    } catch {
      toast('Nie udało się wycofać importu.');
    }
  };

  return (
    <Screen
      title="Historia importów"
      leading={
        <button type="button" className={styles.backBtn} onClick={() => navigate('/settings')}>
          <ChevronLeft size={22} /> Wróć
        </button>
      }
    >
      {batches && batches.length === 0 ? (
        <p className={styles.note}>Nie było jeszcze żadnych importów ze zdjęcia.</p>
      ) : (
        <GroupedList footer="Wycofanie usuwa zmiany z danego importu i przywraca te, które import zastąpił. Osoby utworzone podczas importu zostają.">
          {(batches ?? []).map((b, i, arr) => (
            <ListRow
              key={b.id}
              title={when(b.createdAt)}
              subtitle={
                b.revertedAt
                  ? `Wycofany · ${plural(b.shiftIds.length, SHIFTS)}`
                  : `${plural(b.shiftIds.length, SHIFTS)}${
                      b.replacedShifts.length ? ` · zastąpiono ${b.replacedShifts.length}` : ''
                    }`
              }
              leading={
                b.imageThumb ? (
                  <img
                    src={b.imageThumb}
                    alt=""
                    style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover' }}
                  />
                ) : undefined
              }
              trailing={
                b.revertedAt ? undefined : (
                  <button
                    type="button"
                    className={styles.revertBtn}
                    aria-label={`Wycofaj import z ${when(b.createdAt)}`}
                    onClick={() => setTarget(b)}
                  >
                    Wycofaj
                  </button>
                )
              }
              last={i === arr.length - 1}
            />
          ))}
        </GroupedList>
      )}
      <Alert
        open={target !== null}
        title="Wycofać import?"
        message="Zmiany z tego importu znikną, a zastąpione wcześniej zmiany wrócą."
        onClose={() => setTarget(null)}
        actions={[
          { label: 'Anuluj', onSelect: () => {} },
          { label: 'Wycofaj', destructive: true, onSelect: () => target && void revert(target) },
        ]}
      />
    </Screen>
  );
}
