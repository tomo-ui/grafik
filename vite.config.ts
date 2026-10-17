/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { VitePWA } from 'vite-plugin-pwa';

// Nagłówki z public/_headers (blok „/*”) — podgląd i testy e2e działają pod tą samą CSP co hosting
function globalHeaders(): Record<string, string> {
  const out: Record<string, string> = {};
  let inGlobal = false;
  for (const line of readFileSync('public/_headers', 'utf8').split(/\r?\n/)) {
    if (line.startsWith('#') || !line.trim()) continue;
    if (!line.startsWith(' ')) {
      inGlobal = line.trim() === '/*';
      continue;
    }
    const i = line.indexOf(':');
    if (inGlobal && i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0') },
  plugins: [
    react(),
    VitePWA({
      // własny service worker (src/sw.ts): precache + NetworkOnly dla AI + odbiór zdjęcia z Androida
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // P-09: skipWaiting dopiero po akceptacji użytkownika (banner aktualizacji)
      registerType: 'prompt',
      includeAssets: ['icons/apple-touch-icon.png'],
      injectManifest: {
        // czcionki PDF (ttf) i worker pdf.js (mjs) w precache — eksport i podgląd działają offline;
        // splash screeny iOS pobiera tylko system, nie trzymamy ich w precache
        globPatterns: ['**/*.{js,mjs,css,html,png,svg,woff2,ttf}'],
        globIgnores: ['splash/**'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      manifest: {
        name: 'Grafik',
        short_name: 'Grafik',
        description: 'Grafik pracy zespołu: ręcznie, ze zdjęcia, z eksportem do PDF.',
        lang: 'pl',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        theme_color: '#f2f2f7',
        background_color: '#f2f2f7',
        categories: ['productivity', 'business'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          {
            name: 'Skanuj grafik',
            short_name: 'Skanuj',
            url: '/?action=scan',
            icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Dodaj zmianę',
            short_name: 'Dodaj',
            url: '/?action=add',
            icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Eksportuj PDF',
            short_name: 'PDF',
            url: '/?action=pdf',
            icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
        // Android: „Udostępnij” zdjęcie z galerii → prosto do skanowania
        share_target: {
          action: '/share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { files: [{ name: 'image', accept: ['image/*'] }] },
        },
      },
    }),
  ],
  preview: { headers: globalHeaders() },
  test: { environment: 'jsdom', include: ['tests/unit/**/*.test.{ts,tsx}'] },
});
