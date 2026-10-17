# Scenariusz testów ręcznych na telefonie

Czas: ok. 20 min na iPhonie i 15 min na Androidzie. Aplikacja musi być wdrożona pod HTTPS (README → Wdrożenie).
Każdy niezaliczony punkt: zrzut ekranu + opis → zgłoszenie z numerem `S-xx`.

| Urządzenie | Wersja systemu | Data | Tester |
| ---------- | -------------- | ---- | ------ |
|            |                |      |        |

## Przed testem (jednorazowo)

- [ ] **S-00. Spike Gemini** (`docs/spike-gemini.md`, strona `docs/spike/spike-gemini.html`): z iPhone'a i Androida wyślij prawdziwe zdjęcie grafiku.
      Zapisz: czy CORS działa bez proxy, czy model przyjmuje `responseSchema`, czas odpowiedzi, odsetek poprawnych komórek (cel ≥ 95 % po weryfikacji).
      Jeśli CORS nie działa → wariant B (`worker/`, README).
- [ ] Wygeneruj w Google AI Studio **nowy** klucz API (stary, jeśli kiedykolwiek był wklejony w czacie, usuń) i wpisz go w _Ustawienia → Skanowanie AI_.

## Instalacja

- [ ] S-01. Safari → Udostępnij → Do ekranu początkowego → uruchom z ikony. Brak paska Safari; treść nie wchodzi pod Dynamic Island ani pasek na dole; widać splash i właściwą ikonę.
- [ ] S-02. Android Chrome: „Zainstaluj" → aplikacja na ekranie głównym, pełny ekran. Długie przytrzymanie ikony pokazuje skróty: Skanuj grafik / Dodaj zmianę / Eksportuj PDF.

## Schowek

- [ ] S-03. W WhatsAppie/Zdjęciach przytrzymaj zdjęcie grafiku → _Kopiuj_. W aplikacji: _+ → Skanuj grafik → Wklej ze schowka_ → tapnij dymek _Wklej_ → widać podgląd.
- [ ] S-04. Skopiuj tekst (nie zdjęcie) → _Wklej ze schowka_ → komunikat o braku zdjęcia.
- [ ] S-05. Zignoruj dymek _Wklej_ (tapnij obok) → nic się nie psuje, można spróbować ponownie.
- [ ] S-06. Pole „Przytrzymaj tutaj i wybierz Wklej" → przytrzymaj → _Wklej_ → podgląd; klawiatura się nie pojawia.

## Skanowanie

- [ ] S-07. Zdjęcie papierowego grafiku aparatem → Analizuj → osoby i dni zgadzają się z kartką; popraw jedną komórkę; Importuj.
- [ ] S-08. Podczas weryfikacji przejdź do Zdjęć na 1–2 min i wróć → ekran weryfikacji nadal jest (a po wymuszonym zamknięciu aplikacji — szkic wraca).
- [ ] S-09. Ustawienia → Historia importów → Wycofaj → zmiany z importu znikają.
- [ ] S-22. (Komputer) Przeciągnij plik zdjęcia na okno skanowania → trafia do podglądu.
- [ ] S-26. Wklej/wybierz bardzo duży zrzut ekranu (PNG > 10 MB) → bez zawieszenia, podgląd się pojawia.

## Ręczna edycja

- [ ] S-10. Dodaj sobie zmiany na cały przyszły tydzień jednym formularzem → Pt i Sb 10:00–23:00, pozostałe 10:00–22:00.
- [ ] S-11. Przesuń zmianę w lewo → Usuń → Cofnij.
- [ ] S-12. Edytuj godziny — klawiatura/kółka nie zasłaniają „Zapisz".
- [ ] S-13. Przytrzymaj zmianę w widoku Zespół → menu kontekstowe (bez systemowego zaznaczania tekstu).

## Widoki

- [ ] S-14. Zespół → Tydzień: wszystkie dni widoczne bez przewijania; przesunięcie palcem zmienia tydzień.
- [ ] S-15. Zespół → Miesiąc (15–25 osób): płynne przewijanie w bok, imiona i nagłówki dni zostają na miejscu.
- [ ] S-16. Tryb ciemny → wszystko czytelne. Ustawienia systemu → największy rozmiar tekstu → układ się nie psuje.

## PDF

- [ ] S-17. PDF miesiąca → Udostępnij → wyślij do siebie → otwórz: polskie znaki poprawne, tabela czytelna.
- [ ] S-18. Udostępnij → _Zachowaj w Plikach_ → nazwa `Grafik_RRRR-MM.pdf`.
- [ ] S-19. Zamknij arkusz udostępniania bez wyboru → brak komunikatu błędu.

## Offline i dane

- [ ] S-20. Tryb samolotowy → aplikacja startuje, edycja i eksport PDF działają; skanowanie pokazuje „Brak połączenia".
- [ ] S-21. Ustawienia → Eksportuj kopię → zapisz w Plikach. Potem zainstaluj aplikację z ekranu początkowego (jeśli używałeś Safari) i zaimportuj kopię.

## Dodatkowe (z audytu końcowego)

- [ ] S-23. Aktualizacja: po wdrożeniu nowej wersji otwórz aplikację w trakcie wypełniania formularza dodawania → pojawia się baner „Dostępna aktualizacja", formularz nie znika; „Odśwież" ładuje nową wersję, dane zostają.
- [ ] S-24. Android: przycisk/gest „wstecz" zamyka kolejno: menu, arkusz, podgląd PDF — nigdy nie zamyka aplikacji, dopóki coś jest otwarte.
- [ ] S-25. (Komputer/Android) Dwie karty aplikacji naraz: zmiana w jednej pojawia się w drugiej bez przeładowania.
- [ ] S-27. VoiceOver / TalkBack na siatce zespołu: komórki czytane jako „imię, dzień, godziny".
- [ ] S-28. Androidowe „Udostępnij" zdjęcie z galerii → wybierz Grafik → otwiera się skanowanie ze zdjęciem.
