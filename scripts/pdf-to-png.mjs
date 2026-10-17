// Rasteryzuje PDF-y do PNG (Playwright + pdf.js) — do obejrzenia próbek: node scripts/pdf-to-png.mjs plik.pdf ...
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Użycie: node scripts/pdf-to-png.mjs plik.pdf [...]');
  process.exit(1);
}
const outDir = 'docs/pdf-samples/png';
mkdirSync(outDir, { recursive: true });

const pdfjs = 'node_modules/pdfjs-dist/build';
const html = `<!doctype html><body style="margin:0"><canvas id="c"></canvas><script type="module">
import * as pdfjs from '/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
let doc;
window.load = async () => { doc = await pdfjs.getDocument({ url: '/file.pdf' }).promise; return doc.numPages; };
window.render = async (n, scale) => {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale });
  const c = document.getElementById('c');
  c.width = vp.width; c.height = vp.height;
  await page.render({ canvas: c, viewport: vp }).promise;
  return c.toDataURL('image/png');
};
window.ready = true;
</script></body>`;

const browser = await chromium.launch();
let current = '';
const page = await browser.newPage();
await page.route('http://pdf.local/**', async (route) => {
  const p = new URL(route.request().url()).pathname;
  if (p === '/') return route.fulfill({ contentType: 'text/html', body: html });
  if (p === '/pdf.mjs')
    return route.fulfill({
      contentType: 'text/javascript',
      body: readFileSync(`${pdfjs}/pdf.mjs`),
    });
  if (p === '/pdf.worker.mjs')
    return route.fulfill({
      contentType: 'text/javascript',
      body: readFileSync(`${pdfjs}/pdf.worker.mjs`),
    });
  if (p === '/file.pdf')
    return route.fulfill({ contentType: 'application/pdf', body: readFileSync(current) });
  return route.abort();
});
for (const f of files) {
  current = f;
  await page.goto('http://pdf.local/');
  await page.waitForFunction(() => window.ready);
  const n = await page.evaluate(() => window.load());
  for (let i = 1; i <= n; i++) {
    const url = await page.evaluate(([i]) => window.render(i, 1.6), [i]);
    const out = path.join(outDir, `${path.basename(f, '.pdf')}-p${i}.png`);
    writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
    console.log(out);
  }
}
await browser.close();
