# Grafik — wersja na komputer (`/pc/`)

Osobna konsola do obsługi i administracji grafikiem w przeglądarce na komputerze. To **nie jest** przeskalowana
aplikacja mobilna: ma własny układ (panel boczny, gęsta siatka, tabele), własne komponenty i obsługę klawiatury
i myszy. Dzieli z aplikacją mobilną wyłącznie warstwę logiki i danych (`src/domain`, `src/db`, `src/ai`,
generowanie PDF), więc reguły biznesowe (godziny domyślne, sumy, daty, kolizje) są w obu wersjach identyczne.

- Adres: `https://<twoja-domena>/pc/` (lokalnie `http://localhost:5173/pc/`).
- Kod: `src/pc/`, wejście `pc/index.html`, styl `src/pc/pc.css`. Test pilnuje, żeby `src/pc` nie importowała
  ekranów ani komponentów aplikacji mobilnej (`tests/unit/deploy.test.ts`).
- Instalowalna osobno (`public/pc.webmanifest`, zakres `/pc/`) — „Zainstaluj aplikację” w Chrome/Edge.
- Dane: IndexedDB tej przeglądarki. Pod tym samym adresem aplikacja mobilna i konsola widzą te same dane;
  między urządzeniami przenosisz je kopią JSON (Dane i kopie).

## Zakładki (Alt+1 … Alt+7)

| Zakładka          | Co robi                                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grafik            | Siatka osoby × dni (miesiąc/tydzień) z edycją jak w arkuszu, zaznaczaniem zakresów, schowkiem, wypełnianiem, cofnij/ponów, menu kontekstowym, panelem zaznaczenia, CSV  |
| Osoby             | Tabela: dodawanie, edycja (kolor, aliasy, „To ja”), archiwizacja, usuwanie z Cofnij, kolejność, akcje grupowe, wyszukiwanie po aliasie                                  |
| Godziny i raporty | Raport za miesiąc/rok/własny zakres: dni pracy, godziny, piątki/soboty, wolne, urlop, L4; obsada dzienna; szczegóły osoby; eksport CSV (Excel, BOM, `;`); druk          |
| Import ze zdjęcia | Przeciągnij/wklej/wybierz do 4 zdjęć → Gemini → weryfikacja w tabelach (przypisanie osób, edycja wpisów, kolizje, przesunięcie okresu) → import z możliwością wycofania |
| Eksport           | PDF (siatka A4 poziomo / lista osoby A4 pionowo) z podglądem na żywo, wybór osób i zawartości; CSV siatki                                                               |
| Dane i kopie      | Stan bazy, kopia/przywracanie JSON (scal / zastąp), historia importów z wycofaniem, Kosz (przywracanie, usuwanie na zawsze), strefa ryzyka (usunięcie wszystkiego)      |
| Ustawienia        | Motyw, początek tygodnia, godziny domyślne (z aktualizacją przyszłych zmian), klucz i model Gemini + test połączenia, lista skrótów                                     |

## Siatka grafiku — obsługa

| Akcja                      | Skrót                                                               |
| -------------------------- | ------------------------------------------------------------------- |
| Zaznaczanie                | klik, przeciągnięcie, `Shift`+klik, `Shift`+strzałki, `Ctrl+A`      |
| Cały wiersz / cała kolumna | klik w nazwę osoby / w dzień                                        |
| Ruch                       | strzałki, `Tab`, `Home`/`End`, `Ctrl`+strzałka (na skraj)           |
| Wpisanie zawartości        | zacznij pisać: `10-22`, `x` (godziny domyślne), `w`, `u`, `l4`, `i` |
| Edycja komórki             | `Enter`, `F2`, podwójne kliknięcie; `Esc` anuluje                   |
| Czyszczenie                | `Delete` / `Backspace`                                              |
| Kopiuj / wytnij / wklej    | `Ctrl+C` / `Ctrl+X` / `Ctrl+V` — wkleja też tekst z Excela (TSV)    |
| Wypełnij w dół / w prawo   | `Ctrl+D` / `Ctrl+R`                                                 |
| Cofnij / ponów             | `Ctrl+Z` / `Ctrl+Shift+Z` (`Ctrl+Y`)                                |
| Poprzedni / następny okres | `PageUp` / `PageDown`                                               |
| Paleta poleceń             | `Ctrl+K`                                                            |

Każda zmiana zapisuje się od razu (soft-delete — usunięte zmiany wracają z Kosza przez 30 dni).
Cofnij/ponów przywraca te same rekordy (to samo `id`), więc nie powstają duplikaty osoba+dzień.

## Testy

- Logika: `tests/unit/pc-logic.test.ts` (kody komórek, zaznaczanie, plan zmian, schowek, raport/CSV, cofanie).
- E2E (Chromium i WebKit, okno 1440×900): `tests/e2e/pc-grid.spec.ts`, `pc-pages.spec.ts`,
  `pc-import.spec.ts`, `pc-a11y.spec.ts` (axe WCAG A/AA w jasnym i ciemnym motywie, CSP, konsola).
- Uruchomienie samej konsoli: `npx playwright test --project=desktop-chromium --project=desktop-webkit`.
