import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AiError, mapHttpError, maskKey, parseRetryDelay } from '../../src/ai/errors';
import {
  parseModelJson,
  parsedScheduleSchema,
  RESPONSE_SCHEMA,
  stripFences,
} from '../../src/ai/schema';
import { buildPrompt, PROMPT_VERSION } from '../../src/ai/prompt';
import { jaroWinkler, matchPerson, nameTokens, normalizeName } from '../../src/ai/names';
import {
  normalizeSchedule,
  normalizeTime,
  parseTimeRange,
  parseWeekdayHeader,
  type NormalizeContext,
} from '../../src/ai/normalize';
import { DEFAULT_HOURS } from '../../src/domain/hours';

const fixture = (name: string) =>
  parsedScheduleSchema.parse(
    JSON.parse(readFileSync(`tests/fixtures/gemini-responses/schedule-${name}.json`, 'utf8')),
  );

const people = [
  { id: 'k', firstName: 'Katarzyna', lastName: 'Nowak', aliases: ['Kasia'] },
  { id: 'b', firstName: 'Barbara', lastName: 'Wiśniewska', aliases: ['Basia'] },
  { id: 'l', firstName: 'Łukasz', lastName: 'Kowalski', aliases: [] },
  { id: 'a', firstName: 'Anna', lastName: 'Kowalska', aliases: [] },
];
const ctx: NormalizeContext = { today: '2026-11-04', people, defaults: DEFAULT_HOURS };

describe('schema i parsowanie odpowiedzi', () => {
  it('RESPONSE_SCHEMA wymaga people i zawiera pole weekday', () => {
    expect(RESPONSE_SCHEMA.required).toEqual(['people']);
    const entry = RESPONSE_SCHEMA.properties.people.items.properties.entries.items;
    expect(Object.keys(entry.properties)).toContain('weekday');
    expect(entry.required).toEqual(['date', 'rawCell', 'kind', 'confidence']);
  });
  it('zdejmuje ogrodzenie ```json', () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });
  it('akceptuje nulle, brak legendy i okresu', () => {
    const r = parseModelJson(
      JSON.stringify({
        people: [
          {
            nameAsWritten: 'Kasia',
            entries: [
              { date: '2026-11-02', rawCell: 'X', kind: 'work', start: null, confidence: 0.9 },
            ],
          },
        ],
      }),
    );
    expect(r.legend).toEqual([]);
    expect(r.period).toEqual({});
    expect(r.warnings).toEqual([]);
    expect(r.people[0]!.entries[0]!.start).toBeUndefined();
  });
  it('niepoprawny JSON → bad-json; zły kształt → bad-schema', () => {
    expect(() => parseModelJson('to nie json')).toThrowError(AiError);
    try {
      parseModelJson('{oops');
    } catch (e) {
      expect((e as AiError).code).toBe('bad-json');
    }
    try {
      parseModelJson('{"people": "nie tablica"}');
    } catch (e) {
      expect((e as AiError).code).toBe('bad-schema');
    }
    try {
      parseModelJson(
        '{"people":[{"nameAsWritten":"A","entries":[{"date":"2026-11-02","rawCell":"X","kind":"praca","confidence":1}]}]}',
      );
    } catch (e) {
      expect((e as AiError).code).toBe('bad-schema'); // nieznany rodzaj wpisu
    }
  });
  it('pewność spoza zakresu nie psuje odczytu', () => {
    const r = parseModelJson(
      '{"people":[{"nameAsWritten":"A","entries":[{"date":"2026-11-02","rawCell":"X","kind":"work","confidence":7}]}]}',
    );
    expect(r.people[0]!.entries[0]!.confidence).toBe(0.5);
  });
});

describe('błędy HTTP i maskowanie klucza (P-19)', () => {
  it.each([
    [400, {}, 'bad-request'],
    [400, { error: { message: 'API key not valid. Please pass a valid API key.' } }, 'bad-key'],
    [401, {}, 'bad-key'],
    [403, {}, 'bad-key'],
    [404, {}, 'no-model'],
    [500, {}, 'server'],
    [503, {}, 'server'],
    [400, { error: { message: 'User location is not supported for the API use.' } }, 'region'],
  ])('%i → %s', (status, body, code) => {
    expect(mapHttpError(status, body).code).toBe(code);
  });
  it('429 z RetryInfo.retryDelay (E-18)', () => {
    const e = mapHttpError(429, {
      error: {
        status: 'RESOURCE_EXHAUSTED',
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '30s' }],
      },
    });
    expect(e.code).toBe('rate-limit');
    expect(e.retryAfterSec).toBe(30);
  });
  it('komunikaty po polsku, bad-key kieruje do ustawień', () => {
    expect(new AiError('bad-key').message).toMatch(/Klucz API/);
    expect(new AiError('bad-key').goToSettings).toBe(true);
    expect(new AiError('rate-limit').goToSettings).toBe(false);
    expect(new AiError('empty').message).toMatch(/wyraźniejszego zdjęcia/);
  });
  it('parseRetryDelay', () => {
    expect(parseRetryDelay('30s')).toBe(30);
    expect(parseRetryDelay('1.2s')).toBe(2);
    expect(parseRetryDelay('abc')).toBeUndefined();
  });
  it('maskKey nigdy nie ujawnia całego klucza', () => {
    expect(maskKey('AIzaSyABCDEFxyz')).toBe('****xyz');
    expect(maskKey(undefined)).toBe('(brak)');
  });
});

