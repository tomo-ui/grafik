# Grafik

PWA do grafiku pracy zespołu (wygląd iOS 26 / Liquid Glass, interfejs po polsku): zmiany dodawane ręcznie
albo skanowane ze zdjęcia (Gemini), siatka zespołu, „Mój grafik”, kalendarz, eksport do PDF, praca offline.
Dane zostają na urządzeniu (IndexedDB).

## Uruchomienie

```bash
npm install
npm run dev          # serwer deweloperski
npm run build        # produkcja do dist/
npm run preview      # podgląd produkcji (z nagłówkami CSP z public/_headers)
```

Kontrola przed commitem: `npm run typecheck && npm run lint && npm run test && npm run e2e`.

## Klucz Gemini

Aplikacja **nie zawiera klucza**. Klucz (Google AI Studio → API keys) wpisujesz w
_Ustawienia → Skanowanie AI_. Zapisuje się tylko lokalnie, jest pomijany w kopii zapasowej i nigdy nie
trafia do adresów URL ani logów. Na darmowym planie Google może używać wysłanych zdjęć do ulepszania
modeli — aplikacja pokazuje o tym informację przed pierwszym skanem.

## Wdrożenie

Wymagany HTTPS (PWA). Zbudowany katalog `dist/` to statyczna strona; reguły są w repozytorium:

| Hosting                    | Konfiguracja                                                        |
| -------------------------- | ------------------------------------------------------------------- |
| Cloudflare Pages / Netlify | `public/_headers` (CSP, cache) i `public/_redirects` (SPA fallback) |
| Vercel                     | `vercel.json` (te same nagłówki i przepisania)                      |

Ustawienia: komenda `npm run build`, katalog wyjściowy `dist`. Polityka CSP dopuszcza połączenia tylko do
własnej domeny i `generativelanguage.googleapis.com`; test `tests/unit/deploy.test.ts` pilnuje zgodności
`_headers` z `vercel.json`. `sw.js` i `index.html` mają `no-cache`, pliki w `assets/` — cache bezterminowy.

Instalacja: iPhone — Safari → Udostępnij → _Dodaj do ekranu początkowego_; Android — menu Chrome →
_Zainstaluj aplikację_. Kopię danych (Ustawienia → Dane) wykonaj przed przeniesieniem z karty Safari do
zainstalowanej aplikacji (to osobne magazyny danych).

Android: _Udostępnij_ zdjęcie z galerii → „Grafik” otwiera skanowanie; skróty ikony: Skanuj, Dodaj, PDF.

## Wariant z proxy (opcjonalny, dla współpracowników)

`worker/` zawiera proxy Cloudflare Workers, w którym klucz leży w sekrecie, a dostęp wymaga tokenu
zaproszenia i ma limit zapytań:

```bash
cd worker
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put INVITE_TOKENS      # np. token1,token2
# ustaw ALLOWED_ORIGIN w wrangler.toml, potem:
npx wrangler deploy
```

Do `connect-src` w CSP dopisz adres Workera. Handler jest przetestowany (`tests/unit/worker.test.ts`);
aplikacja domyślnie łączy się bezpośrednio z Gemini (wariant A) — przełączenie klienta na proxy to osobny
krok, potrzebny dopiero przy współdzieleniu aplikacji.

## Struktura

`src/domain` (czysta logika: daty, godziny, sumy, kolizje), `src/db` (Dexie, kopie), `src/ai` (Gemini,
normalizacja), `src/features/*` (ekrany), `src/ui` (design system), `src/sw.ts` (service worker),
`tests/unit` (Vitest), `tests/e2e` (Playwright: iPhone 12 / Pixel 7). Pełny plan: `plan-grafik-pwa.md`.
