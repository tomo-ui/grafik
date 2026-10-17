/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, readFileSync } from 'node:fs';
import { VitePWA } from 'vite-plugin-pwa';

// Hosting: Vercel (korzeń domeny, baza „/”); BASE_PATH pozwala zbudować pod podkatalogiem
const base = process.env.BASE_PATH ?? '/';
// Jedna polityka CSP: nagłówek w podglądzie/testach i vercel.json, <meta> w buildzie (działa na każdym hostingu)
const CSP = readFileSync('config/csp.txt', 'utf8').trim();

const hostingPlugin = (): Plugin => ({
  name: 'grafik-hosting',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
      injectTo: 'head-prepend',
    },
  ],
  // SPA na hostingach bez przepisań: nieznane ścieżki dostają 404.html = ta sama aplikacja
  closeBundle() {
    copyFileSync('dist/index.html', 'dist/404.html');
  },
});

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0') },
  plugins: [
    react(),
    hostingPlugin(),
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
        start_url: base,
        scope: base,
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
            url: `${base}?action=scan`,
            icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Dodaj zmianę',
            short_name: 'Dodaj',
            url: `${base}?action=add`,
            icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Eksportuj PDF',
            short_name: 'PDF',
            url: `${base}?action=pdf`,
            icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
        // Android: „Udostępnij” zdjęcie z galerii → prosto do skanowania
        share_target: {
          action: `${base}share-target`,
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { files: [{ name: 'image', accept: ['image/*'] }] },
        },
      },
    }),
  ],
  preview: { headers: { 'Content-Security-Policy': CSP } },
  test: { environment: 'jsdom', include: ['tests/unit/**/*.test.{ts,tsx}'] },
});
