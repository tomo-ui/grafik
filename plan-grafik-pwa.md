# Plan budowy: „Grafik” — PWA do grafiku pracy w stylu iOS 26

> Dokument dla Claude Code. Czytaj go w całości przed rozpoczęciem pracy.
> Realizuj **fazami** (sekcja 12). Po każdej fazie: uruchom testy, przejdź **protokół audytu fazy (sekcja 16)**, zrób commit, zaktualizuj checklistę w tym pliku (`- [ ]` → `- [x]`).
> Przed napisaniem kodu dla danej funkcji sprawdź **Rejestr pułapek (sekcja 15)** — opisuje błędy, które wychodzą dopiero na prawdziwym iPhonie/Androidzie, razem z rozwiązaniami. Każda pułapka ma identyfikator (`P-xx`) i musi być pokryta kodem oraz testem lub punktem ręcznego scenariusza.

### Wersja 2 — zmiany po audycie

- Dodano **wklejanie zdjęcia grafiku ze schowka** (iPhone i Android) — sekcja 4.3a.
- Ustalono przechowywanie godzin: zmiana zapisuje konkretne godziny oraz flagę „domyślne” (zmiana ustawień nie psuje historii).
- Dodano obsługę zmian kończących się po północy, soft-delete pod funkcję „Cofnij” i reguły dat bez błędów stref czasowych.
- Naprawiono przepływy wrażliwe na „gest użytkownika” na iOS (udostępnianie PDF, schowek).
- Doprecyzowano podział PDF miesiąca na strony, polską odmianę liczebników i format liczb.
- Dodano: Rejestr pułapek (15), Protokół audytu (16), Macierz przypadków brzegowych (17), Ręczny scenariusz testów na telefonie (18), Fazę 10 — audyt końcowy.

---

## 0. TL;DR

Progresywna aplikacja webowa (PWA), instalowalna na iPhone 12+ (iOS 16.4+) i Androidzie (Chrome 110+), która:

1. pozwala **ręcznie** tworzyć grafik pracy dla wielu osób (dodawanie, edycja, usuwanie dni pracy),
2. **parsuje zdjęcie grafiku** (papierowego / z tablicy / screenshot) przez darmowe **Google Gemini API** i po weryfikacji importuje zmiany; zdjęcie można zrobić aparatem, wybrać z galerii albo **wkleić ze schowka** (np. skopiowane z WhatsApp/Messengera/Zdjęć),
3. pokazuje **czytelny widok całego zespołu** oraz widok „mój grafik”,
4. generuje **ładny PDF** i udostępnia go natywnym arkuszem udostępniania (Web Share API),
5. wygląda i zachowuje się możliwie blisko **iOS 26 (Liquid Glass)**,
6. działa **offline** (dane lokalnie w IndexedDB; AI wymaga sieci).

Język interfejsu: **polski**. Locale dat: `pl-PL`, tydzień zaczyna się w poniedziałek (ustawialne).

---

## 1. Reguły biznesowe

### 1.1 Domyślne godziny zmian

| Dzień        | Start | Koniec | Długość |
| ------------ | ----- | ------ | ------- |
| Niedziela    | 10:00 | 22:00  | 12 h    |
| Poniedziałek | 10:00 | 22:00  | 12 h    |
| Wtorek       | 10:00 | 22:00  | 12 h    |
| Środa        | 10:00 | 22:00  | 12 h    |
| Czwartek     | 10:00 | 22:00  | 12 h    |
| Piątek       | 10:00 | 23:00  | 13 h    |
| Sobota       | 10:00 | 23:00  | 13 h    |

- Te wartości są **domyślne i edytowalne** w Ustawieniach (per dzień tygodnia).
- Przy dodaniu zmiany godziny wypełniają się automatycznie wg dnia tygodnia; użytkownik może je nadpisać dla konkretnej zmiany.
- Jeśli AI rozpozna w grafiku tylko znacznik „pracuje” (np. `X`, `✓`, `1`, `D`), bez godzin → stosujemy godziny domyślne dla danego dnia.
- Jeśli AI rozpozna konkretne godziny (np. `10-18`, `14:00–23:00`) → używamy rozpoznanych.
- Obsłuż zmiany niepełne (np. 10:00–16:00, 16:00–23:00) — model danych nie może zakładać jednej zmiany dziennie na sztywno, ale **jedna osoba = max 1 zmiana dziennie** w MVP (walidacja z czytelnym komunikatem).
- **Przechowywanie godzin:** każda zmiana typu `work` zawsze zapisuje konkretne `start`/`end` oraz flagę `usesDefaultHours`. Zmiana godzin domyślnych w Ustawieniach **nie zmienia** istniejących zmian automatycznie — po zapisie ustawień pokaż pytanie: „Zaktualizować N przyszłych zmian korzystających z godzin domyślnych?” (_Tak_ aktualizuje tylko przyszłe, z flagą `usesDefaultHours = true`).
- **Zmiana po północy:** jeśli `end <= start` (np. 18:00–02:00), traktuj ją jako kończącą się następnego dnia; w UI pokaż dopisek „+1 dzień” i ostrzeżenie do potwierdzenia (to nietypowe dla tych godzin otwarcia, więc najczęściej to pomyłka). `end == start` jest zawsze błędem.
- Długość zmiany liczona **arytmetyką minut** z `HH:MM` (nie różnicą obiektów `Date`) — zmiana czasu letni/zimowy (np. 25.10.2026) nie może dawać 11 h lub 13 h zamiast 12 h.
- Typy wpisów: `praca` (domyślny), `wolne`, `urlop`, `L4`. Wolne/urlop/L4 nie liczą się do godzin pracy, ale są widoczne w grafiku.

### 1.2 Osoby

- Grafik zawiera wiele osób. Jedna może być oznaczona jako **„Ja”** (zasila zakładkę „Mój grafik”).
- Każda osoba ma: imię (wyświetlane), opcjonalne nazwisko, kolor (z palety systemowej iOS), listę **aliasów** (warianty pisowni z grafików, np. „Kasia”, „K. Nowak”, „Katarzyna N.”) — używane do dopasowania przy imporcie z AI.

### 1.3 Liczenie godzin

- Suma godzin per osoba w wybranym okresie (tydzień/miesiąc) — widoczna w widoku zespołu i w PDF.
- Liczba osób w pracy per dzień (obsada) — widoczna jako mały wskaźnik pod nagłówkiem dnia.
- Format liczb po polsku: `12,5 h` (przecinek, `Intl.NumberFormat('pl-PL')`), godziny `10:00`.
- Polska odmiana liczebników przez `Intl.PluralRules('pl-PL')`: „1 zmiana, 2 zmiany, 5 zmian, 22 zmiany”, „1 osoba, 3 osoby, 5 osób”. Jedna funkcja `plural()` w `src/domain/i18n.ts`, z testami dla 0, 1, 2, 4, 5, 12, 21, 22, 25, 112.

### 1.4 Daty — zasada nadrzędna

- Daty dni zapisujemy jako tekst `YYYY-MM-DD` w **czasie lokalnym**. **Zakaz** `new Date('2026-11-03')` (parsuje jako UTC → przesunięcie o dzień w niektórych strefach) i `toISOString().slice(0,10)` (zwraca datę UTC → po 22:00/23:00 w Polsce daje jutro/wczoraj). Używaj wyłącznie helperów z `src/domain/dates.ts` (`toISODate(localDate)`, `fromISODate(str)`, `weekdayOf(str)`), opartych na `date-fns` z `parse`/`format`.
- Dzień tygodnia: `0 = niedziela … 6 = sobota` (zgodnie z `Date.getDay()`); kolejność wyświetlania zależy od `weekStartsOn`.
- „Dziś” liczone przy każdym renderze (aplikacja może być otwarta przez północ) — hook `useToday()` odświeżany o północy i przy powrocie aplikacji z tła (`visibilitychange`).

---

## 2. Stos technologiczny

| Obszar       | Wybór                                                                    | Uzasadnienie                                                                                       |
| ------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Build        | **Vite** + **TypeScript** (strict)                                       | szybki, prosty                                                                                     |
| UI           | **React 19**                                                             | ekosystem, Claude Code zna go najlepiej                                                            |
| Style        | **CSS Modules + CSS custom properties** (design tokens)                  | pełna kontrola nad efektem „glass”; bez Tailwinda, żeby nie walczyć z `backdrop-filter` i tokenami |
| Animacje     | **motion** (dawniej Framer Motion)                                       | sprężyny (spring) jak w iOS, gesty drag dla sheetów                                                |
| Stan         | **Zustand**                                                              | lekki                                                                                              |
| Baza lokalna | **Dexie.js** (IndexedDB) + `dexie-react-hooks`                           | offline, reaktywne zapytania                                                                       |
| Daty         | **date-fns** + `date-fns/locale/pl`                                      |                                                                                                    |
| PWA          | **vite-plugin-pwa** (Workbox, `registerType: 'autoUpdate'`)              | manifest + service worker                                                                          |
| Router       | **wouter** lub `react-router` (data mode)                                | lekki routing zakładek                                                                             |
| PDF          | **pdfmake** z osadzoną czcionką **Inter** (lub Roboto)                   | pełne wsparcie polskich znaków (ą, ę, ł, ż…), tabele, kolory                                       |
| Ikony        | **lucide-react** (stroke 1.75–2)                                         | SF Symbols nie mogą być używane poza platformami Apple — Lucide wizualnie najbliżej                |
| AI           | **Google Gemini API** (REST, bez SDK albo `@google/genai`)               | darmowy tier                                                                                       |
| Testy        | **Vitest** (logika), **Playwright** (E2E z emulacją iPhone 12 i Pixel 7) |                                                                                                    |
| Lint         | ESLint + Prettier                                                        |                                                                                                    |
| Hosting      | Cloudflare Pages / Vercel / Netlify (darmowe, HTTPS wymagany dla PWA)    |                                                                                                    |

---

## 3. ⚠️ Bezpieczeństwo klucza API — PRZECZYTAJ