describe('prompt', () => {
  it('zawiera datę, okres, znane osoby z aliasami i godziny domyślne z ustawień', () => {
    const p = buildPrompt({
      today: '2026-11-04',
      suggestedPeriod: '2026-11',
      people: [{ firstName: 'Katarzyna', lastName: 'Nowak', aliases: ['Kasia', 'K. Nowak'] }],
    });
    expect(p).toContain('Today is 2026-11-04');
    expect(p).toContain('assume 2026-11');
    expect(p).toContain('Katarzyna Nowak: Kasia, K. Nowak');
    expect(p).toContain('Sun–Thu 10:00–22:00');
    expect(p).toContain('Fri–Sat 10:00–23:00');
    expect(PROMPT_VERSION).toBeTruthy();
  });
  it('godziny domyślne zależą od ustawień', () => {
    const custom = { ...DEFAULT_HOURS, 1: { start: '09:00', end: '17:00' } };
    expect(buildPrompt({ today: '2026-11-04', people: [], defaults: custom })).toContain(
      'Mon 09:00–17:00',
    );
  });
});

describe('dopasowanie imion', () => {
  it('Łukasz vs Lukasz — pewne dopasowanie (E-22, P-17)', () => {
    expect(normalizeName('Łukasz')).toBe('lukasz');
    expect(normalizeName('ŁUKASZ')).toBe('lukasz');
    const m = matchPerson('Lukasz', people);
    expect(m).toMatchObject({ personId: 'l', how: 'exact', score: 1 });
  });
  it('alias i pełna nazwa w dowolnej kolejności', () => {
    expect(matchPerson('Kasia', people)).toMatchObject({ personId: 'k', how: 'alias' });
    expect(matchPerson('Nowak Katarzyna', people)).toMatchObject({ personId: 'k', how: 'exact' });
    expect(matchPerson('  basia ', people)).toMatchObject({ personId: 'b', how: 'alias' });
  });
  it('inicjały: „K. Nowak” i „Nowak K.”', () => {
    expect(nameTokens('K. Nowak').sort()).toEqual(['k', 'nowak']);
    const a = matchPerson('K. Nowak', people);
    const b = matchPerson('Nowak K.', people);
    expect(a.personId).toBe('k');
    expect(b.personId).toBe('k');
    expect(a.score).toBeGreaterThan(0.93);
  });
  it('literówka daje dopasowanie rozmyte, nieznane imię — brak', () => {
    expect(matchPerson('Katarzyba', people)).toMatchObject({ personId: 'k', how: 'fuzzy' });
    expect(matchPerson('Zdzisław', people)).toMatchObject({ how: 'none' });
    expect(matchPerson('', people).how).toBe('none');
  });
  it('dwie osoby o tym samym imieniu — brak pewnego dopasowania samego imienia', () => {
    const two = [
      { id: 'x', firstName: 'Anna', lastName: 'Kowalska', aliases: [] },
      { id: 'y', firstName: 'Anna', lastName: 'Nowak', aliases: [] },
    ];
    const m = matchPerson('Anna', two);
    expect(m.score).toBeLessThanOrEqual(0.8);
    expect(matchPerson('Anna N.', two)).toMatchObject({ personId: 'y' });
  });
  it('Jaro-Winkler: podstawy', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeGreaterThan(0.96);
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
    expect(jaroWinkler('', 'a')).toBe(0);
  });
});

