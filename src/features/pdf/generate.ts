import type { TDocumentDefinitions } from 'pdfmake/interfaces';

/**
 * Generowanie PDF w przeglądarce. pdfmake i czcionki ładowane leniwie (dynamiczny import przy
 * pierwszym eksporcie), żeby nie obciążać startu aplikacji (plan 9). Czcionki są w precache SW.
 */

type PdfMakeApi = {
  addVirtualFileSystem: (vfs: Record<string, string>) => void;
  addFonts: (fonts: Record<string, Record<string, string>>) => void;
  createPdf: (doc: TDocumentDefinitions) => { getBlob: () => Promise<Blob> };
};

let ready: Promise<PdfMakeApi> | null = null;

const toBase64 = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
};

async function fetchFont(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Nie udało się wczytać czcionki (${res.status})`);
  return toBase64(await res.arrayBuffer());
}

async function init(): Promise<PdfMakeApi> {
  const [mod, regular, bold] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('../../assets/fonts/Inter-Regular.ttf?url').then((m) => fetchFont(m.default)),
    import('../../assets/fonts/Inter-Bold.ttf?url').then((m) => fetchFont(m.default)),
  ]);
  const pdfMake = ((mod as { default?: unknown }).default ?? mod) as unknown as PdfMakeApi;
  pdfMake.addVirtualFileSystem({ 'Inter-Regular.ttf': regular, 'Inter-Bold.ttf': bold });
  pdfMake.addFonts({
    Inter: {
      normal: 'Inter-Regular.ttf',
      bold: 'Inter-Bold.ttf',
      italics: 'Inter-Regular.ttf',
      bolditalics: 'Inter-Bold.ttf',
    },
  });
  return pdfMake;
}

/** Definicja dokumentu → Blob `application/pdf`. Błąd inicjalizacji pozwala ponowić próbę. */
export async function generatePdfBlob(doc: TDocumentDefinitions): Promise<Blob> {
  ready ??= init().catch((e) => {
    ready = null;
    throw e;
  });
  const pdfMake = await ready;
  const blob = await pdfMake.createPdf(doc).getBlob();
  return blob.type === 'application/pdf' ? blob : new Blob([blob], { type: 'application/pdf' });
}