1. **Nigdy nie wpisuj klucza API do kodu, repozytorium, `.env` trafiającego do bundla ani do tego pliku.** Zmienne `VITE_*` lądują w publicznym JS — każdy może je odczytać.
2. Klucz, który został wklejony w czacie, należy traktować jako ujawniony → **wygeneruj nowy** w Google AI Studio (aistudio.google.com → API keys) i stary usuń.
3. Dwa dopuszczalne warianty (zaimplementuj **A**, przygotuj kod pod **B**):
   - **A (MVP, aplikacja osobista):** użytkownik wkleja klucz w _Ustawienia → Skanowanie AI_. Klucz trzymany lokalnie w IndexedDB na urządzeniu, wysyłany wyłącznie do `generativelanguage.googleapis.com`. Przycisk „Testuj klucz”. Pole typu password z przyciskiem „pokaż”.
   - **B (gdy aplikację mają używać współpracownicy):** mały proxy na **Cloudflare Workers** (darmowy) — klucz w `wrangler secret`, aplikacja woła `/api/parse-schedule`. Dodaj prosty limit (np. token zaproszenia + rate limit per IP). Folder `worker/` w repo.
4. Przypomnienie w UI (jednorazowe, przy pierwszym skanie): na darmowym planie Google może wykorzystywać przesłane dane (zdjęcia z imionami współpracowników) do ulepszania modeli. Daj użytkownikowi świadomy wybór.

---

## 4. Gemini — integracja

### 4.1 Model

- Model **konfigurowalny w Ustawieniach** (pole tekstowe z podpowiedziami), domyślnie alias **`gemini-flash-latest`**.
- Powód: linia Gemini 2.5 jest wygaszana w październiku 2026, a modele Pro wypadły z darmowego planu — alias „latest” Flash przeżyje rotację wersji. Zapasowo: aktualny `gemini-3.x-flash` / `flash-lite` (sprawdź listę w AI Studio przy implementacji — wywołaj `GET /v1beta/models` i pokaż w ustawieniach tylko modele obsługujące `generateContent`).
- Free tier ma limity rzędu kilkunastu zapytań/min — jeden skan = jedno zapytanie, więc to wystarcza. Obsłuż **HTTP 429** (`RESOURCE_EXHAUSTED`): komunikat „Limit darmowego API — spróbuj za minutę” + automatyczny retry z backoffem (max 2); jeśli odpowiedź zawiera `RetryInfo.retryDelay`, czekaj tyle, ile podaje (z odliczaniem w UI).
- **Spike na start Fazy 7 (obowiązkowy, zanim powstanie UI):** mały skrypt/strona testowa, która z przeglądarki (Safari iOS + Chrome Android) wysyła prawdziwe zdjęcie do Gemini i sprawdza: (a) CORS działa bez proxy, (b) wybrany model przyjmuje `responseSchema`, (c) czas odpowiedzi. Wyniki zapisz w `docs/spike-gemini.md`. Jeśli (a) nie działa — od razu wariant B (proxy).
- **Odporność na różnice modeli:** jeśli API odrzuci `responseSchema` (HTTP 400 z opisem schematu), ponów jeden raz bez schematu, tylko z `responseMimeType: application/json`, i waliduj zodem. Jeśli model obsługuje konfigurację „myślenia”, ustaw najniższy poziom (szybciej, mniej tokenów); jeśli API odrzuci ten parametr — ponów bez niego. Te fallbacki logowane w konsoli dev.
- Mapowanie błędów na polskie komunikaty: 400 (zły obraz/parametr), 401/403 (zły lub zablokowany klucz → link do Ustawień), 404 (model nie istnieje → „Wybierz inny model”), 429 (limit), 5xx/timeout (spróbuj ponownie), błąd lokalizacji/regionu („Darmowe API nie jest dostępne w Twoim regionie”), brak sieci (`navigator.onLine` + `TypeError: Failed to fetch`). Odpowiedź zablokowana przez filtry bezpieczeństwa / pusta → „Nie udało się odczytać grafiku, spróbuj wyraźniejszego zdjęcia”.

### 4.2 Wywołanie

```
POST https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent
Header: x-goog-api-key: <klucz z ustawień>
Header: Content-Type: application/json
```

Body:

- `contents[0].parts`: `[{ text: PROMPT }, { inline_data: { mime_type: "image/jpeg", data: <base64> } }]`
- `generationConfig`: `{ temperature: 0, responseMimeType: "application/json", responseSchema: <schemat z 4.4> }`
- Timeout 60 s (`AbortController`), przycisk „Anuluj”.

### 4.3 Przygotowanie zdjęcia (po stronie klienta)

1. Trzy źródła: **„Zrób zdjęcie”** (`<input type="file" accept="image/*" capture="environment">`), **„Wybierz z biblioteki”** (`accept="image/*"` bez `capture`) i **„Wklej ze schowka”** (sekcja 4.3a). Dodatkowo drag&drop na desktopie. Wszystkie trzy ścieżki zwracają `Blob` do jednej wspólnej funkcji `ingestImage(blob, source)` — dalsze kroki są identyczne.
2. Dekodowanie przez `createImageBitmap` (iOS zwykle konwertuje HEIC → JPEG przy wyborze; jeśli dekodowanie się nie uda, pokaż komunikat).
3. Korekta orientacji EXIF (`imageOrientation: 'from-image'`).
4. Ekran podglądu: obrót o 90°, opcjonalne kadrowanie (prosty prostokąt, drag narożników).
5. Skalowanie do max **2048 px** dłuższego boku, JPEG jakość 0.85 → base64. Cel: < 1.5 MB.
6. Opcjonalnie wiele zdjęć naraz (grafik na 2 kartkach) → wysyłane w jednym zapytaniu jako kolejne `parts`. Limit: 4 zdjęcia, łącznie < 15 MB base64 (limit żądania inline to ok. 20 MB).
7. Zbyt małe zdjęcie (dłuższy bok < 600 px) → ostrzeżenie „Zdjęcie może być nieczytelne” (nie blokuj).

### 4.3a Wklejanie zdjęcia ze schowka (iPhone + Android)

Scenariusz: użytkownik w WhatsAppie/Messengerze/Zdjęciach przytrzymuje zdjęcie grafiku → _Kopiuj_ → otwiera aplikację → wkleja.

**Ścieżka główna — przycisk „Wklej ze schowka”:**

```ts
// MUSI być wywołane synchronicznie w handlerze kliknięcia (bez await przed read()) — P-01
async function pasteFromClipboard(): Promise<Blob | null> {
  if (!navigator.clipboard?.read) return null; // brak API → ścieżka zapasowa
  const items = await navigator.clipboard.read(); // iOS pokazuje systemowy dymek „Wklej”
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'));
    if (type) return await item.getType(type);
  }
  return null; // w schowku nie ma obrazka
}
```

- **iOS (Safari / PWA na ekranie początkowym):** po tapnięciu przycisku system wyświetla mały dymek **„Wklej”** nad przyciskiem — użytkownik musi go tapnąć (to systemowe zabezpieczenie, nie da się go pominąć). Pokaż pod przyciskiem podpowiedź: „Tapnij »Wklej« w dymku, który się pojawi”. Gdy użytkownik zignoruje dymek, `read()` odrzuca `NotAllowedError` → bez komunikatu błędu, po prostu nic się nie dzieje.
- **Android (Chrome):** przy pierwszym użyciu przeglądarka pyta o zgodę na odczyt schowka. Odmowa → komunikat z instrukcją, jak zezwolić w ustawieniach witryny, i wskazanie ścieżki zapasowej.
- Typy obrazków: przyjmij **dowolny** `image/*` (iOS zwykle podaje `image/png`, czasem `image/jpeg`; zrzuty ekranu bywają bardzo duże — przechodzą przez tę samą kompresję z 4.3).
- Schowek zawiera tylko tekst (np. link do zdjęcia) → komunikat: „W schowku nie ma zdjęcia. Skopiuj samo zdjęcie (przytrzymaj → Kopiuj), a nie link.”

**Ścieżka zapasowa — pole „przytrzymaj i wklej”** (gdy `clipboard.read` nie istnieje lub zostało zablokowane):

- W sheecie skanowania obszar `contenteditable` (wyglądający jak przerywana ramka „Przytrzymaj tutaj i wybierz Wklej”). Systemowe menu iOS/Androida po przytrzymaniu ma opcję _Wklej_.
- Nasłuchuj zdarzenia `paste`: pobierz `e.clipboardData.files[0]` (lub `items` z `kind === 'file'` i `type` obrazka), wywołaj `e.preventDefault()`, żeby nic nie wstawiło się do pola, i przekaż blob do `ingestImage`.
- Pole czyść po każdym wklejeniu; nie pozwól wpisywać tekstu (`beforeinput` → `preventDefault` dla typów innych niż paste). Ustaw `inputmode="none"`, żeby nie wyskakiwała klawiatura (P-14).

**Globalnie:** zdarzenie `paste` na `document`, gdy otwarty jest ekran główny lub sheet skanowania (desktop: Ctrl/Cmd+V) → od razu otwiera podgląd skanowania z wklejonym obrazem.

**Wykrywanie obrazka w schowku przy powrocie do aplikacji — NIE robimy** (odczyt schowka bez gestu jest zablokowany i na iOS pokazywałby dymek w losowym momencie).

**Testy:** jednostkowo `ingestImage` z PNG/JPEG/HEIC-jak-JPEG; E2E (Chromium) z przyznaniem uprawnień `clipboard-read`/`clipboard-write` i wpisaniem PNG do schowka; ręcznie punkty S-03…S-06 w sekcji 18.

### 4.4 Schemat odpowiedzi (responseSchema)

```json
{
  "type": "object",
  "properties": {
    "period": {
      "type": "object",
      "properties": {
        "month": { "type": "integer", "nullable": true },
        "year": { "type": "integer", "nullable": true },
        "startDate": { "type": "string", "nullable": true, "description": "YYYY-MM-DD" },
        "endDate": { "type": "string", "nullable": true, "description": "YYYY-MM-DD" }
      }
    },
    "legend": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "symbol": { "type": "string" },
          "meaning": { "type": "string", "enum": ["work", "off", "vacation", "sick", "other"] },
          "start": { "type": "string", "nullable": true, "description": "HH:MM" },
          "end": { "type": "string", "nullable": true, "description": "HH:MM" }
        },
        "required": ["symbol", "meaning"]
      }
    },
    "people": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "nameAsWritten": { "type": "string" },
          "entries": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "date": { "type": "string", "description": "YYYY-MM-DD" },
                "rawCell": { "type": "string" },
                "kind": { "type": "string", "enum": ["work", "off", "vacation", "sick", "other"] },
                "start": { "type": "string", "nullable": true },
                "end": { "type": "string", "nullable": true },
                "confidence": { "type": "number" }
              },
              "required": ["date", "rawCell", "kind", "confidence"]
            }
          }
        },
        "required": ["nameAsWritten", "entries"]
      }
    },
    "warnings": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["people"]
}
```

