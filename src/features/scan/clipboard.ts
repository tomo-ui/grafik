import { detectPlatform } from '../../app/install';

export type ClipboardResult =
  | { status: 'image'; blob: Blob }
  | { status: 'no-image' } // w schowku jest tekst/link, nie zdjęcie
  | { status: 'unsupported' } // brak navigator.clipboard.read → ścieżka zapasowa
  | { status: 'dismissed' } // iOS: użytkownik zignorował dymek „Wklej” — bez komunikatu
  | { status: 'denied' }; // Android: odmowa uprawnień — instrukcja

/**
 * Przycisk „Wklej ze schowka” (4.3a). P-01: `read()` MUSI być pierwszą asynchroniczną operacją
 * w handlerze kliknięcia — żadnego `await` przed wywołaniem tej funkcji.
 */
export async function readClipboardImage(platform = detectPlatform()): Promise<ClipboardResult> {
  if (!navigator.clipboard?.read) return { status: 'unsupported' };
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) return { status: 'image', blob: await item.getType(type) };
    }
    return { status: 'no-image' };
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) {
      // iOS pokazuje systemowy dymek — zignorowanie go też kończy się NotAllowedError
      return platform === 'ios' ? { status: 'dismissed' } : { status: 'denied' };
    }
    return { status: 'unsupported' };
  }
}

/** Obraz ze zdarzenia `paste` (pole „przytrzymaj i wklej”, Ctrl/Cmd+V). */
export function imageFromClipboardData(dt: DataTransfer | null): Blob | null {
  if (!dt) return null;
  for (const f of Array.from(dt.files)) if (f.type.startsWith('image/')) return f;
  for (const it of Array.from(dt.items)) {
    if (it.kind === 'file' && it.type.startsWith('image/')) return it.getAsFile();
  }
  return null;
}

export const CLIPBOARD_MESSAGES = {
  noImage: 'W schowku nie ma zdjęcia. Skopiuj samo zdjęcie (przytrzymaj → Kopiuj), a nie link.',
  denied:
    'Brak zgody na odczyt schowka. Zezwól na to w ustawieniach witryny (ikona kłódki przy adresie) albo użyj pola „Przytrzymaj tutaj i wybierz Wklej”.',
  iosHint: 'Tapnij „Wklej” w dymku, który się pojawi.',
} as const;