describe('godziny z grafiku', () => {
  it.each([
    ['10', '10:00'],
    ['9', '09:00'],
    ['10.30', '10:30'],
    ['10:30', '10:30'],
    ['10:30:00', '10:30'],
    ['1030', '10:30'],
    ['930', '09:30'],
    ['22h', '22:00'],
    ['24:00', '00:00'],
    ['25', undefined],
    ['10:75', undefined],
    ['abc', undefined],
    ['', undefined],
  ])('normalizeTime(%j) = %j', (input, out) => expect(normalizeTime(input)).toBe(out));

  it('parseTimeRange', () => {
    expect(parseTimeRange('10-18')).toEqual({ start: '10:00', end: '18:00' });
    expect(parseTimeRange('14:00–23')).toEqual({ start: '14:00', end: '23:00' });
    expect(parseTimeRange('9.30 - 17')).toEqual({ start: '09:30', end: '17:00' });
    expect(parseTimeRange('X')).toBeUndefined();
  });
  it('nagłówki dni tygodnia', () => {
    expect(parseWeekdayHeader('Pn')).toBe(1);
    expect(parseWeekdayHeader('Śr')).toBe(3);
    expect(parseWeekdayHeader('Sob.')).toBe(6);
    expect(parseWeekdayHeader('Nd')).toBe(0);
    expect(parseWeekdayHeader('xx')).toBeUndefined();
  });
});