### 4.5 Prompt (stały, w `src/ai/prompt.ts`)

Przekazuj do promptu kontekst: dzisiejszą datę, okres sugerowany przez użytkownika (jeśli wybrał), listę znanych osób z aliasami, domyślne godziny.

Treść (po polsku lub angielsku — angielski zwykle stabilniejszy, ale wyniki imion zostawiamy w oryginalnej pisowni):

```
You are extracting a staff work schedule from a photo. The schedule is in Polish.
Today is {TODAY}. If month/year are not visible, assume {SUGGESTED_PERIOD}.
Known staff (name: aliases): {KNOWN_PEOPLE}.
Default shift hours if a cell only marks that someone works:
Sun–Thu 10:00–22:00, Fri–Sat 10:00–23:00.

Rules:
- Return one entry per person per day where the cell is NOT empty.
- Copy the cell text exactly into rawCell.
- If the cell contains hours (e.g. "10-18", "14:00–23"), fill start/end as HH:MM.
- If the cell only marks work (X, ✓, 1, D, a letter from the legend meaning work), set kind="work" and leave start/end null.
- Recognise Polish abbreviations: W/wolne = off, U/UW/urlop = vacation, L4/ch = sick.
- Read the legend if present and return it.
- Polish weekday headers: Pn, Wt, Śr, Cz, Pt, Sb, Nd.
- Never invent people or days. If unsure, lower confidence (0–1) and add a warning.
- Dates must be YYYY-MM-DD and match the weekday headers when visible.
- The table may be transposed (people as columns, days as rows) or split into weeks; detect the layout.
- Crossed-out or overwritten cells: use the visible final value and add a warning.
- Ignore totals rows/columns (e.g. "Suma", "Razem", "h").
```

Uwaga: dokładne brzmienie promptu jest wersjonowane (`PROMPT_VERSION`) i zapisywane w `ImportBatch`, żeby dało się porównywać jakość po zmianach.

### 4.6 Post-processing (czysta logika w `src/ai/normalize.ts`, w pełni otestowana Vitestem)

1. Walidacja JSON (np. **zod**) — przy błędzie: komunikat + przycisk „Spróbuj ponownie”.
2. Sprawdzenie spójności dat z dniami tygodnia; korekta roku/miesiąca, jeśli AI pomyliło się o 1.
3. Uzupełnienie `start/end` z legendy, a jeśli brak — z godzin domyślnych dla dnia tygodnia.
4. Normalizacja godzin (`10` → `10:00`, `10.30` → `10:30`, `22-10` → oznacz jako podejrzane).
5. **Dopasowanie osób**: dokładne → po aliasach → fuzzy (Levenshtein/Jaro-Winkler na znormalizowanych imionach, bez polskich znaków i wielkości liter). Próg pewności; poniżej progu = „nowa osoba?” do decyzji użytkownika. Normalizacja: `toLocaleLowerCase('pl')`, NFD + usunięcie znaków diakrytycznych **oraz ręcznie `ł→l`** (ł nie rozkłada się w NFD — P-17), usunięcie kropek i podwójnych spacji, obsługa zapisu „Nowak K.” vs „K. Nowak”.
6. **Duplikaty:** jeśli dwie różne nazwy z grafiku dopasowały się do tej samej osoby → oznacz obie na czerwono i wymuś decyzję. Jeśli ta sama nazwa występuje w dwóch wierszach (np. dwie strony grafiku) → scal wpisy, a przy sprzecznych wartościach dla tego samego dnia pokaż konflikt.
7. Wykrycie konfliktów z istniejącymi zmianami w bazie.
8. Odrzuć wpisy z datą niepoprawną (np. 31.11) lub spoza wykrytego okresu o więcej niż 7 dni → do sekcji „Ostrzeżenia”, nie importuj po cichu.
9. Liczba dni zwrócona dla osoby nie zgadza się z liczbą kolumn grafiku (np. AI pominęło dni) → ostrzeżenie „Sprawdź osobę X — wykryto N dni”.

### 4.7 Ekran weryfikacji importu (kluczowy dla UX)

- Nagłówek: wykryty okres (edytowalny: miesiąc/rok).
- Lista osób (grouped inset list): przy każdej — dopasowanie (`Kasia → Katarzyna Nowak ✓`) z możliwością zmiany: _istniejąca osoba / nowa osoba / pomiń_. Po wyborze istniejącej osoby — zapamiętaj `nameAsWritten` jako alias.
- Pod osobą: mini-siatka dni z wykrytymi zmianami; komórki z `confidence < 0.7` podświetlone na żółto; tap → edycja.
- Sekcja „Ostrzeżenia” z `warnings`.
- Konflikty: przełącznik globalny _Zastąp istniejące / Pomiń kolidujące / Pytaj dla każdej_.
- Miniatura zdjęcia (tap → pełny ekran z pinch-zoom) do porównania.
- Przycisk główny „Importuj N zmian”. Po imporcie: toast z „Cofnij” (5 s).
- Każdy import zapisuje rekord `ImportBatch` → możliwość wycofania całego importu później (Ustawienia → Historia importów). Wycofanie przywraca też zmiany, które import **zastąpił** (dlatego `ImportBatch` przechowuje kopie zastąpionych rekordów).
- Stan ekranu weryfikacji (wynik AI + decyzje użytkownika) zapisywany jako szkic w IndexedDB — jeśli iOS ubije aplikację w tle (np. użytkownik przełączy się na Zdjęcia, żeby porównać), po powrocie szkic się odtwarza (P-12). Szkic usuwany po imporcie lub odrzuceniu.
- Ekran nie pozwala zaimportować, dopóki są nierozstrzygnięte osoby (oznaczone na czerwono) — przycisk nieaktywny z podpowiedzią, co poprawić.

---

## 5. Model danych (Dexie)

```ts
// src/db/schema.ts
type ISODate = string; // 'YYYY-MM-DD'
type HHMM = string; // 'HH:MM'
type ShiftKind = 'work' | 'off' | 'vacation' | 'sick' | 'other';

interface Person {
  id: string; // uuid
  firstName: string;
  lastName?: string;
  color: string; // token z palety, np. 'blue' | 'green' | ...
  aliases: string[];
  isMe: boolean;
  archived: boolean;
  order: number; // kolejność w widoku zespołu (drag to reorder)
  createdAt: number;
}

interface Shift {
  id: string;
  personId: string;
  date: ISODate;
  kind: ShiftKind;
  start?: HHMM; // wymagane dla kind='work'
  end?: HHMM; // end <= start => koniec następnego dnia
  usesDefaultHours: boolean;
  note?: string;
  source: 'manual' | 'ai';
  importBatchId?: string;
  deletedAt?: number; // soft-delete pod „Cofnij”; fizyczne usunięcie po 30 dniach przy starcie
  updatedAt: number;
}
// indeksy: '&id, personId, date, [personId+date], importBatchId, deletedAt'
// UWAGA: unikalność [personId+date] egzekwowana w warstwie repozytorium (nie indeksem unikalnym),
// bo soft-delete zostawia stare rekordy. Każde zapytanie odfiltrowuje deletedAt.

interface ImportBatch {
  id: string;
  createdAt: number;
  model: string;
  promptVersion: string;
  imageThumb?: string; // miniatura jako data URL (JPEG ~200 px) — prostsze niż Blob w IndexedDB na iOS
  shiftIds: string[];
  replacedShifts: Shift[]; // kopie zastąpionych rekordów do pełnego wycofania
  revertedAt?: number;
}

interface ScanDraft {
  // szkic ekranu weryfikacji (P-12), id='current'
  id: 'current';
  createdAt: number;
  parsed: unknown; // znormalizowany wynik AI
  decisions: unknown; // dopasowania osób, rozwiązania konfliktów, ręczne poprawki
  imageThumb: string;
}

interface Settings {
  // pojedynczy rekord id='app'
  id: 'app';
  defaultHours: Record<0 | 1 | 2 | 3 | 4 | 5 | 6, { start: HHMM; end: HHMM }>; // 0 = niedziela
  weekStartsOn: 0 | 1;
  geminiApiKey?: string;
  geminiModel: string;
  aiPrivacyAcknowledged: boolean;
  theme: 'system' | 'light' | 'dark';
}
```

Domyślne `defaultHours`: `0–4 → 10:00–22:00`, `5–6 → 10:00–23:00`.

Migracje Dexie wersjonowane od początku (`db.version(1)`).

Usunięcie osoby: kaskadowo soft-delete jej zmian (jedna transakcja Dexie), z możliwością cofnięcia. Archiwizacja osoby ukrywa ją w nowych widokach, ale zachowuje w okresach, w których ma zmiany.

Kopia zapasowa JSON: `{ app: 'grafik', schemaVersion, exportedAt, persons, shifts, settings }` **bez klucza API** (P-19). Import kopii: walidacja zodem, podgląd („12 osób, 340 zmian”), wybór _Zastąp wszystko_ / _Scal_; przy niezgodnej wersji schematu — migracja albo czytelny błąd.

---

## 6. Design system „iOS 26 / Liquid Glass”

> Cel: aplikacja ma się czuć jak natywna. Nie kopiujemy zasobów Apple (ikon SF Symbols, czcionki SF z plików) — używamy systemowego stosu czcionek i własnych tokenów.

### 6.1 Typografia

```css
font-family:
  -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, 'Inter', 'Roboto', sans-serif;
```

Na iOS da to SF Pro, na Androidzie Roboto. Skala jak Dynamic Type (rozmiary w `rem`, respektuj ustawienia dostępności):

