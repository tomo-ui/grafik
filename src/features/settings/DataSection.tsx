import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { ActionSheet, Alert, GroupedList, ListRow, useToast } from '../../ui';
import {
  backupFileName,
  BackupError,
  exportBackup,
  importBackup,
  parseBackup,
  previewBackup,
  type Backup,
} from '../../db/backup';
import { PEOPLE, plural, SHIFTS } from '../../domain/i18n';

type Step = 'closed' | 'confirm' | 'mode';

/** Eksport/import kopii JSON (P-08: przeniesienie danych z Safari do zainstalowanej aplikacji). */
export function DataSection() {
  const toast = useToast();
  const [ready, setReady] = useState<{ file: File; persons: number; shifts: number } | null>(null);
  const [incoming, setIncoming] = useState<Backup | null>(null);
  const [step, setStep] = useState<Step>('closed');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const prepareExport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const b = await exportBackup();
      const file = new File([JSON.stringify(b, null, 2)], backupFileName(), {
        type: 'application/json',
      });
      setReady({ file, persons: b.persons.length, shifts: b.shifts.length });
    } catch {
      toast('Nie udało się przygotować kopii.');
    } finally {
      setBusy(false);
    }
  };

  // P-02: share() bez żadnego await przed wywołaniem — plik jest już gotowy
  const shareReady = () => {
    if (!ready) return;
    const { file } = ready;
    if (navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file], title: 'Kopia Grafik' }).catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return; // zamknięcie arkusza to nie błąd
        toast('Nie udało się udostępnić pliku.');
      });
    } else {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      setIncoming(parseBackup(await f.text()));
      setStep('confirm');
    } catch (e) {
      toast(e instanceof BackupError ? e.message : 'Nie udało się odczytać pliku.');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const doImport = async (mode: 'replace' | 'merge') => {
    if (!incoming || busy) return;
    setBusy(true);
    try {
      const r = await importBackup(incoming, mode);
      toast(
        `Zaimportowano: ${plural(r.persons, PEOPLE)}, ${plural(r.shifts, SHIFTS)}` +
          (r.skipped ? ` (pominięto ${r.skipped})` : ''),
      );
    } catch {
      toast('Import nie powiódł się. Dane nie zostały zmienione.');
    } finally {
      setStep('closed');
      setBusy(false);
    }
  };

  const preview = incoming ? previewBackup(incoming) : null;
  const previewText = preview
    ? `${plural(preview.persons, PEOPLE)}, ${plural(preview.shifts, SHIFTS)} (utworzona ${preview.exportedAt.slice(0, 10)}).`
    : '';

  return (
    <>
      <GroupedList
        header="Dane"
        footer="Dane są zapisane tylko na tym urządzeniu. Rób kopię co kilka tygodni — iOS może wyczyścić dane nieużywanej aplikacji."
      >
        <ListRow
          title="Eksportuj kopię"
          leading={<Download size={22} color="var(--accent)" />}
          onClick={() => void prepareExport()}
        />
        <ListRow
          title="Importuj kopię"
          leading={<Upload size={22} color="var(--accent)" />}
          onClick={() => fileInput.current?.click()}
          last
        />
      </GroupedList>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        data-testid="backup-file"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />

      <Alert
        open={ready !== null}
        title="Kopia gotowa"
        message={
          ready
            ? `${plural(ready.persons, PEOPLE)}, ${plural(ready.shifts, SHIFTS)}. Klucz API nie jest zapisywany w kopii.`
            : ''
        }
        onClose={() => setReady(null)}
        actions={[
          { label: 'Zamknij', onSelect: () => {} },
          { label: 'Zapisz / udostępnij', onSelect: shareReady },
        ]}
      />

      <Alert
        open={incoming !== null && step === 'confirm'}
        title="Zaimportować kopię?"
        message={previewText}
        // Alert woła onClose przed akcją; „Dalej” nadpisuje ten stan na 'mode'
        onClose={() => setStep((s) => (s === 'confirm' ? 'closed' : s))}
        actions={[
          { label: 'Anuluj', onSelect: () => {} },
          { label: 'Dalej', onSelect: () => setStep('mode') },
        ]}
      />
      <ActionSheet
        open={incoming !== null && step === 'mode'}
        title="Jak zaimportować?"
        onClose={() => setStep((s) => (s === 'mode' ? 'closed' : s))}
        actions={[
          { label: 'Scal z obecnymi danymi', onSelect: () => void doImport('merge') },
          { label: 'Zastąp wszystko', destructive: true, onSelect: () => void doImport('replace') },
        ]}
      />
    </>
  );
}
