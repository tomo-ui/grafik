# Lighthouse (mobile) — Faza 9

Uruchomienie: `npm run build`, `npx vite preview --port 4175`, `npx lighthouse http://localhost:4175/ --form-factor=mobile`.

| Kategoria      | Wynik | Wymóg planu |
| -------------- | ----- | ----------- |
| Performance    | 95    | ≥ 90        |
| Accessibility  | 100   | ≥ 95        |
| Best Practices | 100   | ≥ 95        |
| SEO            | 100   | —           |

FCP 2,2 s, LCP 2,4 s, TBT 10 ms, CLS 0 (symulowane łącze mobilne). Pakiet startowy: ~84 kB gzip
(cel < 200 kB); pdfmake, pdf.js, ekran skanowania, arkusze zmian i ekrany ustawień ładowane leniwie.

Naprawione po drodze: kontrast tekstu pomocniczego i akcentu (WCAG AA), ostrzeżenia w pomarańczowym
(`--orange-text`), przyciski wypełnione (`--accent-fill`, `--red-fill`), brak meta description i robots.txt.
Automatyczny audyt axe (WCAG A/AA) działa w `tests/e2e/a11y.spec.ts`.
