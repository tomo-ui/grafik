# Spike Gemini — stan i protokół

> **Status: NIE WYKONANY na urządzeniach.** Plan (4.1, Faza 7) wymaga sprawdzenia z prawdziwego
> iPhone’a (Safari) i Androida (Chrome), z prawdziwym zdjęciem grafiku i prawdziwym kluczem.
> Tego nie da się zrobić z poziomu środowiska deweloperskiego (brak telefonu i klucza), więc
> poniżej jest protokół do przejścia oraz wiedza zebrana z dokumentacji. Cała logika klienta jest
> przetestowana na mockach (`tests/unit/gemini.test.ts`, `tests/e2e/scan.spec.ts`) — mocki
> **nie potwierdzają** zachowania prawdziwego API.

## Jak wykonać spike (≈ 10 minut)

1. Wygeneruj **nowy** klucz w Google AI Studio (stary, wklejony wcześniej w czacie, uznaj za ujawniony).
2. Na komputerze: `npx serve docs/spike` (albo dowolny statyczny serwer) i otwórz na telefonie
   `http://<IP-komputera>:3000/spike-gemini.html` (ta sama sieć Wi-Fi). Strona nie jest częścią aplikacji.
3. Wklej klucz, wybierz zdjęcie grafiku, uruchom test — w Safari iOS i w Chrome na Androidzie.
4. Wpisz wyniki do tabeli poniżej. Po spike’u **usuń klucz** w AI Studio.

## Wyniki (do uzupełnienia)

| Platforma        | (a) CORS bez proxy | (b) `responseSchema` przyjęty | (b) `thinkingConfig` przyjęty | (c) czas odpowiedzi | JSON poprawny | Uwagi |
| ---------------- | ------------------ | ----------------------------- | ----------------------------- | ------------------- | ------------- | ----- |
| iPhone / Safari  | ?                  | ?                             | ?                             | ?                   | ?             |       |
| Android / Chrome | ?                  | ?                             | ?                             | ?                   | ?             |       |

Decyzja: jeśli (a) nie działa na którejkolwiek platformie → od razu wariant B (proxy na Cloudflare
Workers, plan 3 i Faza 9).

## Co ustalono z dokumentacji (stan na 2026-10-17, odczyt przez narzędzie — niezweryfikowane na żywo)

- `generateContent` nadal istnieje i jest opisane jako w pełni wspierane. Dokumentacja nazywa je
  jednak „legacy” i poleca nowe **Interactions API** (`POST /v1beta/interactions`, pola `input`,
  `response_format`, `generation_config.thinking_level`). Klient jest więc odizolowany w
  `src/ai/gemini.ts` — zmiana endpointu dotyka jednego pliku. **Decyzja:** zostajemy przy
  `generateContent` (kształt zapytania znany i zgodny z planem), a po spike’u rozważamy migrację.
- Lista modeli zmieniła się względem planu (m.in. `gemini-3.x-flash`, `gemini-3.x-flash-lite`).
  Domyślnie nadal używamy aliasu `gemini-flash-latest`; dokumentacja nie mówi, na co dziś wskazuje.
  Ustawienia pozwalają wybrać inny model i pobrać listę (`GET /v1beta/models`).
- „Myślenie”: dla Interactions poziomy to m.in. `minimal`/`low`/`medium`/`high`, zależnie od modelu
  (`minimal` nie wszędzie). Klient wysyła `thinkingConfig.thinkingLevel: "low"` i **ponawia bez
  niego**, jeśli API zwróci 400 wspominające o „thinking”.
- Schemat odpowiedzi: dokumentacja pokazuje typy JSON Schema (`["string","null"]`), a plan używa
  `nullable: true` (styl OpenAPI). Klient wysyła `responseSchema` z `nullable` i **ponawia bez
  schematu** (z opisem kształtu JSON w prompcie), jeśli API odrzuci schemat.

## Odchylenie od planu

- Do schematu dodano opcjonalne pole `weekday` przy wpisie (nagłówek dnia tygodnia z grafiku).
  Bez niego nie da się zrealizować punktu 4.6/2 (korekta pomylonego roku/miesiąca).
