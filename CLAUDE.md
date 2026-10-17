# Grafik — PWA do grafiku pracy (iOS 26 / Liquid Glass)

Pełny plan: `plan-grafik-pwa.md` (czytaj sekcje 1, 15, 16 przed pracą nad daną fazą).

## Zasady

- Interfejs po polsku (`pl-PL`), wygląd jak iOS 26. Tydzień od poniedziałku (ustawialne).
- **Żadnego klucza API w kodzie/repo/.env** — użytkownik wpisuje go w Ustawieniach (plan, sekcja 3). Klucz pomijany w kopii zapasowej, logach i URL (P-19).
- Daty: tekst `YYYY-MM-DD` czasu lokalnego, wyłącznie helpery z `src/domain/dates.ts`. Zakaz `new Date('...')` i `toISOString()` (reguła ESLint, P-04).
- Długość zmiany = arytmetyka minut na `HH:MM` (P-23). Domyślnie Nd–Czw 10–22, Pt–Sb 10–23.
- Czysta logika w `src/domain` i `src/ai/normalize.ts` — zawsze z testami Vitest.
- Stan domenowy tylko w Dexie (`liveQuery`), nie w Zustand (P-18).
- Pola formularzy ≥ 16 px, `100dvh`, `env(safe-area-inset-*)`, obszary dotyku ≥ 44 pt.
- Max ~3 warstwy `backdrop-filter` naraz; komórki siatki bez blur (P-10).

## Wersja na komputer

- Osobny projekt interfejsu w `src/pc` (wejście `pc/index.html`, adres `/pc/`, routing hash). Nie importuje ekranów/komponentów mobilnych
  (`src/ui`, `src/features/{team,my-schedule,calendar,settings,onboarding,shift-editor}`) — test w `tests/unit/deploy.test.ts`.
  Logika i dane wspólne (`src/domain`, `src/db`, `src/ai`). Opis: `docs/pc.md`. Testy: `tests/e2e/pc-*.spec.ts` (projekty `desktop-*`).

## Polecenia

- `npm run dev` · `npm run build` · `npm run preview`
- Kontrola fazy: `npm run typecheck && npm run lint && npm run test && npm run e2e`
- Ikony placeholder: `node scripts/make-icons.mjs`

## Po każdej fazie

Protokół audytu z sekcji 16.1 planu, commit, odhaczenie checklisty w planie, krótki raport
(co zrobiono, co znalazł audyt, które punkty sekcji 18 sprawdzić na telefonie).
Nie oznaczaj niczego jako gotowe przy niezielonych/pominiętych testach.
