// Generowanie i odczyt PDF po stronie Node (testy, próbki) — te same definicje dokumentów co w aplikacji.
import { createRequire } from 'node:module';
import path from 'node:path';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';

const require = createRequire(import.meta.url);
// pdfmake 0.3 (CJS, singleton) — wersja serwerowa czyta czcionki z dysku
const pdfmake = require('pdfmake') as {
  addFonts: (f: Record<string, Record<string, string>>) => void;
  createPdf: (d: TDocumentDefinitions) => { getBuffer: () => Promise<Buffer> };
  setLocalAccessPolicy?: (cb: (p: string) => boolean) => void;
};

const dir = path.resolve('src/assets/fonts');
pdfmake.addFonts({
  Inter: {
    normal: path.join(dir, 'Inter-Regular.ttf'),
    bold: path.join(dir, 'Inter-Bold.ttf'),
    italics: path.join(dir, 'Inter-Regular.ttf'),
    bolditalics: path.join(dir, 'Inter-Bold.ttf'),
  },
});

export async function toPdfBuffer(doc: TDocumentDefinitions): Promise<Buffer> {
  return pdfmake.createPdf(doc).getBuffer();
}

export interface PdfText {
  pages: string[];
  numPages: number;
}

/** Tekst każdej strony wyciągnięty przez pdf.js (sprawdza, że glify i ToUnicode są poprawne). */
export async function extractText(buf: Buffer | Uint8Array): Promise<PdfText> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: false,
    verbosity: 0,
  });
  const pdf = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    pages.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  const numPages = pdf.numPages;
  await task.destroy();
  return { pages, numPages };
}

/** Wszystkie rozmiary czcionek ustawione w definicji dokumentu (do kontroli minimum 7,5 pt). */
export function collectFontSizes(node: unknown, out: number[] = []): number[] {
  if (Array.isArray(node)) node.forEach((n) => collectFontSizes(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'fontSize' && typeof v === 'number') out.push(v);
      else if (typeof v !== 'function') collectFontSizes(v, out);
    }
  }
  return out;
}
