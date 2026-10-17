import { useEffect, useRef } from 'react';
import { usePdfExport } from '../features/pdf/PdfProvider';
import { useScan } from '../features/scan/ScanProvider';
import { useShiftEditor } from '../features/shift-editor/ShiftEditorContext';

const SHARE_CACHE = 'grafik-share';
const SHARED_KEY = '/__shared-image';

/** Zdjęcie udostępnione z Androida (service worker zostawia je w Cache API) → Blob. */
async function takeSharedImage(): Promise<Blob | null> {
  try {
    const cache = await caches.open(SHARE_CACHE);
    const res = await cache.match(SHARED_KEY);
    if (!res) return null;
    const blob = await res.blob();
    await cache.delete(SHARED_KEY);
    return blob;
  } catch {
    return null;
  }
}

/**
 * Obsługa parametru `?action=` ze skrótów manifestu i z „Udostępnij” (share_target):
 * scan | add | pdf | shared. Wykonywane raz po starcie, potem URL jest czyszczony.
 */
export function LaunchActions() {
  const { openScan, addBlobs } = useScan();
  const { openAdd } = useShiftEditor();
  const { openPdf } = usePdfExport();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const action = new URLSearchParams(window.location.search).get('action');
    if (!action) return;
    window.history.replaceState(window.history.state, '', window.location.pathname);
    if (action === 'scan') openScan();
    else if (action === 'add') openAdd();
    else if (action === 'pdf') openPdf();
    else if (action === 'shared') {
      void takeSharedImage().then((blob) => {
        if (blob) void addBlobs([blob], 'share');
        else openScan();
      });
    }
  }, [openScan, openAdd, openPdf, addBlobs]);

  return null;
}
