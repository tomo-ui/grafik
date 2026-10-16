/**
 * Podgląd PDF wewnątrz aplikacji (P-03): strony renderowane przez pdf.js do obrazów.
 * Dzięki temu w PWA na iOS nie otwieramy blob URL-a, z którego nie ma wyjścia.
 * pdf.js ładowany leniwie — tylko przy otwarciu podglądu.
 */
export interface PreviewPage {
  url: string; // object URL obrazu strony — zwolnić przez revokePreview
  width: number;
  height: number;
}

export async function renderPdfPages(
  blob: Blob,
  opts: { maxWidth?: number; maxPages?: number } = {},
) {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const data = new Uint8Array(await blob.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const pdf = await task.promise;
  const pages: PreviewPage[] = [];
  try {
    const total = Math.min(pdf.numPages, opts.maxPages ?? 12);
    const targetWidth = (opts.maxWidth ?? 900) * Math.min(2, window.devicePixelRatio || 1);
    for (let i = 1; i <= total; i++) {
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: targetWidth / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const img = await new Promise<Blob>((res, rej) =>
        canvas.toBlob(
          (b) => (b ? res(b) : rej(new Error('Nie udało się wyrenderować strony'))),
          'image/jpeg',
          0.85,
        ),
      );
      pages.push({ url: URL.createObjectURL(img), width: canvas.width, height: canvas.height });
    }
    return { pages, totalPages: pdf.numPages };
  } finally {
    void task.destroy();
  }
}

export function revokePreview(pages: PreviewPage[]) {
  for (const p of pages) URL.revokeObjectURL(p.url);
}
