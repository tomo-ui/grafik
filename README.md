# Grafik

PWA do grafiku pracy zespołu (wygląd iOS 26 / Liquid Glass, interfejs po polsku): zmiany dodawane ręcznie
albo skanowane ze zdjęcia (Gemini), siatka zespołu, „Mój grafik”, kalendarz, eksport do PDF, praca offline.
Dane zostają na urządzeniu (IndexedDB).

## Dwie wersje

- **Aplikacja mobilna** (`/`) — PWA na telefon, wygląd iOS 26.
- **Konsola na komputer** (`/pc/`) — osobny projekt interfejsu do obsługi i administracji: siatka grafiku z edycją
  jak w arkuszu (klawiatura, zaznaczanie zakresów, schowek, cofnij/ponów), osoby, raporty godzin, import ze zdjęcia,
  eksport PDF/CSV, kopie, kosz i ustawienia. Opis i skróty: [`docs/pc.md`](docs/pc.md).

Obie wersje korzystają z tej samej logiki i bazy (IndexedDB w danej przeglądarce); ekrany i komponenty są osobne.

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

## Wdrożenie (Vercel)

Aplikacja jest statyczna; Vercel buduje ją prosto z repozytorium GitHub.

1. vercel.com → _Add New… → Project_ → zaimportuj `tomo-ui/grafik` (konto GitHub).
2. Ustawienia projektu zostaw domyślne: framework _Vite_, komenda `npm run build`, katalog wyjściowy `dist`.
   **Nie ustawiaj** zmiennej `BASE_PATH` (aplikacja działa w korzeniu domeny). Żadnych zmiennych środowiskowych ani kluczy nie trzeba.
3. _Deploy_. Każdy push na `master` wdraża produkcję, a pull requesty dostają adresy podglądu.

Reguły hostingu są w `vercel.json`: nagłówki (CSP, `nosniff`, `no-referrer`), `no-cache` dla `sw.js` i `index.html`,
cache bezterminowy dla `assets/` oraz przekierowanie nieznanych ścieżek na `index.html` (odświeżenie na `/team` działa).
Politykę CSP (`config/csp.txt`) dodatkowo wstawiamy do `<meta>` w buildzie, więc obowiązuje na każdym hostingu.
HTTPS jest domyślny (wymagany dla PWA).

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

Do `connect-src` w `config/csp.txt` dopisz adres Workera, a `ALLOWED_ORIGIN` ustaw na adres aplikacji na Vercelu. Handler jest przetestowany (`tests/unit/worker.test.ts`);
aplikacja domyślnie łączy się bezpośrednio z Gemini (wariant A) — przełączenie klienta na proxy to osobny
krok, potrzebny dopiero przy współdzieleniu aplikacji.

## Struktura

`src/domain` (czysta logika: daty, godziny, sumy, kolizje), `src/db` (Dexie, kopie), `src/ai` (Gemini,
normalizacja), `src/features/*` (ekrany mobilne), `src/ui` (design system mobilny), `src/pc` (konsola na komputer),
`src/sw.ts` (service worker),
`tests/unit` (Vitest), `tests/e2e` (Playwright: iPhone 12 / Pixel 7). Pełny plan: `plan-grafik-pwa.md`.
