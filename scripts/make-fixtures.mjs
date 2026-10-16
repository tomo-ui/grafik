// Generuje fixtures odpowiedzi Gemini do testów bez sieci:
//  - tests/fixtures/gemini-responses/schedule-*.json  (sparsowany JSON harmonogramu)
//  - tests/fixtures/gemini-responses/api-*.json        (pełna odpowiedź generateContent)
// Uruchom: node scripts/make-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'tests/fixtures/gemini-responses';
mkdirSync(OUT, { recursive: true });

const WD = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb'];
const wd = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return WD[new Date(y, m - 1, d).getDay()];
};
const nov = (d) => `2026-11-${String(d).padStart(2, '0')}`;

const e = (date, rawCell, over = {}) => ({
  date,
  weekday: wd(date),
  rawCell,
  kind: 'work',
  start: null,
  end: null,
  confidence: 0.95,
  ...over,
});

const base = { period: { month: 11, year: 2026, startDate: null, endDate: null } };

const fixtures = {
  // znaczniki X, legenda, 3 osoby
  standard: {
    ...base,
    legend: [{ symbol: 'X', meaning: 'work', start: null, end: null }],
    people: [
      { nameAsWritten: 'Kasia', entries: [2, 3, 4, 5, 6].map((d) => e(nov(d), 'X')) },
      { nameAsWritten: 'Basia', entries: [2, 3, 7, 8].map((d) => e(nov(d), 'X')) },
      {
        nameAsWritten: 'Łukasz',
        entries: [...[4, 5, 6].map((d) => e(nov(d), 'X')), e(nov(9), 'W', { kind: 'off' })],
      },
    ],
    warnings: [],
  },
  // godziny w komórkach; część bez start/end (model nie wypełnił — parsujemy rawCell)
  hours: {
    ...base,
    legend: [],
    people: [
      {
        nameAsWritten: 'Kasia',
        entries: [
          e(nov(2), '10-18', { start: '10:00', end: '18:00' }),
          e(nov(3), '14:00–23'),
          e(nov(4), '10.30-16'),
          e(nov(5), '22-10'),
          e(nov(6), '10:00–23:00', { start: '10:00', end: '23:00' }),
        ],
      },
    ],
    warnings: [],
  },
  // legenda z godzinami: D = 10–16, N = 16–23
  legend: {
    ...base,
    legend: [
      { symbol: 'D', meaning: 'work', start: '10:00', end: '16:00' },
      { symbol: 'N', meaning: 'work', start: '16:00', end: '23:00' },
      { symbol: 'U', meaning: 'vacation', start: null, end: null },
    ],
    people: [
      {
        nameAsWritten: 'Kasia',
        entries: [e(nov(2), 'D'), e(nov(3), 'N'), e(nov(4), 'U', { kind: 'vacation' })],
      },
    ],
    warnings: [],
  },
  // grafik transponowany (model zwraca ten sam kształt; ostrzeżenie o układzie)
  transposed: {
    ...base,
    legend: [{ symbol: '✓', meaning: 'work', start: null, end: null }],
    people: [
      { nameAsWritten: 'Anna K.', entries: [2, 3, 4].map((d) => e(nov(d), '✓')) },
      { nameAsWritten: 'Jan', entries: [3, 4, 5].map((d) => e(nov(d), '✓')) },
    ],
    warnings: ['Wykryto układ transponowany: osoby w kolumnach, dni w wierszach.'],
  },
  // przekreślenia: niska pewność + ostrzeżenie modelu
  strike: {
    ...base,
    legend: [],
    people: [
      {
        nameAsWritten: 'Kasia',
        entries: [
          e(nov(2), 'X'),
          e(nov(3), 'X', { confidence: 0.4 }),
          e(nov(4), '10-18', { start: '10:00', end: '18:00', confidence: 0.55 }),
        ],
      },
    ],
    warnings: ['Komórka z 3.11 była przekreślona — użyto widocznej wartości.'],
  },
  // dwie strony grafiku: ta sama osoba w dwóch wierszach, jeden dzień ze sprzecznymi wartościami
  twoPages: {
    ...base,
    legend: [],
    people: [
      {
        nameAsWritten: 'Kasia',
        entries: [e(nov(2), '10-18', { start: '10:00', end: '18:00' }), e(nov(3), 'X')],
      },
      {
        nameAsWritten: 'kasia',
        entries: [
          e(nov(3), '12-20', { start: '12:00', end: '20:00' }),
          e(nov(4), 'X'),
          e(nov(2), '10-18', { start: '10:00', end: '18:00' }),
        ],
      },
    ],
    warnings: [],
  },
  // model pomylił rok (2025), a nagłówki dni tygodnia pasują do 2026
  wrongYear: {
    period: { month: 11, year: 2025, startDate: null, endDate: null },
    legend: [],
    people: [
      {
        nameAsWritten: 'Kasia',
        entries: [2, 3, 4, 5, 6].map((d) =>
          e(`2025-11-${String(d).padStart(2, '0')}`, 'X', { weekday: wd(nov(d)) }),
        ),
      },
      {
        nameAsWritten: 'Basia',
        entries: [3, 4, 7].map((d) =>
          e(`2025-11-${String(d).padStart(2, '0')}`, 'X', { weekday: wd(nov(d)) }),
        ),
      },
    ],
    warnings: [],
  },
  // niepoprawna data (31.11) i wpis 40 dni poza okresem
  invalid: {
    ...base,
    legend: [],
    people: [
      {
        nameAsWritten: 'Kasia',
        entries: [
          e(nov(2), 'X'),
          e(nov(3), 'X'),
          e('2026-11-31', 'X', { weekday: null }),
          e('2027-01-12', 'X', { weekday: null }),
        ],
      },
    ],
    warnings: [],
  },
};

for (const [name, data] of Object.entries(fixtures)) {
  writeFileSync(`${OUT}/schedule-${name}.json`, JSON.stringify(data, null, 2) + '\n');
  // opakowanie jak w prawdziwej odpowiedzi generateContent
  const api = {
    candidates: [
      {
        content: { role: 'model', parts: [{ text: JSON.stringify(data) }] },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 400, totalTokenCount: 1600 },
  };
  writeFileSync(`${OUT}/api-${name}.json`, JSON.stringify(api, null, 2) + '\n');
}
console.log(`fixtures: ${Object.keys(fixtures).length}`);