describe('normalizeSchedule — fixtures', () => {
  it('znaczniki X → godziny domyślne wg dnia; osoby dopasowane', () => {
    const r = normalizeSchedule(fixture('standard'), ctx);
    expect(r.period).toEqual({ year: 2026, month: 11 });
    expect(r.persons.map((p) => [p.nameAsWritten, p.status, p.match.personId])).toEqual([
      ['Kasia', 'matched', 'k'],
      ['Basia', 'matched', 'b'],
      ['Łukasz', 'matched', 'l'],
    ]);
    const kasia = r.persons[0]!;
    expect(kasia.entries).toHaveLength(5);
    const fri = kasia.entries.find((e) => e.date === '2026-11-06')!;
    expect([fri.start, fri.end, fri.usesDefaultHours]).toEqual(['10:00', '23:00', true]);
    const mon = kasia.entries.find((e) => e.date === '2026-11-02')!;
    expect([mon.start, mon.end]).toEqual(['10:00', '22:00']);
    const basia = r.persons[1]!;
    expect(basia.entries.find((e) => e.date === '2026-11-07')!.end).toBe('23:00'); // sobota
    expect(basia.entries.find((e) => e.date === '2026-11-08')!.end).toBe('22:00'); // niedziela
    const off = r.persons[2]!.entries.find((e) => e.kind === 'off')!;
    expect(off.start).toBeUndefined();
    expect(r.warnings).toEqual([]);
    expect(r.excluded).toEqual([]);
  });

  it('godziny w komórkach: normalizacja, parsowanie rawCell, podejrzane 22-10', () => {
    const e = normalizeSchedule(fixture('hours'), ctx).persons[0]!.entries;
    const by = (d: string) => e.find((x) => x.date === d)!;
    expect([
      by('2026-11-02').start,
      by('2026-11-02').end,
      by('2026-11-02').usesDefaultHours,
    ]).toEqual(['10:00', '18:00', false]);
    expect([by('2026-11-03').start, by('2026-11-03').end]).toEqual(['14:00', '23:00']);
    expect([by('2026-11-04').start, by('2026-11-04').end]).toEqual(['10:30', '16:00']);
    const night = by('2026-11-05');
    expect([night.start, night.end, night.suspicious]).toEqual(['22:00', '10:00', true]);
    expect(night.notes.join(' ')).toMatch(/następnego dnia/);
    // piątek 10:00–23:00 = godziny domyślne
    expect(by('2026-11-06').usesDefaultHours).toBe(true);
    expect(by('2026-11-06').suspicious).toBe(false);
  });

  it('legenda z godzinami i urlop', () => {
    const e = normalizeSchedule(fixture('legend'), ctx).persons[0]!.entries;
    expect([e[0]!.start, e[0]!.end, e[0]!.usesDefaultHours]).toEqual(['10:00', '16:00', false]);
    expect([e[1]!.start, e[1]!.end]).toEqual(['16:00', '23:00']);
    expect(e[2]).toMatchObject({ kind: 'vacation', start: undefined });
  });

  it('grafik transponowany: ostrzeżenie modelu, „Anna K.” → Anna Kowalska, nieznany Jan', () => {
    const r = normalizeSchedule(fixture('transposed'), ctx);
    expect(r.warnings[0]).toMatch(/transponowany/);
    expect(r.persons[0]).toMatchObject({ nameAsWritten: 'Anna K.', status: 'matched' });
    expect(r.persons[0]!.match.personId).toBe('a');
    expect(r.persons[1]).toMatchObject({ nameAsWritten: 'Jan', status: 'unresolved' });
    expect(r.persons[1]!.entries.map((x) => x.date)).toEqual([
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
    ]);
  });

  it('przekreślenia: niska pewność oznaczona, ostrzeżenie modelu zachowane', () => {
    const r = normalizeSchedule(fixture('strike'), ctx);
    expect(r.warnings.join(' ')).toMatch(/przekreślona/);
    const e = r.persons[0]!.entries;
    expect(e.map((x) => x.lowConfidence)).toEqual([false, true, true]);
  });

  it('dwie strony: ta sama osoba scalona, sprzeczny dzień zgłoszony jako konflikt', () => {
    const r = normalizeSchedule(fixture('twoPages'), ctx);
    expect(r.persons).toHaveLength(1);
    const p = r.persons[0]!;
    expect(p.entries.map((x) => x.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
    expect(p.conflicts).toHaveLength(1);
    expect(p.conflicts[0]!.date).toBe('2026-11-03');
    expect(p.conflicts[0]!.first.start).toBe('10:00'); // X → domyślne
    expect(p.conflicts[0]!.second.start).toBe('12:00');
  });

  it('pomylony rok: korekta z nagłówków dni tygodnia + ostrzeżenie', () => {
    const r = normalizeSchedule(fixture('wrongYear'), {
      ...ctx,
      suggestedPeriod: { year: 2026, month: 11 },
    });
    expect(r.period).toEqual({ year: 2026, month: 11 });
    expect(r.persons[0]!.entries[0]!.date).toBe('2026-11-02');
    expect(r.persons[0]!.entries[0]!.notes.join(' ')).toMatch(/skorygowana/);
    expect(r.warnings.join(' ')).toMatch(/poprawiono miesiąc\/rok/);
    // korekta dała zgodność z wybranym okresem — brak ostrzeżenia o rozbieżności
    expect(r.warnings.join(' ')).not.toMatch(/różni się od wybranego/);
  });

  it('niepoprawna data (31.11) i wpis spoza okresu trafiają do excluded (E-20)', () => {
    const r = normalizeSchedule(fixture('invalid'), ctx);
    expect(r.persons[0]!.entries.map((x) => x.date)).toEqual(['2026-11-02', '2026-11-03']);
    expect(r.excluded).toHaveLength(2);
    expect(r.excluded.map((x) => x.reason).join(' ')).toMatch(/Niepoprawna data/);
    expect(r.excluded.map((x) => x.reason).join(' ')).toMatch(/spoza okresu/);
  });

  it('wykryty okres różny od wybranego → ostrzeżenie', () => {
    const r = normalizeSchedule(fixture('standard'), {
      ...ctx,
      suggestedPeriod: { year: 2026, month: 12 },
    });
    expect(r.warnings.join(' ')).toMatch(/różni się od wybranego/);
  });

  it('„Kasia” i „Katarzyna N.” → ta sama osoba: grupa duplikatów (E-21)', () => {
    const parsed = parsedScheduleSchema.parse({
      period: { month: 11, year: 2026 },
      people: [
        {
          nameAsWritten: 'Kasia',
          entries: [{ date: '2026-11-02', rawCell: 'X', kind: 'work', confidence: 1 }],
        },
        {
          nameAsWritten: 'Katarzyna N.',
          entries: [{ date: '2026-11-03', rawCell: 'X', kind: 'work', confidence: 1 }],
        },
        {
          nameAsWritten: 'Basia',
          entries: [{ date: '2026-11-03', rawCell: 'X', kind: 'work', confidence: 1 }],
        },
      ],
    });
    const r = normalizeSchedule(parsed, ctx);
    expect(r.duplicateTargets).toEqual([['r0', 'r1']]);
    expect(r.persons[0]!.match.personId).toBe('k');
    expect(r.persons[1]!.match.personId).toBe('k');
  });

  it('podejrzanie mało dni u jednej osoby → ostrzeżenie „Sprawdź osobę…”', () => {
    const days = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        date: `2026-11-${String(i + 2).padStart(2, '0')}`,
        rawCell: 'X',
        kind: 'work' as const,
        confidence: 1,
      }));
    const parsed = parsedScheduleSchema.parse({
      period: { month: 11, year: 2026 },
      people: [
        { nameAsWritten: 'Kasia', entries: days(10) },
        { nameAsWritten: 'Basia', entries: days(9) },
        { nameAsWritten: 'Łukasz', entries: days(1) },
      ],
    });
    const r = normalizeSchedule(parsed, ctx);
    expect(r.warnings).toContain('Sprawdź osobę Łukasz — wykryto 1 dni.');
  });

  it('pusty wynik nie wywraca normalizacji', () => {
    const r = normalizeSchedule(parsedScheduleSchema.parse({ people: [] }), ctx);
    expect(r.persons).toEqual([]);
    expect(r.period).toBeNull();
  });
});