| Styl        | Rozmiar / waga |
| ----------- | -------------- |
| Large Title | 34 / 700       |
| Title 2     | 22 / 700       |
| Headline    | 17 / 600       |
| Body        | 17 / 400       |
| Subheadline | 15 / 400       |
| Footnote    | 13 / 400       |
| Caption     | 12 / 400       |

Cyfry godzin: `font-variant-numeric: tabular-nums`.

### 6.2 Kolory (tokeny, light/dark)

- Tła: `systemGroupedBackground` (#F2F2F7 / #000000), `secondarySystemGroupedBackground` (#FFFFFF / #1C1C1E), separatory 0.5 px `rgba(60,60,67,.29)` / `rgba(84,84,88,.6)`.
- Akcent: systemBlue `#007AFF` / `#0A84FF` (konfigurowalny).
- Paleta osób (light/dark): blue, green, orange, pink, purple, teal, indigo, red, yellow, mint, cyan, brown — wartości systemowe iOS.
- Tryb ciemny: `prefers-color-scheme` + ręczne przełączenie; `<meta name="theme-color">` aktualizowany dynamicznie.

### 6.3 Materiał Liquid Glass

Klasa `.glass` używana dla: tab bara, paska nawigacji po przewinięciu, przycisków pływających, sheetów, menu kontekstowych.

```css
.glass {
  background: color-mix(in srgb, var(--glass-tint) 55%, transparent);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 0.5px solid var(--glass-stroke); /* jasna krawędź */
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.35),
    /* połysk u góry */ 0 8px 32px rgba(0, 0, 0, 0.12);
}
```

- Fallback dla `prefers-reduced-transparency` / słabszych urządzeń: tło nieprzezroczyste.
- Nie nakładaj szkła na szkło (zasada iOS 26) — zawartość pod spodem ma być treścią.

### 6.4 Komponenty (folder `src/ui/`)

Każdy komponent z obsługą light/dark, `:active` (lekkie przyciemnienie + scale 0.97 sprężynowo), focus-visible, ARIA.

- **TabBar** — pływająca „kapsuła” glass u dołu z odstępem od krawędzi, z bezpieczną strefą (`env(safe-area-inset-bottom)`); aktywna zakładka z „soczewką” (podświetlona pigułka przesuwana sprężyną). Zmniejsza się przy przewijaniu w dół, wraca przy przewijaniu w górę.
- **Pływający przycisk akcji** obok tab bara (okrągły glass „+”) → menu: _Dodaj zmianę_, _Skanuj grafik_, _Eksportuj PDF_.
- **NavigationBar** z **Large Title**, który przy przewijaniu płynnie zwija się do małego tytułu w środku paska (IntersectionObserver / scroll-driven).
- **GroupedList / ListRow** (inset grouped, zaokrąglenia 26 px w stylu iOS 26, separatory od lewej krawędzi tekstu, chevron, wartość po prawej w kolorze secondary).
- **SwipeActions** w wierszach: przesunięcie w lewo → _Usuń_ (czerwony) i _Edytuj_; pełne przeciągnięcie = usunięcie.
- **Sheet** (modal od dołu) z detentami _medium_ / _large_, uchwyt (grabber), zamykanie przeciągnięciem w dół, przyciemnienie tła, tło strony lekko pomniejszone.
- **ContextMenu** po długim przytrzymaniu (long-press 450 ms) z rozmyciem tła.
- **SegmentedControl** (Tydzień / Miesiąc), **Toggle** (zielony iOS), **Stepper**.
- **Pickery czasu i daty** — natywne `<input type="time">` / `<input type="date">` (na iOS dają natywne kółka/kalendarz); stylizowane jako „pigułki” wartości jak w iOS.
- **Toast/Banner** z „Cofnij”.
- **ActionSheet / Alert** do potwierdzeń usuwania (styl iOS: akcja destrukcyjna na czerwono).
- **Skeleton + spinner** w stylu iOS (aktywność w trakcie skanowania z animowanym „skanowaniem” po miniaturze zdjęcia).

### 6.5 Ruch i haptyka

- Sprężyny: `stiffness 400, damping 32` (przyciski), `stiffness 300, damping 30` (sheety, przejścia).
- Przejścia między ekranami: push z prawej + lekka paralaksa poprzedniego ekranu; powrót gestem przeciągnięcia od lewej krawędzi (custom, bo w PWA standalone na iOS brak systemowego gestu wstecz). Gest aktywny tylko w pasie 20 px od lewej krawędzi i tylko na ekranach podrzędnych (nie na zakładkach głównych). Na Androidzie systemowy „wstecz” obsługiwany przez historię routera: zamyka najpierw otwarty sheet/menu, potem cofa ekran (P-15).
- `prefers-reduced-motion` → przejścia zanikające.
- Haptyka: `navigator.vibrate(10)` na Androidzie przy usunięciu/imporcie; na iOS API nie istnieje — brak błędów, po prostu pomiń.

---

## 7. Specyfika PWA i iOS

- `index.html`:
  - `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
  - `<meta name="apple-mobile-web-app-capable" content="yes">` + `mobile-web-app-capable`
  - `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`
  - `<meta name="apple-mobile-web-app-title" content="Grafik">`
  - `apple-touch-icon` 180×180 (bez przezroczystości).
- Manifest: `display: "standalone"`, `orientation: "portrait"`, `lang: "pl"`, ikony 192/512 + **maskable**, `theme_color`, `background_color`, `shortcuts` (_Skanuj grafik_, _Dodaj zmianę_), `share_target` (Android: udostępnienie zdjęcia z galerii prosto do skanowania).
- Splash screeny iOS (`apple-touch-startup-image`) — wygeneruj dla iPhone 12–17 (np. `pwa-asset-generator`).
- Layout: `min-height: 100dvh`, wszystkie krawędzie z `env(safe-area-inset-*)` (Dynamic Island, home indicator).
- Wyłącz zoom przy fokusie w polu: wszystkie inputy `font-size >= 16px`.
- `overscroll-behavior: none` na `html/body`; przewijanie tylko w kontenerach treści.
- `-webkit-tap-highlight-color: transparent`, `user-select: none` na elementach UI (nie na treściach).
- Trwałość danych: `navigator.storage.persist()` przy starcie; **Eksport/Import kopii zapasowej JSON** w Ustawieniach (iOS może czyścić dane stron nieużywanych, przypomnij o kopii co 30 dni).
- Instalacja: na iOS brak `beforeinstallprompt` → ekran onboardingu z instrukcją „Udostępnij → Do ekranu początkowego” (wykryj `navigator.standalone`). Na Androidzie — własny przycisk „Zainstaluj” na `beforeinstallprompt`.
- Service worker: precache app shell, `NetworkOnly` dla Gemini, komunikat „Dostępna nowa wersja — odśwież”. Nawigacje (`index.html`) obsługiwane z precache z rewizją, tak by deploy zawsze dawał spójny zestaw plików (P-09). Odświeżenie nie może przerwać otwartego sheetu ani ekranu weryfikacji — banner czeka, aż użytkownik skończy.
- **Dane w Safari i w zainstalowanej aplikacji to dwa osobne magazyny na iOS** (P-08). Onboarding w Safari (nie standalone) mówi wprost: „Zainstaluj aplikację przed wprowadzaniem danych — dane z przeglądarki nie przeniosą się do aplikacji na ekranie początkowym”. W razie potrzeby: eksport kopii w Safari → import w aplikacji.
- Klawiatura ekranowa na iOS nie zmniejsza layout viewportu: sheety z polami tekstowymi pozycjonuj z `window.visualViewport` (`resize`/`scroll`), żeby pole i przycisk „Zapisz” nie chowały się pod klawiaturą (P-05).
- `-webkit-touch-callout: none` i `user-select: none` na elementach z long-pressem, inaczej iOS pokaże własne menu/zaznaczenie zamiast naszego menu kontekstowego (P-06).
- Offline: wszystko poza skanowaniem działa; przycisk „Skanuj” pokazuje stan „Brak połączenia”.

---

## 8. Architektura informacji i ekrany

### 8.1 Zakładki (TabBar)

1. **Mój grafik** (ikona: user/clock)
2. **Zespół** (ikona: users / grid)
3. **Kalendarz** (ikona: calendar)
4. **Ustawienia** (ikona: settings)

- pływający przycisk „+”.

### 8.2 Mój grafik

- Karta „**Najbliższa zmiana**” (glass, duża): dzień, data, godziny, „za 2 dni”, z kim na zmianie (awatary-kółka z inicjałami w kolorach osób).
- Podsumowanie miesiąca: liczba zmian, suma godzin, liczba wolnych.
- Lista nadchodzących zmian pogrupowana po tygodniach (sekcje „Ten tydzień”, „Następny tydzień”, …), swipe → edytuj/usuń.
- Jeśli nikt nie jest oznaczony jako „Ja” → pusty stan z przyciskiem „Wybierz siebie z listy osób”.

### 8.3 Zespół — widok całego grafiku (najważniejszy widok czytelności)

- SegmentedControl: **Tydzień | Miesiąc**, nawigacja strzałkami + przycisk „Dziś”. Przesunięcie palcem w bok zmienia tydzień **tylko w trybie Tydzień** (siatka mieści się bez przewijania); w trybie Miesiąc poziomy gest przewija siatkę, a okres zmienia się wyłącznie strzałkami (P-07).
- Wybrany okres i tryb pamiętane między uruchomieniami (Zustand `persist`); po imporcie AI widok przechodzi do importowanego okresu.
- **Siatka**: wiersze = osoby, kolumny = dni.
  - Pierwsza kolumna (imię + kolorowa kropka + suma godzin) **przyklejona** (`position: sticky`) przy przewijaniu w poziomie.
  - Nagłówek dni przyklejony u góry: `Pn 13`, dzisiejszy dzień wyróżniony akcentem, weekendy lekko szare.
  - Pod nagłówkiem dnia: obsada (np. „4 os.”).
  - Komórka zmiany: zaokrąglona pigułka w kolorze osoby (tło 18% krycia, tekst w pełnym kolorze) z godzinami w 2 liniach (`10:00` / `22:00`) — czytelne na szerokości ~44 px. Wolne/urlop/L4 jako szare/kreskowane pigułki z literą `W`/`U`/`L4`.
  - Tryb tygodnia na iPhonie mieści 7 kolumn bez przewijania; tryb miesiąca przewija się poziomo.
- Tap w pustą komórkę → Sheet „Dodaj zmianę” z wypełnioną osobą, datą i godzinami domyślnymi.
- Tap w zmianę → Sheet edycji (godziny, typ, notatka, _Usuń_).
- Long-press na zmianie → menu kontekstowe: _Edytuj_, _Duplikuj na…_, _Usuń_.
- Filtr osób (chipsy na górze) i przełącznik „Ukryj osoby bez zmian w okresie”.
- Widok alternatywny (przełącznik w nawigacji): **lista dni** — każdy dzień jako sekcja z listą osób i godzin (dla bardzo wąskich ekranów i czytników ekranu).

### 8.4 Kalendarz

- Siatka miesiąca w stylu aplikacji Kalendarz iOS; pod każdym dniem kolorowe kropki osób w pracy (max 4 + „+2”).
- Tap w dzień → poniżej lista „Kto pracuje” z godzinami; przycisk „+ Dodaj zmianę w tym dniu”.

### 8.5 Dodawanie / edycja (Sheet)

Pola:

1. **Osoby** — wielokrotny wybór (chipsy), domyślnie ostatnio użyta lub „Ja”.
2. **Dni** — mini-kalendarz z **wielokrotnym zaznaczaniem** (tap kolejnych dni, przeciągnięcie palcem zaznacza zakres) + szybkie akcje: „Cały tydzień”, „Pn–Pt”, „Weekendy”, „Powtórz co tydzień do…”.
3. **Typ** — Praca / Wolne / Urlop / L4 (SegmentedControl).
4. **Godziny** — przełącznik „Domyślne wg dnia” (włączony: pokazuje podgląd, np. „Pt–Sb 10:00–23:00, pozostałe 10:00–22:00”); wyłączony: dwa pickery czasu.
5. **Notatka** (opcjonalna).

Walidacje: koniec po starcie; konflikt (osoba ma już wpis w tym dniu) → alert _Zastąp / Pomiń_.
Po zapisie: toast „Dodano 6 zmian” + _Cofnij_.

Usuwanie: swipe w liście, przycisk w sheecie edycji, zaznaczanie wielu w widoku zespołu (tryb „Wybierz” w pasku nawigacji → zaznacz komórki → _Usuń zaznaczone_). Zawsze z możliwością cofnięcia.

### 8.6 Skanowanie (pełny przepływ)

`+ → Skanuj grafik` → Sheet: _Zrób zdjęcie_ / _Wybierz z biblioteki_ / _Wklej ze schowka_ (+ pole „przytrzymaj i wklej” jako zapas, 4.3a) → podgląd (obrót, kadr, „Dodaj kolejną stronę”) → opcjonalnie wybór miesiąca → _Analizuj_ → ekran postępu (animacja skanowania po zdjęciu, możliwość anulowania) → **ekran weryfikacji (4.7)** → _Importuj_ → przejście do widoku Zespół na zaimportowanym okresie.

Brak klucza API → zamiast analizy sheet „Skonfiguruj skanowanie AI” z instrukcją krok po kroku i polem na klucz.

### 8.7 Eksport PDF (Sheet)

Opcje:

- **Zakres**: ten tydzień / ten miesiąc / własny zakres dat.
- **Osoby**: wszyscy / wybrane / tylko ja.
- **Układ**: _Siatka zespołu_ (A4 poziomo) / _Lista mojego grafiku_ (A4 pionowo).
- **Kolory**: kolorowy / do druku czarno-biały.
- Przełączniki: pokaż sumy godzin, pokaż obsadę dzienną, pokaż notatki.

Przyciski: **Podgląd**, **Udostępnij**, **Zapisz/Pobierz** (fallback).

**Ważne — kolejność (P-02):** `navigator.share()` na iOS musi zostać wywołane krótko po geście użytkownika. Generowanie PDF (ładowanie pdfmake + czcionek + budowa dokumentu) trwa za długo i „zjada” ten gest → `NotAllowedError`. Dlatego:

1. Po otwarciu sheetu i przy każdej zmianie opcji (z debounce 300 ms) PDF generuje się **w tle** do `Blob` + `File` (`type: 'application/pdf'`); przycisk „Udostępnij” pokazuje spinner, dopóki plik nie jest gotowy.
2. Kliknięcie „Udostępnij” wywołuje `navigator.share({ files: [file], title })` **bez żadnego `await` przed nim**.
3. Sprawdzenie `navigator.canShare?.({ files: [file] })`; jeśli `false` → przycisk „Zapisz”.
4. `AbortError` (użytkownik zamknął arkusz) to nie błąd — bez komunikatu.

**Podgląd i pobieranie w PWA na iOS (P-03):** `<a download>` / `window.open(blobUrl)` w trybie standalone potrafi otworzyć PDF w widoku bez przycisku powrotu, z którego nie da się wyjść. Na iOS podgląd renderuj **wewnątrz aplikacji** (pierwsza strona jako obraz przez lekkie renderowanie lub prosty podgląd HTML odwzorowujący układ), a „Zapisz” realizuj przez arkusz udostępniania (opcja _Zachowaj w Plikach_). Bezpośrednie pobieranie tylko na Androidzie/desktopie.

Nazwa pliku: `Grafik_2026-11.pdf` / `Grafik_2026-11-03_2026-11-09.pdf`.

### 8.8 Ustawienia

- **Osoby**: lista (kolejność drag&drop), dodaj/edytuj (imię, nazwisko, kolor, aliasy, „To ja”), archiwizuj, usuń (z potwierdzeniem i informacją, ile zmian zostanie usuniętych).
- **Godziny domyślne**: 7 wierszy (Nd–Sb) z pickerami.
- **Kalendarz**: pierwszy dzień tygodnia.
- **Skanowanie AI**: klucz API, model, „Testuj połączenie”, informacja o prywatności darmowego planu.
- **Wygląd**: system/jasny/ciemny, kolor akcentu.
- **Dane**: eksport kopii (JSON), import kopii, historia importów AI (z wycofaniem), wyczyść wszystko.
- **O aplikacji**: wersja, „Jak zainstalować”.

### 8.9 Pierwsze uruchomienie (onboarding, 3 ekrany)

1. Powitanie + instrukcja instalacji (iOS/Android wykrywane).
2. „Jak masz na imię?” → tworzy osobę „Ja”.
3. Godziny domyślne (wstępnie wypełnione wg sekcji 1.1) → _Gotowe_. Skanowanie AI można skonfigurować później.

---

## 9. PDF — wymagania wizualne

**Siatka zespołu (A4 poziomo):**

- Nagłówek: tytuł „Grafik pracy”, okres („Listopad 2026” lub „3–9 listopada 2026”), data wygenerowania drobnym drukiem.
- Tabela: pierwsza kolumna osoby (kolorowy pasek + imię), kolumny dni z nagłówkiem dwuliniowym (`Pn` / `3`), weekendy lekko szare (#F2F2F7), dzisiejszy dzień bez wyróżnienia (PDF to dokument).
- Komórki: godziny `10–22` (krótki format, bo przy miesiącu ~31 kolumn); wolne `W`, urlop `U`, L4 `L4`.
- Ostatnia kolumna „Σ h”; ostatni wiersz „Obsada”.
- Reguła podziału (deterministyczna): zakres ≤ 16 dni → jedna szerokość strony; zakres > 16 dni → **zawsze** dwie części (dni 1–15 i 16–koniec) z powtórzoną kolumną osób i sumami cząstkowymi + łączną sumą w drugiej części. Wiersze: jeśli osób jest więcej niż mieści się na stronie (licz od wysokości wiersza ≥ 18 pt), tabela łamie się na kolejną stronę z powtórzonym nagłówkiem dni (`headerRows: 1`/`2`). Minimalny rozmiar czcionki w komórkach: 7.5 pt — nigdy mniejszy.
- Długie imiona przycinane z wielokropkiem do szerokości kolumny; w kolumnie osób zawsze imię + inicjał nazwiska, gdy dwie osoby mają to samo imię.
- Okres bez żadnych zmian → PDF nie jest generowany; komunikat „Brak zmian w wybranym okresie”.
- Legenda na dole: kolory osób, skróty, godziny domyślne.
- Stopka: „Strona X z Y”.

**Lista osoby (A4 pionowo):** nagłówek z imieniem, tabela: data | dzień | godziny | h | notatka; podsumowanie: liczba zmian, suma godzin.

**Technika:** pdfmake, osadzona czcionka (Inter Regular/SemiBold/Bold) w `vfs` ładowana **leniwie** (dynamiczny `import()` dopiero przy eksporcie, żeby nie obciążać startu aplikacji). Test snapshot: wygenerowany PDF → sprawdzenie, że zawiera „ąęłńóśźż” poprawnie.

---

## 10. Struktura projektu

```
grafik-pwa/
├─ CLAUDE.md                 # skrót zasad z tego planu dla Claude Code
├─ index.html
├─ vite.config.ts            # vite-plugin-pwa, manifest
├─ public/
│  ├─ icons/                 # 192, 512, maskable, apple-touch-icon
│  └─ splash/
├─ src/
│  ├─ main.tsx
│  ├─ app/                   # App, router, providers, onboarding
│  ├─ ui/                    # design system: TabBar, Sheet, ListRow, Glass, ...
│  │  └─ tokens.css
│  ├─ features/
│  │  ├─ my-schedule/
│  │  ├─ team/               # TeamGrid, ShiftCell, DayHeader
│  │  ├─ calendar/
│  │  ├─ shift-editor/       # Sheet dodawania/edycji, multi-date picker
│  │  ├─ scan/               # ImagePicker, Preview, Progress, ReviewImport
│  │  ├─ pdf/                # PdfOptionsSheet, builders/teamGrid.ts, builders/personList.ts
│  │  └─ settings/
│  ├─ ai/
│  │  ├─ gemini.ts           # klient REST, retry, timeout
│  │  ├─ prompt.ts
│  │  ├─ schema.ts           # responseSchema + zod
│  │  ├─ image.ts            # kompresja, orientacja, base64
│  │  └─ normalize.ts        # post-processing, dopasowanie osób
│  ├─ db/                    # Dexie: schema, repozytoria, seed, backup
│  ├─ domain/                # czysta logika: godziny domyślne, sumy, konflikty, daty
│  └─ store/                 # Zustand (stan UI: wybrany okres, filtry)
├─ worker/                   # (wariant B) Cloudflare Worker proxy
├─ tests/
│  ├─ unit/                  # Vitest
│  ├─ e2e/                   # Playwright (iPhone 12, Pixel 7)
│  └─ fixtures/
│     ├─ gemini-responses/   # zapisane odpowiedzi JSON do testów bez sieci
│     └─ photos/             # przykładowe zdjęcia grafików (dostarczy użytkownik)
└─ package.json
```

---

## 11. Jakość, dostępność, wydajność

- Lighthouse (mobile): PWA installable ✓, Performance ≥ 90, Accessibility ≥ 95.
- Bundle startowy < 200 kB gzip (pdfmake i czcionki ładowane leniwie).
- Obszary dotyku ≥ 44×44 pt; kontrast WCAG AA także na szkle (dlatego tint glass ≥ 55%).
- Czytniki ekranu: komórki siatki z `aria-label` („Katarzyna, wtorek 4 listopada, 10:00–22:00”).
- Obsługa większego tekstu systemowego (rem) — siatka przechodzi wtedy na widok listy dni.
- Testy jednostkowe dla: godzin domyślnych wg dnia tygodnia, sum godzin, normalizacji odpowiedzi AI, dopasowania imion, wykrywania konfliktów, generowania nazw plików PDF.
- E2E: dodanie zmiany przez sheet, usunięcie swipe’em + cofnięcie, import z zamockowaną odpowiedzią Gemini (route interception), eksport PDF (sprawdzenie, że plik powstał).

---

## 12. Fazy realizacji (z kryteriami akceptacji)

### Faza 1 — Szkielet i PWA

- [x] Vite + React + TS strict, ESLint, Prettier, Vitest, Playwright.
- [x] vite-plugin-pwa: manifest, ikony (placeholder), service worker, meta-tagi iOS.
- [x] Safe areas, `100dvh`, brak zoomu na inputach, `overscroll-behavior`.
- [x] `CLAUDE.md` ze skrótem zasad.
- **Akceptacja:** aplikacja instaluje się na iPhonie (Do ekranu początkowego) i Androidzie, otwiera się bez paska przeglądarki, treść nie wchodzi pod Dynamic Island ani home indicator.

### Faza 2 — Design system

- [x] Tokeny (typografia, kolory light/dark, paleta osób), klasa `.glass`.
- [x] TabBar (kapsuła + soczewka), NavigationBar z Large Title, GroupedList/ListRow, Sheet z detentami, SwipeActions, ContextMenu, SegmentedControl, Toggle, Toast z Cofnij, Alert/ActionSheet.
- [x] Strona `/_dev/ui` z katalogiem komponentów (tylko w trybie dev).
- **Akceptacja:** wszystkie komponenty działają dotykiem na iPhone 12 (Playwright + ręcznie), animacje 60 fps, poprawny tryb ciemny.

### Faza 3 — Dane i domena

- [x] Dexie: schemat v1, repozytoria, `storage.persist()`.
- [x] `domain/`: godziny domyślne (Nd–Czw 10–22, Pt–Sb 10–23), sumy godzin, obsada, konflikty — z testami.
- [x] Eksport/import kopii JSON.
- **Akceptacja:** testy jednostkowe zielone; dane przetrwają przeładowanie i tryb offline.

### Faza 4 — Osoby, onboarding, ustawienia

- [x] Onboarding 3 ekrany, osoba „Ja”.
- [x] CRUD osób z kolorami, aliasami, kolejnością.
- [x] Ustawienia godzin domyślnych, motyw, pierwszy dzień tygodnia.

### Faza 5 — Ręczne zarządzanie grafikiem

- [x] Sheet dodawania: wiele osób × wiele dni, szybkie zaznaczenia, godziny domyślne, typy wpisów.
- [x] Edycja, usuwanie (swipe, sheet, tryb zaznaczania), cofanie.
- [x] Walidacja konfliktów.
- **Akceptacja:** dodanie 2 osobom zmian na cały tydzień w ≤ 5 tapnięciach; piątek i sobota automatycznie 10:00–23:00.

### Faza 6 — Widoki

- [ ] Zespół: siatka tydzień/miesiąc, sticky kolumna i nagłówek, sumy, obsada, filtry, widok listy dni.
- [ ] Mój grafik: najbliższa zmiana, podsumowanie, lista.
- [ ] Kalendarz miesięczny z kropkami.
- **Akceptacja:** tydzień 8 osób czytelny na iPhone 12 (390 pt) bez przewijania w poziomie.

### Faza 7 — Skanowanie AI

- [ ] Spike Gemini z prawdziwego iPhone’a i Androida (4.1) → `docs/spike-gemini.md`.
- [ ] Ustawienia klucza + test połączenia + lista modeli.
- [ ] Wybór/aparat, podgląd, obrót, kadr, wiele stron, kompresja.
- [ ] **Wklejanie ze schowka**: przycisk `clipboard.read()` + pole „przytrzymaj i wklej” + `paste` globalnie (4.3a).
- [ ] Szkic ekranu weryfikacji odtwarzany po ubiciu aplikacji (P-12).
- [ ] Klient Gemini (schema, timeout, 429, retry, anuluj).
- [ ] Normalizacja + dopasowanie osób + aliasy.
- [ ] Ekran weryfikacji z konfliktami, niską pewnością, miniaturą zdjęcia.
- [ ] ImportBatch + wycofanie importu.
- **Akceptacja:** na przykładowych zdjęciach z `tests/fixtures/photos` ≥ 95% komórek poprawnie po weryfikacji; każdy import da się cofnąć.

### Faza 8 — PDF

- [ ] Sheet opcji, dwa układy, podział na strony, legenda, sumy.
- [ ] Polskie znaki, tryb czarno-biały.
- [ ] Web Share API z plikiem + fallback pobierania.
- **Akceptacja:** PDF miesiąca dla 10 osób czytelny po wydruku A4; udostępnianie otwiera natywny arkusz na iOS i Androidzie.

### Faza 9 — Dopracowanie

- [ ] Ikony i splash screeny finalne, skróty w manifeście, `share_target` (Android).
- [ ] Puste stany, komunikaty błędów po polsku, `prefers-reduced-motion/transparency`.
- [ ] Lighthouse, audyt dostępności, testy E2E na iPhone 12 / Pixel 7.
- [ ] (Opcjonalnie) wariant B: Cloudflare Worker proxy.
- [ ] Deploy (Cloudflare Pages / Vercel) + instrukcja w README.

### Faza 10 — Audyt końcowy (obowiązkowy, przed oddaniem)

- [ ] Przejdź **całą** sekcję 16.2 (audyt końcowy) i zapisz wynik w `docs/audit-report.md`.
- [ ] Każda pułapka `P-xx` z sekcji 15 ma wskazany plik z rozwiązaniem i test/punkt scenariusza ręcznego (tabela w raporcie).
- [ ] Każdy wiersz macierzy z sekcji 17 ma test automatyczny albo punkt scenariusza ręcznego.
- [ ] Naprawione wszystkie znalezione błędy o wadze _krytyczny_ i _wysoki_; pozostałe opisane w raporcie z uzasadnieniem.
- [ ] Przygotowany `docs/manual-test.md` — scenariusz z sekcji 18 do odhaczenia przez użytkownika na telefonie.

---

## 13. Pomysły na później (poza MVP)

- Synchronizacja między urządzeniami / współdzielony grafik zespołu (np. Supabase).
- Eksport do kalendarza (`.ics`) dla „moich zmian”.
- Powiadomienia web push o zmianie następnego dnia (iOS 16.4+ dla zainstalowanych PWA).
- Wymiana zmian między osobami, wiele lokalizacji/grafików.
- Statystyki (godziny miesięcznie, rozkład weekendów).

---

## 14. Instrukcja dla Claude Code (do wklejenia na start)

```
Przeczytaj plan-grafik-pwa.md w całości. Realizuj go fazami, zaczynając od Fazy 1.
Zasady:
- Nie umieszczaj żadnego klucza API w kodzie ani w repo — klucz wpisuje użytkownik w Ustawieniach.
- Interfejs po polsku, wygląd i zachowanie jak iOS 26 (sekcja 6).
- Przed implementacją funkcji sprawdź Rejestr pułapek (sekcja 15) i zastosuj opisane rozwiązania.
- Czysta logika w src/domain i src/ai/normalize.ts — zawsze z testami Vitest.
- Po każdej fazie: testy (unit + E2E na profilach iPhone 12/WebKit i Pixel 7/Chromium)
  oraz protokół audytu fazy (16.1) — samodzielnie szukaj błędów i je naprawiaj, zanim oznaczysz fazę jako gotową.
- Na koniec fazy: commit, odhacz checklistę, krótko podsumuj, co zrobiłeś, jakie błędy znalazł audyt
  i które punkty scenariusza ręcznego (sekcja 18) sprawdzić na telefonie.
- Nie oznaczaj niczego jako gotowe, jeśli testy nie przechodzą albo zostały pominięte/wyłączone.
- Gdy coś w planie jest niejasne albo sprzeczne — zapytaj, zanim zbudujesz.
```

---

## 15. Rejestr pułapek (znane błędy platform i ich rozwiązania)

| ID   | Problem                                                                                          | Gdzie            | Rozwiązanie (obowiązkowe)                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P-01 | `navigator.clipboard.read()` odrzucone, jeśli przed nim był `await` albo wywołano je poza gestem | iOS, Android     | `read()` jako pierwsze w handlerze kliknięcia; ścieżka zapasowa z polem `paste` (4.3a)                                                                                                     |
| P-02 | `navigator.share()` rzuca `NotAllowedError` po długim `await` (generowanie PDF)                  | iOS              | PDF generowany wcześniej w tle; `share()` bez `await` przed nim (8.7)                                                                                                                      |
| P-03 | PDF otwarty z blob URL w trybie standalone = ekran bez wyjścia                                   | iOS PWA          | Podgląd wewnątrz aplikacji, zapis przez arkusz udostępniania (8.7)                                                                                                                         |
| P-04 | `new Date('YYYY-MM-DD')` / `toISOString()` przesuwa daty o dzień                                 | wszędzie         | Tylko helpery z `src/domain/dates.ts` (1.4); reguła ESLint `no-restricted-syntax` blokująca te wzorce poza tym plikiem                                                                     |
| P-05 | Klawiatura zasłania pola i przycisk w sheecie                                                    | iOS              | Pozycjonowanie z `visualViewport` (sekcja 7)                                                                                                                                               |
| P-06 | Long-press uruchamia systemowe zaznaczanie/menu                                                  | iOS              | `-webkit-touch-callout: none`, `user-select: none`, `contextmenu` → `preventDefault`                                                                                                       |
| P-07 | Konflikt gestów: zmiana tygodnia vs przewijanie siatki vs swipe-back vs swipe-actions            | wszędzie         | Jeden menedżer gestów; priorytety: krawędź 20 px → wstecz, wiersz listy → swipe-actions, siatka miesiąca → scroll, siatka tygodnia → zmiana tygodnia; kierunek rozpoznawany po 10 px ruchu |
| P-08 | Dane w Safari ≠ dane aplikacji z ekranu początkowego                                             | iOS              | Komunikat w onboardingu w Safari + eksport/import kopii (sekcja 7)                                                                                                                         |
| P-09 | Po deployu aplikacja ładuje stare/mieszane pliki                                                 | iOS PWA          | Precache z rewizjami, banner aktualizacji, `skipWaiting` dopiero po akceptacji                                                                                                             |
| P-10 | `backdrop-filter` na wielu elementach → przycięcia animacji na iPhone 12                         | iOS              | Max ~3 jednocześnie widoczne warstwy glass; komórki siatki **bez** blur; test płynności miesiąca z 15 osobami                                                                              |
| P-11 | `100vh` uwzględnia paski Safari / skacze                                                         | iOS              | `100dvh`, `env(safe-area-inset-*)`                                                                                                                                                         |
| P-12 | iOS ubija PWA w tle → utrata ekranu weryfikacji i niezapisanych formularzy                       | iOS              | Szkic `ScanDraft` w IndexedDB; formularze sheetów zapisują szkic przy `visibilitychange: hidden`                                                                                           |
| P-13 | Zoom strony przy fokusie pola < 16 px                                                            | iOS              | Wszystkie pola ≥ 16 px                                                                                                                                                                     |
| P-14 | Pole „przytrzymaj i wklej” otwiera klawiaturę                                                    | iOS, Android     | `inputmode="none"`, brak autofokusu                                                                                                                                                        |
| P-15 | „Wstecz” na Androidzie zamyka aplikację zamiast sheetu                                           | Android          | Każdy sheet/menu dodaje wpis do historii (`pushState`), `popstate` go zamyka                                                                                                               |
| P-16 | Polskie znaki w PDF jako krzaki/puste                                                            | PDF              | Osadzona czcionka z polskimi glifami; test z „Zażółć gęślą jaźń”                                                                                                                           |
| P-17 | Dopasowanie imion: `ł` nie znika w NFD                                                           | import AI        | Ręczna mapa `ł→l`, `Ł→L` przed porównaniem                                                                                                                                                 |
| P-18 | Kilka kart/okien aplikacji naraz → rozjazd danych                                                | desktop, Android | Dexie `liveQuery`; danych domenowych nie kopiujemy do Zustand                                                                                                                              |
| P-19 | Klucz API wycieka w kopii zapasowej/logach/URL                                                   | wszędzie         | Klucz pomijany w eksporcie, maskowany w logach (`****xyz`), nigdy w URL                                                                                                                    |
| P-20 | `input type="time"` na Androidzie w formacie 12 h lub z sekundami                                | Android          | Wartość czytana zawsze jako `HH:MM` (obcięcie sekund), wyświetlanie własnym formatterem 24 h                                                                                               |
| P-21 | Bardzo duże zrzuty ekranu (PNG > 10 MB) zawieszają kompresję                                     | iOS              | `createImageBitmap` z `resizeWidth/resizeHeight` (skalowanie przy dekodowaniu), fallback canvas; limit 40 MP z komunikatem                                                                 |
| P-22 | HEIC z aplikacji „Pliki” nie dekoduje się w Chrome Android                                       | Android          | Komunikat „Ten format nie jest obsługiwany — zrób zrzut ekranu lub zapisz jako JPG”                                                                                                        |
| P-23 | Zmiana czasu (DST) zmienia długość zmiany                                                        | wszędzie         | Arytmetyka minut na `HH:MM` (1.1); testy na 25.10.2026 i 28.03.2027                                                                                                                        |
| P-24 | Sticky kolumna + sticky nagłówek w jednym kontenerze gubią się na iOS                            | iOS              | Jeden kontener `overflow: auto` dla obu osi; lewy górny narożnik z wyższym `z-index`; test wizualny                                                                                        |
| P-25 | Utrata połączenia w trakcie zapytania AI                                                         | wszędzie         | Obsługa `TypeError`, przycisk „Ponów” z zachowanym zdjęciem (bez ponownego wyboru)                                                                                                         |

Nowe pułapki odkryte w trakcie pracy dopisuj do tej tabeli (kolejne numery).

---

## 16. Protokół audytu (samokontrola Claude Code)

### 16.1 Po każdej fazie — zanim oznaczysz ją jako gotową

1. **Testy:** `npm run typecheck && npm run lint && npm run test && npm run e2e` — wszystko zielone, bez `skip`/`only`.
2. **Przegląd własnego kodu** (przeczytaj diff fazy linia po linii) pod kątem:
   - obsługi błędów: każdy `await` na sieci/IndexedDB/plikach ma ścieżkę błędu z polskim komunikatem,
   - stanów: ładowanie / pusto / błąd / sukces — każdy ekran ma wszystkie cztery,
   - pułapek `P-xx` dotyczących tej fazy,
   - podwójnych akcji: szybkie podwójne tapnięcie „Zapisz/Importuj/Udostępnij” nie może wykonać akcji dwa razy (przycisk blokowany do zakończenia),
   - wycieków: `URL.revokeObjectURL`, sprzątanie listenerów i `AbortController` przy odmontowaniu,
   - dostępności: etykiety ARIA, kontrast, obszary dotyku ≥ 44 pt.
3. **Testy eksploracyjne:** uruchom aplikację w Playwright na profilach `iPhone 12` (WebKit) i `Pixel 7` (Chromium), w trybie jasnym i ciemnym, przeklikaj nowe przepływy i przypadki brzegowe z sekcji 17. Zrzuty nowych ekranów zapisz do `docs/screens/fazaN/` i **obejrzyj je**: nic nie nachodzi na Dynamic Island / pasek na dole, teksty się nie ucinają, nic nie wychodzi poza ekran.
4. **Konsola:** zero błędów i ostrzeżeń Reacta podczas testów eksploracyjnych.
5. **Raport fazy** (krótko w odpowiedzi): co zrobiono, jakie błędy znalazł audyt i jak naprawiono, które punkty sekcji 18 sprawdzić na telefonie.

Waga błędów: **krytyczny** (utrata/uszkodzenie danych, crash, główna funkcja nie działa), **wysoki** (złe godziny/daty, funkcja nie działa na jednej platformie), **średni** (UX, wygląd), **niski** (kosmetyka). Krytyczne i wysokie naprawiasz przed przejściem do następnej fazy.

### 16.2 Audyt końcowy (Faza 10) — lista kontrolna

**Dane i logika**

- [ ] Godziny domyślne poprawne dla każdego dnia tygodnia (Nd–Czw 12 h, Pt–Sb 13 h) — test parametryczny na pełny miesiąc.
- [ ] Sumy godzin w widoku zespołu, „Mój grafik” i PDF identyczne (jedna funkcja, test porównawczy).
- [ ] Zmiana godzin domyślnych nie modyfikuje historii; pytanie o aktualizację przyszłych działa.
- [ ] Soft-delete + Cofnij dla: pojedynczej zmiany, wielu zmian, osoby z kaskadą, importu AI (z przywróceniem zastąpionych).
- [ ] Brak duplikatów osoba+dzień po: ręcznym dodaniu, imporcie AI, imporcie kopii, cofnięciu.
- [ ] Daty poprawne o 23:30 i 00:30 czasu polskiego i przy zmianie czasu (testy z fałszywym zegarem, `TZ=Europe/Warsaw` i `TZ=America/New_York`).
- [ ] Eksport → wyczyszczenie danych → import kopii daje identyczny stan (test round-trip).

**Skanowanie AI**

- [ ] Wszystkie źródła (aparat, galeria, przycisk schowka, pole „przytrzymaj i wklej”, Ctrl/Cmd+V, drag&drop) trafiają do tego samego podglądu.
- [ ] Każdy błąd z 4.1 ma swój komunikat (mocki: 400, 401, 403, 404, 429 z `retryDelay`, 500, timeout, offline, pusta odpowiedź, niepoprawny JSON, JSON niezgodny ze schematem).
- [ ] Normalizacja przetestowana na fixtures: grafik transponowany, z legendą, z godzinami w komórkach, ze znacznikami X, z przekreśleniami, dwie strony.
- [ ] Nie da się zaimportować przy nierozstrzygniętych osobach; po ubiciu aplikacji szkic wraca.
- [ ] Aliasy zapisują się; przy kolejnym imporcie dopasowanie jest automatyczne.

**Widoki i interakcje**

- [ ] Tydzień z 8 osobami bez poziomego przewijania na 390 pt; miesiąc z 15 osobami przewija się płynnie, sticky działa.
- [ ] Gesty z P-07 bez wzajemnych konfliktów.
- [ ] Sheety: detenty, zamykanie gestem, klawiatura nie zasłania, „wstecz” na Androidzie.
- [ ] Puste stany: brak osób, brak zmian, brak „Ja”, brak klucza API, brak sieci.
- [ ] Tryb jasny i ciemny na każdym ekranie (zrzuty).
- [ ] Tekst systemowy 200% nie psuje układu.

**PDF**

- [ ] Tydzień i miesiąc × 1 / 10 / 25 osób × kolor / cz-b × z notatkami / bez — warianty generowane w teście do `docs/pdf-samples/`, zrasteryzowane do PNG i obejrzane.
- [ ] Polskie znaki, podział na części, powtarzane nagłówki, numeracja stron.
- [ ] Udostępniany plik ma rozszerzenie `.pdf`, typ `application/pdf` i poprawną nazwę.

**PWA**

- [ ] Lighthouse mobile: installable, Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95.
- [ ] Offline: uruchomienie bez sieci, pełna edycja, eksport PDF (czcionki w precache).
- [ ] Aktualizacja wersji nie przerywa pracy i nie gubi danych.
- [ ] Ikona, nazwa, splash, kolor paska statusu na iOS i Androidzie.

**Bezpieczeństwo i prywatność**

- [ ] Przeszukanie `src/` i `dist/` nie znajduje żadnego klucza API; build nie zawiera `.env` z kluczem.
- [ ] Klucz nie trafia do kopii zapasowej, logów ani URL.
- [ ] Komunikat o prywatności darmowego API przed pierwszym skanem.
- [ ] Content-Security-Policy na hostingu: `connect-src 'self' https://generativelanguage.googleapis.com` (+ adres proxy w wariancie B).

---

## 17. Macierz przypadków brzegowych

Każdy wiersz = test automatyczny (U = Vitest, E = Playwright) lub punkt ręczny (M, sekcja 18).

| #    | Obszar     | Przypadek                                           | Oczekiwane zachowanie                                      | Test                 |
| ---- | ---------- | --------------------------------------------------- | ---------------------------------------------------------- | -------------------- |
| E-01 | Dodawanie  | Zmiana w piątek z godzinami domyślnymi              | 10:00–23:00, 13 h                                          | U                    |
| E-02 | Dodawanie  | Zmiana w niedzielę                                  | 10:00–22:00, 12 h                                          | U                    |
| E-03 | Dodawanie  | Wiele osób × wiele dni, część dni zajęta            | Alert z liczbą kolizji; Zastąp/Pomiń działa                | E                    |
| E-04 | Dodawanie  | Koniec przed początkiem (18:00–02:00)               | Dopisek „+1 dzień”, ostrzeżenie, 8 h                       | U+E                  |
| E-05 | Dodawanie  | Koniec = początek                                   | Błąd walidacji, zapis zablokowany                          | U                    |
| E-06 | Dodawanie  | Podwójne tapnięcie „Zapisz”                         | Jeden zapis                                                | E                    |
| E-07 | Usuwanie   | Swipe → Usuń → Cofnij                               | Zmiana wraca z tym samym id                                | E                    |
| E-08 | Usuwanie   | Usunięcie osoby z 40 zmianami → Cofnij              | Osoba i 40 zmian wracają                                   | U+E                  |
| E-09 | Daty       | Dodanie zmiany o 23:50 na „dziś”                    | Data = bieżący dzień lokalny                               | U (fałszywy zegar)   |
| E-10 | Daty       | Okres z 25.10.2026 (zmiana czasu)                   | Sumy bez odchyleń                                          | U                    |
| E-11 | Daty       | Luty 2027 / luty 2028 (przestępny)                  | Poprawna liczba dni w siatce i PDF                         | U                    |
| E-12 | Daty       | Tydzień 28.12–03.01                                 | Poprawne lata w widoku i PDF                               | U+E                  |
| E-13 | Schowek    | iOS: „Wklej ze schowka” → dymek „Wklej”             | Podgląd ze zdjęciem                                        | M                    |
| E-14 | Schowek    | W schowku tekst/link                                | Komunikat „W schowku nie ma zdjęcia…”                      | E                    |
| E-15 | Schowek    | Odmowa uprawnień (Android)                          | Instrukcja + pole „przytrzymaj i wklej”                    | E                    |
| E-16 | Schowek    | Wklejenie dużego zrzutu ekranu (PNG)                | Kompresja < 1,5 MB, bez zawieszenia                        | U+M                  |
| E-17 | AI         | Brak klucza                                         | Sheet konfiguracji zamiast analizy                         | E                    |
| E-18 | AI         | 429 z `retryDelay: 30s`                             | Odliczanie i automatyczne ponowienie                       | U                    |
| E-19 | AI         | Offline w trakcie analizy                           | Komunikat + „Ponów” bez ponownego wyboru zdjęcia           | E                    |
| E-20 | AI         | Odpowiedź z datą 31.11                              | Wpis w Ostrzeżeniach, nieimportowany                       | U                    |
| E-21 | AI         | „Kasia” i „Katarzyna N.” → ta sama osoba            | Oba oznaczone, wymuszona decyzja                           | U+E                  |
| E-22 | AI         | „Łukasz” vs „Lukasz”                                | Pewne dopasowanie                                          | U                    |
| E-23 | AI         | Grafik transponowany                                | Poprawne przypisania (fixture)                             | U                    |
| E-24 | AI         | Import → Cofnij import (z zastąpionymi zmianami)    | Stan sprzed importu 1:1                                    | U+E                  |
| E-25 | AI         | Aplikacja ubita na ekranie weryfikacji              | Szkic odtworzony                                           | M (+E przeładowanie) |
| E-26 | Widok      | 0 osób / 0 zmian                                    | Puste stany z akcją                                        | E                    |
| E-27 | Widok      | 25 osób, miesiąc                                    | Płynne przewijanie, sticky OK                              | M                    |
| E-28 | Widok      | Imię 30 znaków                                      | Wielokropek, siatka się nie rozpycha                       | E (zrzut)            |
| E-29 | Widok      | Dwie osoby o tym samym imieniu                      | Inicjał nazwiska w siatce i PDF                            | U+E                  |
| E-30 | PDF        | Okres bez zmian                                     | Komunikat, brak pliku                                      | E                    |
| E-31 | PDF        | 31 dni × 25 osób                                    | 2 części × N stron, czcionka ≥ 7,5 pt, powtarzane nagłówki | U (+ podgląd PNG)    |
| E-32 | PDF        | iOS: zamknięcie arkusza udostępniania               | Brak komunikatu błędu                                      | M                    |
| E-33 | PDF        | Offline                                             | PDF się generuje (czcionki z cache)                        | E                    |
| E-34 | Kopia      | Kopia z innej wersji schematu                       | Migracja lub czytelny błąd                                 | U                    |
| E-35 | Kopia      | Uszkodzony JSON                                     | Błąd, dane bez zmian                                       | U                    |
| E-36 | Ustawienia | Zmiana godzin domyślnych przy istniejących zmianach | Pytanie o przyszłe; historia bez zmian                     | U+E                  |
| E-37 | PWA        | Nowa wersja w trakcie edycji                        | Banner czeka; formularz nie ginie                          | E                    |
| E-38 | Dostępność | VoiceOver na siatce                                 | Czytelne etykiety komórek                                  | M                    |

---

## 18. Ręczny scenariusz testów na telefonie (dla użytkownika)

Claude Code generuje z tej sekcji `docs/manual-test.md` z polami do odhaczenia. Czas: ok. 20 min na iPhonie i 15 min na Androidzie.

**Instalacja**

- [ ] S-01. Safari → Udostępnij → Do ekranu początkowego → uruchom z ikony. Brak paska Safari; treść nie wchodzi pod Dynamic Island ani pasek na dole.
- [ ] S-02. Android Chrome: „Zainstaluj” → aplikacja na ekranie głównym, pełny ekran.

**Schowek**

- [ ] S-03. W WhatsAppie/Zdjęciach przytrzymaj zdjęcie grafiku → _Kopiuj_. W aplikacji: _+ → Skanuj grafik → Wklej ze schowka_ → tapnij dymek _Wklej_ → widać podgląd.
- [ ] S-04. Skopiuj tekst (nie zdjęcie) → _Wklej ze schowka_ → komunikat o braku zdjęcia.
- [ ] S-05. Zignoruj dymek _Wklej_ (tapnij obok) → nic się nie psuje, można spróbować ponownie.
- [ ] S-06. Pole „Przytrzymaj tutaj i wybierz Wklej” → przytrzymaj → _Wklej_ → podgląd; klawiatura się nie pojawia.

**Skanowanie**

- [ ] S-07. Zdjęcie papierowego grafiku aparatem → Analizuj → osoby i dni zgadzają się z kartką; popraw jedną komórkę; Importuj.
- [ ] S-08. Podczas weryfikacji przejdź do Zdjęć na 1–2 min i wróć → ekran weryfikacji nadal jest.
- [ ] S-09. Ustawienia → Historia importów → Wycofaj → zmiany z importu znikają.

**Ręczna edycja**

- [ ] S-10. Dodaj sobie zmiany na cały przyszły tydzień jednym formularzem → Pt i Sb 10:00–23:00, pozostałe 10:00–22:00.
- [ ] S-11. Przesuń zmianę w lewo → Usuń → Cofnij.
- [ ] S-12. Edytuj godziny — klawiatura/kółka nie zasłaniają „Zapisz”.
- [ ] S-13. Przytrzymaj zmianę w widoku Zespół → menu kontekstowe (bez systemowego zaznaczania tekstu).

**Widoki**

- [ ] S-14. Zespół → Tydzień: wszystkie dni widoczne bez przewijania; przesunięcie palcem zmienia tydzień.
- [ ] S-15. Zespół → Miesiąc: przewijanie w bok, imiona i nagłówki dni zostają na miejscu.
- [ ] S-16. Tryb ciemny → wszystko czytelne.

**PDF**

- [ ] S-17. PDF miesiąca → Udostępnij → wyślij do siebie → otwórz: polskie znaki poprawne, tabela czytelna.
- [ ] S-18. Udostępnij → _Zachowaj w Plikach_ → nazwa `Grafik_RRRR-MM.pdf`.
- [ ] S-19. Zamknij arkusz udostępniania bez wyboru → brak komunikatu błędu.

**Offline i dane**

- [ ] S-20. Tryb samolotowy → aplikacja startuje, edycja i eksport PDF działają; skanowanie pokazuje „Brak połączenia”.
- [ ] S-21. Ustawienia → Eksportuj kopię → zapisz w Plikach.

Każdy niezaliczony punkt: zrzut ekranu + opis → przekaż Claude Code jako zgłoszenie z numerem `S-xx`.
