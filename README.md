# Grafik

PWA do grafiku pracy zespołu (wygląd iOS 26 / Liquid Glass, interfejs po polsku): zmiany dodawane ręcznie
albo skanowane ze zdjęcia (Gemini), siatka zespołu, „Mój grafik”, kalendarz, eksport do PDF, praca offline.
Dane zostają na urządzeniu (IndexedDB).

## Uruchomienie

```bash
npm install
npm run dev          # serwer deweloperski
npm run build        # produkcja do dist/
npm run preview      # podgląd produkcji (z nagłówkiem CSP z config/csp.txt)
```

Kontrola przed commitem: `npm run typecheck && npm run lint && npm run test && npm run e2e`.

## Klucz Gemini

Aplikacja **nie zawiera klucza**. Klucz (Google AI Studio → API keys) wpisujesz w
_Ustawienia → Skanowanie AI_. Zapisuje się tylko lokalnie, jest pomijany w kopii zapasowej i nigdy nie
trafia do adresów URL ani logów. Na darmowym planie Google może używać wysłanych zdjęć do ulepszania
modeli — aplikacja pokazuje o tym informację przed pierwszym skanem.

## Wdrożenie (GitHub Pages)

Aplikacja jest statyczna i publikuje się wyłącznie przez GitHub — bez zewnętrznych usług. Workflow
`.github/workflows/pages.yml` przy każdym pushu na `master` uruchamia typecheck, lint i testy, buduje
aplikację z bazą `/<nazwa-repozytorium>/` i wdraża ją na GitHub Pages.

**Jednorazowo:** w repozytorium _Settings → Pages → Build and deployment → Source: GitHub Actions_.
Adres: `https://<użytkownik>.github.io/grafik/` (HTTPS jest wymagany dla PWA).

- GitHub Pages nie ustawia nagłówków, więc polityka CSP (`config/csp.txt`) trafia do `<meta>` w buildzie.
  Dopuszcza połączenia tylko do własnej domeny i `generativelanguage.googleapis.com`.
- Odświeżenie na podstronie (np. `/grafik/team`) obsługuje `404.html` — kopia `index.html`, generowana w buildzie.
- Lokalny build jak na Pages: `BASE_PATH=/grafik/ npm run build` (bez `BASE_PATH` baza to `/`).

Instalacja: iPhone — Safari → Udostępnij → _Dodaj do ekranu początkowego_; Android — menu Chrome →
_Zainstaluj aplikację_. Kopię danych (Ustawienia → Dane) wykonaj przed przeniesieniem z karty Safari do
zainstalowanej aplikacji (to osobne magazyny danych).

Android: _Udostępnij_ zdjęcie z galerii → „Grafik" otwiera skanowanie; skróty ikony: Skanuj, Dodaj, PDF.

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

Do `connect-src` w `config/csp.txt` dopisz adres Workera, a `ALLOWED_ORIGIN` ustaw na `https://<użytkownik>.github.io`. Handler jest przetestowany (`tests/unit/worker.test.ts`);
aplikacja domyślnie łączy się bezpośrednio z Gemini (wariant A) — przełączenie klienta na proxy to osobny
krok, potrzebny dopiero przy współdzieleniu aplikacji.

## Struktura

`src/domain` (czysta logika: daty, godziny, sumy, kolizje), `src/db` (Dexie, kopie), `src/ai` (Gemini,
normalizacja), `src/features/*` (ekrany), `src/ui` (design system), `src/sw.ts` (service worker),
`tests/unit` (Vitest), `tests/e2e` (Playwright: iPhone 12 / Pixel 7). Pełny plan: `plan-grafik-pwa.md`.
