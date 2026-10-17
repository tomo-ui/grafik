import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, Upload } from 'lucide-react';
import { db } from '../../db/db';
import { repos } from '../../db/repos';
import { PEOPLE, plural, SHIFTS } from '../../domain/i18n';
import { shiftLabel } from '../../domain/labels';
import { fullName } from '../../domain/people';
import type { Person, Shift } from '../../domain/types';
import { downloadBlob, Modal, useConfirm, useToast } from '../ui';

type BackupMod = typeof import('../../db/backup');
let backupMod: Promise<BackupMod> | null = null;
const loadBackup = () => (backupMod ??= import('../../db/backup'));

const fmt = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });
const mb = (n: number) =>
  `${(n / 1024 / 1024).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} MB`;

export function DataPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [incoming, setIncoming] = useState<Awaited<ReturnType<BackupMod['parseBackup']>> | null>(
    null,
  );
  const [persisted, setPersisted] = useState<boolean | null>(null);

  const stats = useLiveQuery(async () => {
    const [persons, shifts, deletedShifts, deletedPersons, batches] = await Promise.all([
      db.persons.filter((p) => !p.deletedAt).count(),
      db.shifts.filter((s) => !s.deletedAt).count(),
      db.shifts.filter((s) => !!s.deletedAt).count(),
      db.persons.filter((p) => !!p.deletedAt).count(),
      db.importBatches.count(),
    ]);
    let usage: number | undefined;
    try {
      usage = (await navigator.storage?.estimate?.())?.usage;
    } catch {
      /* brak API */
    }
    try {
      setPersisted((await navigator.storage?.persisted?.()) ?? null);
    } catch {
      /* brak API */
    }
    return { persons, shifts, deletedShifts, deletedPersons, batches, usage };
  }, []);

  const batches = useLiveQuery(() => repos.imports.list(), []);
  const trashShifts = useLiveQuery(() => db.shifts.filter((s) => !!s.deletedAt).toArray(), []);
  const trashPersons = useLiveQuery(() => db.persons.filter((p) => !!p.deletedAt).toArray(), []);
  const allPersons = useLiveQuery(() => db.persons.toArray(), []);
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of allPersons ?? []) m.set(p.id, fullName(p));
    return (id: string) => m.get(id) ?? '(nieznana osoba)';
  }, [allPersons]);

  /* ---------------------------------------------------------------- kopie */
  const exportNow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { exportBackup, backupFileName } = await loadBackup();
      const b = await exportBackup();
      downloadBlob(
        new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' }),
        backupFileName(),
      );
      toast(
        `Zapisano kopię: ${plural(b.persons.length, PEOPLE)}, ${plural(b.shifts.length, SHIFTS)}. Klucz API nie jest w kopii.`,
      );
    } catch {
      toast('Nie udało się przygotować kopii.');
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const { parseBackup, BackupError } = await loadBackup();
      try {
        setIncoming(parseBackup(await f.text()));
      } catch (e) {
        toast(e instanceof BackupError ? e.message : 'Nie udało się odczytać pliku.');
      }
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const doImport = async (mode: 'replace' | 'merge') => {
    if (!incoming || busy) return;
    if (mode === 'replace') {
      const ok = await confirm({
        title: 'Zastąpić wszystkie dane kopią?',
        message:
          'Obecne osoby i zmiany zostaną usunięte (z wyjątkiem klucza API). Zrób najpierw kopię obecnych danych, jeśli są potrzebne.',
        confirmLabel: 'Zastąp dane',
        danger: true,
        requireText: 'ZASTĄP',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const { importBackup } = await loadBackup();
      const r = await importBackup(incoming, mode);
      toast(
        `Zaimportowano: ${plural(r.persons, PEOPLE)}, ${plural(r.shifts, SHIFTS)}${r.skipped ? ` (pominięto ${r.skipped})` : ''}`,
      );
      setIncoming(null);
    } catch {
      toast('Import nie powiódł się. Dane nie zostały zmienione.');
    } finally {
      setBusy(false);
    }
  };

  /* --------------------------------------------------------- historia importów */
  const revert = async (id: string) => {
    const ok = await confirm({
      title: 'Wycofać ten import?',
      message: 'Zaimportowane zmiany znikną, a zastąpione wcześniej wrócą na swoje miejsce.',
      confirmLabel: 'Wycofaj',
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await repos.imports.revert(id);
      toast(
        `Wycofano: usunięto ${r.removed}, przywrócono ${r.restored}${r.notRestored ? `, nie przywrócono ${r.notRestored} (miejsce zajęte)` : ''}.`,
      );
    } catch {
      toast('Nie udało się wycofać importu.');
    }
  };

  /* -------------------------------------------------------------------- kosz */
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const trash = useMemo(
    () => [...(trashShifts ?? [])].sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
    [trashShifts],
  );
  const restoreShifts = async (ids: string[]) => {
    try {
      await repos.shifts.restore(ids);
      setChecked(new Set());
      toast(`Przywrócono ${plural(ids.length, SHIFTS)}.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Nie udało się przywrócić.');
    }
  };
  const restorePerson = async (p: Person) => {
    const ids = (trashShifts ?? [])
      .filter((s) => s.personId === p.id && s.deletedAt === p.deletedAt)
      .map((s) => s.id);
    try {
      await repos.persons.restore(p.id, { at: p.deletedAt ?? 0, shiftIds: ids });
      toast(`Przywrócono osobę ${fullName(p)} i ${plural(ids.length, SHIFTS)}.`);
    } catch {
      toast('Nie udało się przywrócić osoby.');
    }
  };
  const purge = async (shiftIds: string[], personIds: string[]) => {
    const ok = await confirm({
      title: 'Usunąć na zawsze?',
      message: `Zostanie trwale usuniętych: ${plural(shiftIds.length, SHIFTS)} i ${plural(personIds.length, PEOPLE)}. Tego nie da się cofnąć.`,
      confirmLabel: 'Usuń na zawsze',
      danger: true,
    });
    if (!ok) return;
    try {
      await db.transaction('rw', db.shifts, db.persons, async () => {
        await db.shifts.bulkDelete(shiftIds);
        await db.persons.bulkDelete(personIds);
      });
      setChecked(new Set());
      toast('Usunięto na zawsze.');
    } catch {
      toast('Nie udało się usunąć.');
    }
  };

  /* ------------------------------------------------------------ strefa ryzyka */
  const wipe = async () => {
    const ok = await confirm({
      title: 'Usunąć wszystkie dane grafiku?',
      message:
        'Osoby, zmiany, historia importów i szkice zostaną trwale usunięte z tej przeglądarki. Ustawienia (w tym klucz API) zostają.',
      confirmLabel: 'Usuń wszystko',
      danger: true,
      requireText: 'USUŃ',
    });
    if (!ok) return;
    try {
      await db.transaction(
        'rw',
        db.persons,
        db.shifts,
        db.importBatches,
        db.scanDrafts,
        async () => {
          await Promise.all([
            db.persons.clear(),
            db.shifts.clear(),
            db.importBatches.clear(),
            db.scanDrafts.clear(),
          ]);
        },
      );
      toast('Usunięto wszystkie dane.');
    } catch {
      toast('Nie udało się usunąć danych.');
    }
  };

  const persist = async () => {
    try {
      const ok = (await navigator.storage?.persist?.()) ?? false;
      setPersisted(ok);
      toast(
        ok ? 'Przeglądarka zapewni trwały magazyn.' : 'Przeglądarka odmówiła trwałego magazynu.',
      );
    } catch {
      toast('Ta przeglądarka nie obsługuje trwałego magazynu.');
    }
  };

  return (
    <>
      <div className="pc-head">
        <h1>Dane i kopie</h1>
        <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
          <Upload size={15} aria-hidden /> Wczytaj kopię…
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          onClick={() => void exportNow()}
        >
          <Download size={15} aria-hidden /> Pobierz kopię JSON
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="Plik kopii zapasowej"
          data-testid="backup-file"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </div>
      <div className="pc-page">
        <section className="card" style={{ marginTop: 0 }} aria-label="Stan danych">
          <h2>Stan danych w tej przeglądarce</h2>
          {stats && (
            <div className="row" style={{ gap: 28 }}>
              <div>
                <b>{stats.persons}</b>
                <br />
                <span className="muted">osób</span>
              </div>
              <div>
                <b>{stats.shifts}</b>
                <br />
                <span className="muted">zmian</span>
              </div>
              <div>
                <b>{stats.deletedShifts + stats.deletedPersons}</b>
                <br />
                <span className="muted">w koszu</span>
              </div>
              <div>
                <b>{stats.batches}</b>
                <br />
                <span className="muted">importów AI</span>
              </div>
              {stats.usage !== undefined && (
                <div>
                  <b>{mb(stats.usage)}</b>
                  <br />
                  <span className="muted">zajęte miejsce</span>
                </div>
              )}
              <div>
                <b>{persisted === null ? '—' : persisted ? 'tak' : 'nie'}</b>
                <br />
                <span className="muted">trwały magazyn</span>
              </div>
            </div>
          )}
          {persisted === false && (
            <p>
              <button type="button" className="btn sm" onClick={() => void persist()}>
                Poproś o trwały magazyn
              </button>{' '}
              <span className="muted">
                Chroni dane przed automatycznym czyszczeniem przez przeglądarkę.
              </span>
            </p>
          )}
          <p className="muted" style={{ margin: '10px 0 0' }}>
            Dane są przechowywane tylko lokalnie (IndexedDB), osobno w każdej przeglądarce i na
            każdym urządzeniu. Aby przenieść grafik między komputerem a telefonem, pobierz kopię
            JSON i wczytaj ją w drugim miejscu (klucz API nie jest w kopii).
          </p>
        </section>

        <section className="card" aria-label="Historia importów">
          <h2>Historia importów ze zdjęć</h2>
          {!batches || batches.length === 0 ? (
            <p className="muted">Nie było jeszcze żadnego importu.</p>
          ) : (
            <div className="table-wrap">
              <table className="table" aria-label="Importy AI">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Model</th>
                    <th className="num">Zmian</th>
                    <th className="num">Zastąpiono</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id}>
                      <td>{fmt.format(b.createdAt)}</td>
                      <td>{b.model}</td>
                      <td className="num">{b.shiftIds.length}</td>
                      <td className="num">{b.replacedShifts.length}</td>
                      <td>
                        {b.revertedAt ? (
                          <span className="badge warn">wycofany</span>
                        ) : (
                          <span className="badge ok">aktywny</span>
                        )}
                      </td>
                      <td>
                        {!b.revertedAt && (
                          <button
                            type="button"
                            className="btn sm danger"
                            onClick={() => void revert(b.id)}
                          >
                            Wycofaj
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card" aria-label="Kosz">
          <div className="row">
            <h2 style={{ margin: 0 }}>Kosz (usunięte w ostatnich 30 dniach)</h2>
            <span className="grow" />
            <button
              type="button"
              className="btn sm"
              disabled={checked.size === 0}
              onClick={() => void restoreShifts([...checked])}
            >
              Przywróć zaznaczone
            </button>
            <button
              type="button"
              className="btn sm danger"
              disabled={trash.length + (trashPersons?.length ?? 0) === 0}
              onClick={() =>
                void purge(
                  trash.map((s) => s.id),
                  (trashPersons ?? []).map((p) => p.id),
                )
              }
            >
              Opróżnij kosz
            </button>
          </div>
          {(trashPersons ?? []).length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="label">Usunięte osoby</div>
              {trashPersons!.map((p) => (
                <div key={p.id} className="row" style={{ padding: '4px 0' }}>
                  <b>{fullName(p)}</b>
                  <span className="muted">
                    usunięto {p.deletedAt ? fmt.format(p.deletedAt) : ''}
                  </span>
                  <button type="button" className="btn sm" onClick={() => void restorePerson(p)}>
                    Przywróć z jej zmianami
                  </button>
                </div>
              ))}
            </div>
          )}
          {trash.length === 0 && (trashPersons ?? []).length === 0 ? (
            <p className="muted">Kosz jest pusty.</p>
          ) : (
            trash.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 10, maxHeight: 340 }}>
                <table className="table" aria-label="Usunięte zmiany">
                  <thead>
                    <tr>
                      <th style={{ width: 34 }}>
                        <input
                          type="checkbox"
                          aria-label="Zaznacz wszystkie usunięte zmiany"
                          checked={trash.length > 0 && trash.every((s) => checked.has(s.id))}
                          onChange={(e) =>
                            setChecked(
                              e.target.checked ? new Set(trash.map((s) => s.id)) : new Set(),
                            )
                          }
                        />
                      </th>
                      <th>Osoba</th>
                      <th>Data</th>
                      <th>Zmiana</th>
                      <th>Usunięto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trash.slice(0, 300).map((s: Shift) => (
                      <tr key={s.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Zaznacz: ${nameOf(s.personId)} ${s.date}`}
                            checked={checked.has(s.id)}
                            onChange={(e) => {
                              const n = new Set(checked);
                              if (e.target.checked) n.add(s.id);
                              else n.delete(s.id);
                              setChecked(n);
                            }}
                          />
                        </td>
                        <td>{nameOf(s.personId)}</td>
                        <td>{s.date}</td>
                        <td>{shiftLabel(s)}</td>
                        <td>{s.deletedAt ? fmt.format(s.deletedAt) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
          {trash.length > 300 && (
            <p className="muted">Pokazano 300 najnowszych z {trash.length}.</p>
          )}
        </section>

        <section
          className="card"
          aria-label="Strefa ryzyka"
          style={{ borderColor: 'var(--danger)' }}
        >
          <h2>Strefa ryzyka</h2>
          <p className="muted">
            Usuwa osoby, zmiany, historię importów i szkice z tej przeglądarki. Zrób najpierw kopię.
          </p>
          <button type="button" className="btn danger" onClick={() => void wipe()}>
            Usuń wszystkie dane…
          </button>
        </section>
      </div>

      {incoming && (
        <Modal
          title="Wczytać kopię zapasową?"
          onClose={() => setIncoming(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setIncoming(null)}>
                Anuluj
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void doImport('merge')}
              >
                Scal z obecnymi
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={busy}
                onClick={() => void doImport('replace')}
              >
                Zastąp wszystko
              </button>
            </>
          }
        >
          <p>
            Kopia z {fmt.format(new Date(incoming.exportedAt))}:{' '}
            <b>{plural(incoming.persons.length, PEOPLE)}</b>,{' '}
            <b>{plural(incoming.shifts.length, SHIFTS)}</b>.
          </p>
          <p className="muted">
            <b>Scal</b> dodaje i aktualizuje rekordy, nie tworząc duplikatów osoba+dzień.{' '}
            <b>Zastąp</b> usuwa obecne dane i wgrywa kopię.
          </p>
        </Modal>
      )}
    </>
  );
}
