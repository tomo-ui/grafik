# Raport audytu końcowego (Faza 10)

Stan: wszystkie automatyczne kontrole zielone (patrz „Wyniki testów”). Punkty wymagające telefonu zebrano
w [`manual-test.md`](manual-test.md) — **nie są jeszcze zaliczone**, bo wymagają fizycznych urządzeń.

## Wyniki testów

| Kontrola                                   | Wynik                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` (app + service worker) | zielone                                                                                                       |
| `npm run lint` (w tym reguły P-04 na daty) | zielone                                                                                                       |
| `npm run test` (Vitest)                    | zielone; powtórzone w strefach `TZ=Europe/Warsaw`, `America/New_York`, `Pacific/Auckland` (`npm run test:tz`) |
| `npm run e2e` (iPhone 12 WebKit + Pixel 7) | zielone, 0 pominiętych                                                                                        |
| Lighthouse mobile                          | Perf 95 · A11y 100 · BP 100 · SEO 100 (`docs/lighthouse.md`)                                                  |
| axe (WCAG A/AA)                            | 0 naruszeń na 5 ekranach/arkuszach (`a11y.spec.ts`)                                                           |
| CSP                                        | e2e działa pod produkcyjną polityką, 0 naruszeń (`csp.spec.ts`)                                               |
| Klucz API w `src/`, `dist/`, repo          | brak (test `deploy.test.ts`)                                                                                  |

## Co znalazł audyt końcowy i jak naprawiono

| Waga   | Znalezisko                                                                                                 | Naprawa                                                                                                 |
| ------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| średni | Pakiet startowy 249 kB gzip (cel < 200 kB)                                                                 | Leniwe ładowanie: silnik AI, skanowanie, arkusze zmian, PDF, ekrany ustawień i kalendarza → 84 kB gzip  |
| średni | Kontrast WCAG AA: tekst pomocniczy, akcent, ostrzeżenia pomarańczowe, białe napisy na niebieskim/czerwonym | Nowe tokeny `--label-secondary` 0,8, `--accent` #005fc5, `--orange-text`, `--accent-fill`, `--red-fill` |
| średni | zod kompiluje walidatory przez `new Function` → naruszenie CSP bez `unsafe-eval`                           | `z.config({ jitless: true })`; CSP bez `unsafe-eval`                                                    |
| niski  | Brak `meta description` i poprawnego `robots.txt`                                                          | Dodane                                                                                                  |
| niski  | Podwójne wywołanie analizy w czasie ładowania silnika AI mogłoby ominąć blokadę                            | Blokada `lock` ustawiana przed `await loadEngine()`                                                     |

Błędów krytycznych i wysokich nie znaleziono; wcześniejsze (Fazy 4–8: nawigacja wstecz, stacking warstw, swipe w WebKit,
szerokości kolumn PDF) naprawiono w ich fazach i pokryto testami.

## Lista kontrolna 16.2

**Dane i logika**

| Punkt                                                    | Dowód                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Godziny domyślne na każdy dzień tygodnia (pełny miesiąc) | `domain.test.ts` „każdy dzień tygodnia: Nd–Czw 12 h, Pt–Sb 13 h"                                              |
| Sumy identyczne w zespole / Mój grafik / PDF             | `domain.test.ts` „totalsByPerson zgadza się z sumMinutes"; `pdf.test.ts` „sumy w PDF = sumy z jednej funkcji" |
| Zmiana godzin domyślnych nie rusza historii              | `people.test.ts` „zmienia tylko przyszłe z flagą…"; `app.spec.ts` godziny domyślne                            |
| Soft-delete + Cofnij (zmiana, wiele, osoba, import)      | `db.test.ts` (E-07, E-08), `import.test.ts` (wycofanie 1:1), `shifts.spec.ts`, `scan.spec.ts`                 |
| Brak duplikatów osoba+dzień                              | `db.test.ts` (error/skip/replace/merge/Cofnij), `shiftForm.test.ts`                                           |
| Daty o 23:30/00:30 i przy zmianie czasu, różne strefy    | `domain.test.ts` + uruchomienie w 3 strefach                                                                  |
| Round-trip eksport → czyszczenie → import                | `db.test.ts` „round-trip…"                                                                                    |

**Skanowanie AI**

| Punkt                                                                              | Dowód                                                                                                                                                           |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wszystkie źródła → ten sam podgląd                                                 | `scan.spec.ts` (biblioteka/aparat, schowek, wklejanie globalne, pole „przytrzymaj i wklej", share_target w `launch.spec.ts`); drag&drop — punkt ręczny **S-22** |
| Komunikaty błędów 4.1 (400/401/403/404/429/500/timeout/offline/pusta/JSON/schemat) | `gemini.test.ts`, `ai.test.ts` „komunikaty po polsku", `scan.spec.ts`                                                                                           |
| Fixtures: transponowany, legenda, godziny w komórkach, X, przekreślenia, 2 strony  | `ai.test.ts`                                                                                                                                                    |
| Brak importu przy nierozstrzygniętych osobach; szkic wraca                         | `import.test.ts`, `scan.spec.ts` (P-12, E-25)                                                                                                                   |
| Aliasy zapisują się i działają automatycznie                                       | `import.test.ts`, `scan.spec.ts`                                                                                                                                |
| ≥ 95 % komórek na prawdziwych zdjęciach                                            | **wymaga spike'a na telefonach** (`docs/spike-gemini.md`) — niezweryfikowane                                                                                    |

**Widoki i interakcje**

| Punkt                                          | Dowód                                                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Tydzień 8 osób bez przewijania; miesiąc sticky | `views.spec.ts` (P-24); płynność 15–25 osób — **S-15**                                                |
| Gesty P-07                                     | `views.spec.ts` (swipe tygodnia vs miesiąc), `ui.spec.ts` (swipe-actions)                             |
| Sheety: scrim, wstecz, klawiatura              | `ui.spec.ts`, `pdf.spec.ts`; klawiatura iOS — **S-12**                                                |
| Puste stany                                    | `views.spec.ts`, `scan.spec.ts` (brak klucza), `pdf.spec.ts`, `app.spec.ts`, offline w `scan.spec.ts` |
| Jasny/ciemny na każdym ekranie                 | zrzuty `zrzuty faza N — light/dark` w e2e (docs/screens)                                              |
| Tekst systemowy 200 %                          | `views.spec.ts` „większy tekst systemowy przełącza siatkę na listę dni"                               |

**PDF**

| Punkt                                      | Dowód                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Macierz wariantów → PDF → PNG              | `pdf.test.ts` (macierz → `docs/pdf-samples`), `scripts/pdf-to-png.mjs`, obejrzane w Fazie 8 |
| Polskie znaki, części, nagłówki, numeracja | `pdf.test.ts` (P-16, E-31)                                                                  |
| Nazwa, typ, rozszerzenie                   | `pdf.test.ts` nazwy plików, `pdf.spec.ts` (`application/pdf`)                               |

**PWA**

| Punkt                               | Dowód                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Lighthouse                          | `docs/lighthouse.md`                                                                                         |
| Offline: start, edycja, PDF         | `offline.spec.ts`, `pdf.spec.ts` (czcionki i pdf.js w precache)                                              |
| Aktualizacja nie przerywa pracy     | `sw.ts`/`registerType: 'prompt'` + test `deploy.test.ts` (P-09); przebieg z prawdziwą nową wersją — **S-23** |
| Ikona, nazwa, splash, pasek statusu | `assets.test.ts`, `launch.spec.ts`; wygląd na urządzeniach — **S-01, S-02**                                  |

**Bezpieczeństwo i prywatność**

| Punkt                                   | Dowód                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| Brak klucza w `src/`, `dist/`, `.env`   | `deploy.test.ts`                                                                   |
| Klucz poza kopią, logami, URL           | `db.test.ts` (P-19), `gemini.test.ts` (nagłówek, nie URL), `scan.spec.ts`          |
| Komunikat o prywatności przed 1. skanem | `scan.spec.ts` (pełny przepływ)                                                    |
| CSP                                     | `config/csp.txt` (meta w buildzie), `vercel.json`, `deploy.test.ts`, `csp.spec.ts` |

## Rejestr pułapek P-xx → rozwiązanie → dowód

| ID   | Rozwiązanie (plik)                                         | Dowód                                                        |
| ---- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| P-01 | `features/scan/clipboard.ts`, `ScanSheet.tsx`              | `image.test.ts`, `scan.spec.ts`, **S-03…S-06**               |
| P-02 | `features/pdf/PdfSheet.tsx`, `settings/DataSection.tsx`    | `pdf.spec.ts`, **S-17**                                      |
| P-03 | `features/pdf/render.ts` (podgląd jako obrazy)             | `pdf.spec.ts`                                                |
| P-04 | `domain/dates.ts` + reguła ESLint                          | `domain.test.ts`, `npm run lint`                             |
| P-05 | `ui/hooks.ts` (visualViewport), `Overlays.tsx`             | **S-12**                                                     |
| P-06 | `ui/tokens.css`, `Overlays.tsx`                            | `ui.spec.ts` (long-press), **S-13**                          |
| P-07 | `team/TeamGrid.tsx`, `ui/List.tsx`                         | `views.spec.ts`, **S-14, S-15**                              |
| P-08 | `settings/DataSection.tsx`, onboarding                     | `app.spec.ts` (kopia), **S-21**                              |
| P-09 | `sw.ts`, `App.tsx` (banner)                                | `deploy.test.ts`, **S-23**                                   |
| P-10 | `TeamGrid.module.css` (komórki bez blur)                   | **S-15** (płynność)                                          |
| P-11 | `tokens.css` (`100dvh`, safe-area)                         | `shell.spec.ts`, **S-01**                                    |
| P-12 | `ScanProvider.tsx`, `shift-editor/draft.ts`                | `scan.spec.ts`, `shifts.spec.ts`, `import.test.ts`, **S-08** |
| P-13 | pola ≥ 16 px (`tokens.css`, `List.tsx`)                    | `shell.spec.ts`                                              |
| P-14 | `ScanSheet.tsx` (`inputMode="none"`)                       | `scan.spec.ts`, **S-06**                                     |
| P-15 | `ui/hooks.ts` (stos nakładek, `useBackClose`)              | `ui.spec.ts`, `pdf.spec.ts`, Android: **S-24**               |
| P-16 | Inter TTF w precache                                       | `pdf.test.ts`                                                |
| P-17 | `ai/names.ts` (ł→l)                                        | `ai.test.ts`                                                 |
| P-18 | `app/data.ts` (liveQuery), Zustand tylko UI                | przegląd kodu; dwie karty — **S-25**                         |
| P-19 | `db/backup.ts`, `ai/gemini.ts`, `ai/errors.ts` (`maskKey`) | `db.test.ts`, `gemini.test.ts`, `deploy.test.ts`             |
| P-20 | `domain/hours.ts`, `HoursEditor.tsx`                       | `domain.test.ts`                                             |
| P-21 | `ai/image.ts`                                              | `image.test.ts`, `scan.spec.ts`, **S-26**                    |
| P-22 | `ai/image.ts` (komunikat HEIC)                             | `image.test.ts`, `scan.spec.ts`                              |
| P-23 | `domain/hours.ts` (minuty)                                 | `domain.test.ts` (25.10.2026, 28.03.2027)                    |
| P-24 | `TeamGrid` (jeden kontener przewijania)                    | `views.spec.ts`                                              |
| P-25 | `ai/gemini.ts`, `ScanProvider.tsx`                         | `gemini.test.ts`, `scan.spec.ts`                             |

Nowe pułapki odkryte w trakcie prac (dopisane do rejestru planu):

| ID   | Problem                                                                    | Rozwiązanie                                                                        |
| ---- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| P-26 | zod 4 używa `new Function` (JIT) → naruszenie CSP bez `unsafe-eval`        | `z.config({ jitless: true })` w `ai/schema.ts`, `db/backup.ts`                     |
| P-27 | Aktualizacja SW z przechwyceniem klientów podmienia pliki w trakcie edycji | `registerType: 'prompt'`, `skipWaiting` tylko po wiadomości z banneru              |
| P-28 | Kontrast WCAG na szkle i kolorze akcentu w trybie ciemnym                  | Osobne tokeny wypełnień (`--accent-fill`, `--red-fill`) i tekstu (`--orange-text`) |

## Macierz E-xx

| #                | Dowód                                                        |
| ---------------- | ------------------------------------------------------------ |
| E-01, E-02       | `domain.test.ts`, `shiftForm.test.ts`                        |
| E-03             | `shifts.spec.ts` kolizje                                     |
| E-04, E-05       | `domain.test.ts`, `shiftForm.test.ts`                        |
| E-06             | `shifts.spec.ts` podwójne tapnięcie                          |
| E-07, E-08       | `db.test.ts`, `shifts.spec.ts`, `app.spec.ts`                |
| E-09             | `domain.test.ts` „dziś o 23:30 i 00:30" (+ 3 strefy)         |
| E-10, E-11, E-12 | `domain.test.ts`, `views.test.ts`, `pdf.test.ts`             |
| E-13             | **S-03**                                                     |
| E-14, E-15       | `image.test.ts`, `scan.spec.ts`                              |
| E-16             | `image.test.ts` + `scan.spec.ts` (P-21), **S-26**            |
| E-17             | `scan.spec.ts`                                               |
| E-18             | `gemini.test.ts`, `scan.spec.ts`                             |
| E-19             | `scan.spec.ts` (błędy API + „Ponów")                         |
| E-20–E-24        | `ai.test.ts`, `import.test.ts`, `scan.spec.ts`               |
| E-25             | `scan.spec.ts`, **S-08**                                     |
| E-26             | `views.spec.ts`, `app.spec.ts`                               |
| E-27             | **S-15**                                                     |
| E-28, E-29       | `views.spec.ts`, `people.test.ts`                            |
| E-30, E-31       | `pdf.test.ts`, `pdf.spec.ts`                                 |
| E-32             | `pdf.spec.ts` (AbortError), **S-19**                         |
| E-33             | `pdf.spec.ts` offline                                        |
| E-34, E-35       | `db.test.ts` (nowsza wersja, uszkodzone dane), `app.spec.ts` |
| E-36             | `people.test.ts`, `app.spec.ts`                              |
| E-37             | `deploy.test.ts` (P-09), **S-23**                            |
| E-38             | **S-27** (VoiceOver); etykiety komórek — axe                 |

## Ograniczenia i ryzyka otwarte

- **Spike Gemini na prawdziwych urządzeniach** (CORS, schemat, czas odpowiedzi, dokładność ≥ 95 %) — do wykonania przez użytkownika
  według `docs/spike-gemini.md`. Jeśli CORS nie działa z przeglądarki, wdrożyć wariant B: `worker/` jest gotowy i przetestowany,
  brakuje przełączenia klienta w aplikacji na adres proxy.
- Zachowania zależne od iOS/Android (Web Share, schowek, instalacja, gesty, klawiatura, VoiceOver) potwierdzają dopiero punkty S-xx.
- Lighthouse uruchomiony na lokalnym `vite preview` (symulowane łącze); wynik na hostingu może się nieznacznie różnić.
