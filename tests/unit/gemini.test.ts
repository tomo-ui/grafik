/* eslint-disable @typescript-eslint/no-explicit-any -- ciała zapytań w testach są dowolnym JSON-em */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { generateSchedule, listModels, testConnection, extractText } from '../../src/ai/gemini';
import { AiError } from '../../src/ai/errors';

const KEY = 'AIzaSy-SEKRETNY-KLUCZ-123';
const okBody = JSON.parse(
  readFileSync('tests/fixtures/gemini-responses/api-standard.json', 'utf8'),
);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Call = { url: string; init: RequestInit; body: Record<string, any> };
function fakeFetch(...responses: (Response | Error | (() => Promise<Response>))[]) {
  const calls: Call[] = [];
  const f = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      init: init ?? {},
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const next = responses.shift();
    if (!next) throw new Error('brak zaplanowanej odpowiedzi');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next() : next;
  });
  return { f: f as unknown as typeof fetch, calls };
}

const base = (fetchImpl: typeof fetch, extra = {}) => ({
  apiKey: KEY,
  model: 'gemini-flash-latest',
  prompt: 'PROMPT',
  images: [{ mime: 'image/jpeg', base64: 'AAAA' }],
  fetchImpl,
  sleep: async () => {},
  ...extra,
});

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as AiError).code;
  }
  return 'ok';
};

describe('generateSchedule', () => {
  it('sukces: parsuje odpowiedź, wysyła obraz, schemat i temperaturę 0', async () => {
    const { f, calls } = fakeFetch(json(200, okBody));
    const r = await generateSchedule(base(f));
    expect(r.parsed.people).toHaveLength(3);
    expect(r.model).toBe('gemini-flash-latest');
    const c = calls[0]!;
    expect(c.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
    );
    expect(c.body.generationConfig).toMatchObject({
      temperature: 0,
      responseMimeType: 'application/json',
    });
    expect(c.body.generationConfig.responseSchema.required).toEqual(['people']);
    expect(c.body.contents[0].parts[0]).toEqual({ text: 'PROMPT' });
    expect(c.body.contents[0].parts[1]).toEqual({
      inline_data: { mime_type: 'image/jpeg', data: 'AAAA' },
    });
  });

  it('klucz tylko w nagłówku — nigdy w URL ani w body (P-19)', async () => {
    const { f, calls } = fakeFetch(json(200, okBody));
    await generateSchedule(base(f));
    const c = calls[0]!;
    expect((c.init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
    expect(c.url).not.toContain(KEY);
    expect(JSON.stringify(c.body)).not.toContain(KEY);
  });

  it('prefiks „models/” w nazwie modelu jest usuwany', async () => {
    const { f, calls } = fakeFetch(json(200, okBody));
    await generateSchedule(base(f, { model: 'models/gemini-3-flash' }));
    expect(calls[0]!.url).toContain('/models/gemini-3-flash:generateContent');
  });

  it('429 z retryDelay: odliczanie i automatyczne ponowienie (E-18)', async () => {
    const rate = json(429, {
      error: {
        status: 'RESOURCE_EXHAUSTED',
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '3s' }],
      },
    });
    const { f, calls } = fakeFetch(rate, json(200, okBody));
    const waits: number[] = [];
    const r = await generateSchedule(base(f, { onWait: (s: number) => waits.push(s) }));
    expect(r.parsed.people).toHaveLength(3);
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([3, 2, 1, 0]);
  });

  it('429 bez retryDelay: backoff 5 s, po dwóch ponowieniach błąd rate-limit', async () => {
    const rate = () => json(429, { error: { status: 'RESOURCE_EXHAUSTED' } });
    const { f, calls } = fakeFetch(rate(), rate(), rate());
    const sleeps: number[] = [];
    const err = (await generateSchedule(
      base(f, { sleep: async (ms: number) => void sleeps.push(ms) }),
    ).catch((e: unknown) => e)) as AiError;
    expect(err.code).toBe('rate-limit');
    expect(err.message).toMatch(/Limit darmowego API/);
    expect(calls).toHaveLength(3); // 1 + 2 ponowienia
    expect(sleeps.filter((s) => s === 1000)).toHaveLength(5 + 10); // 5 s + 10 s odliczania
  });

  it('400 na schemat: ponawia bez responseSchema, z opisem JSON w prompcie', async () => {
    const bad = json(400, {
      error: { message: 'Invalid JSON payload: unknown field "nullable" in schema' },
    });
    const { f, calls } = fakeFetch(bad, json(200, okBody));
    const r = await generateSchedule(base(f));
    expect(r.parsed.people).toHaveLength(3);
    expect(calls[1]!.body.generationConfig.responseSchema).toBeUndefined();
    expect(calls[1]!.body.generationConfig.responseMimeType).toBe('application/json');
    expect(calls[1]!.body.contents[0].parts[0].text).toContain('Return ONLY valid JSON');
    expect(calls[0]!.body.generationConfig.responseSchema).toBeDefined();
  });

  it('400 na thinkingConfig: ponawia bez niego', async () => {
    const bad = json(400, { error: { message: 'Thinking level is not supported for this model' } });
    const { f, calls } = fakeFetch(bad, json(200, okBody));
    await generateSchedule(base(f));
    expect(calls[0]!.body.generationConfig.thinkingConfig).toBeDefined();
    expect(calls[1]!.body.generationConfig.thinkingConfig).toBeUndefined();
    expect(calls[1]!.body.generationConfig.responseSchema).toBeDefined(); // schemat zostaje
  });

  it('400 na zły obraz nie uruchamia fallbacku', async () => {
    const { f, calls } = fakeFetch(
      json(400, { error: { message: 'Unable to process input image.' } }),
    );
    expect(await code(generateSchedule(base(f)))).toBe('bad-request');
    expect(calls).toHaveLength(1);
  });

  it.each([
    [401, 'bad-key'],
    [403, 'bad-key'],
    [404, 'no-model'],
    [500, 'server'],
    [503, 'server'],
  ])('HTTP %i → %s', async (status, expected) => {
    const { f } = fakeFetch(json(status, { error: { message: 'x' } }));
    expect(await code(generateSchedule(base(f)))).toBe(expected);
  });

  it('timeout po przekroczeniu limitu (AbortController)', async () => {
    const hang = () =>
      new Promise<Response>(() => {
        /* nigdy się nie kończy — przerwie je abort */
      });
    const f = vi.fn(
      (_u: unknown, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener('abort', () =>
            rej(new DOMException('aborted', 'AbortError')),
          );
          void hang;
        }),
    ) as unknown as typeof fetch;
    expect(await code(generateSchedule(base(f, { timeoutMs: 20 })))).toBe('timeout');
  });

  it('anulowanie przez użytkownika → aborted', async () => {
    const ctrl = new AbortController();
    const f = vi.fn(
      (_u: unknown, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener('abort', () =>
            rej(new DOMException('aborted', 'AbortError')),
          );
        }),
    ) as unknown as typeof fetch;
    const p = generateSchedule(base(f, { signal: ctrl.signal }));
    setTimeout(() => ctrl.abort(), 10);
    expect(await code(p)).toBe('aborted');
  });

  it('brak sieci (TypeError: Failed to fetch) → offline (P-25)', async () => {
    const { f } = fakeFetch(new TypeError('Failed to fetch'));
    expect(await code(generateSchedule(base(f)))).toBe('offline');
  });

  it('pusta odpowiedź / brak kandydatów → empty; filtry bezpieczeństwa → blocked', async () => {
    expect(await code(generateSchedule(base(fakeFetch(json(200, { candidates: [] })).f)))).toBe(
      'empty',
    );
    expect(
      await code(
        generateSchedule(
          base(fakeFetch(json(200, { promptFeedback: { blockReason: 'SAFETY' } })).f),
        ),
      ),
    ).toBe('blocked');
    expect(
      await code(
        generateSchedule(
          base(fakeFetch(json(200, { candidates: [{ finishReason: 'SAFETY' }] })).f),
        ),
      ),
    ).toBe('blocked');
    expect(
      await code(
        generateSchedule(
          base(fakeFetch(json(200, { candidates: [{ content: { parts: [{ text: '  ' }] } }] })).f),
        ),
      ),
    ).toBe('empty');
  });

  it('niepoprawny JSON i JSON niezgodny ze schematem', async () => {
    const wrap = (text: string) => json(200, { candidates: [{ content: { parts: [{ text }] } }] });
    expect(await code(generateSchedule(base(fakeFetch(wrap('to nie JSON')).f)))).toBe('bad-json');
    expect(await code(generateSchedule(base(fakeFetch(wrap('{"people":5}')).f)))).toBe(
      'bad-schema',
    );
  });

  it('pomija części „thought” i składa tekst z kilku części', () => {
    const t = extractText({
      candidates: [
        {
          content: {
            parts: [{ text: 'rozmyślam…', thought: true }, { text: '{"people":' }, { text: '[]}' }],
          },
        },
      ],
    });
    expect(t).toBe('{"people":[]}');
  });

  it('brak klucza → bad-key bez zapytania', async () => {
    const { f, calls } = fakeFetch();
    expect(await code(generateSchedule(base(f, { apiKey: '  ' })))).toBe('bad-key');
    expect(calls).toHaveLength(0);
  });
});

describe('listModels / testConnection', () => {
  const page = {
    models: [
      { name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
      {
        name: 'models/gemini-3-flash',
        displayName: 'Flash',
        supportedGenerationMethods: ['generateContent', 'countTokens'],
      },
    ],
  };
  it('zostawia tylko modele z generateContent; klucz w nagłówku', async () => {
    const { f, calls } = fakeFetch(json(200, page));
    const list = await listModels(KEY, { fetchImpl: f });
    expect(list.map((m) => m.id)).toEqual(['gemini-flash-latest', 'gemini-3-flash']);
    expect(calls[0]!.url).not.toContain(KEY);
    expect((calls[0]!.init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
  });
  it('paginacja', async () => {
    const { f, calls } = fakeFetch(
      json(200, { models: page.models.slice(0, 1), nextPageToken: 'T2' }),
      json(200, { models: page.models.slice(2) }),
    );
    const list = await listModels(KEY, { fetchImpl: f });
    expect(list).toHaveLength(2);
    expect(calls[1]!.url).toContain('pageToken=T2');
  });
  it('zły klucz → bad-key', async () => {
    const { f } = fakeFetch(json(403, { error: { message: 'denied' } }));
    expect(await code(listModels(KEY, { fetchImpl: f }))).toBe('bad-key');
  });
  it('testConnection: modelListed', async () => {
    const r = await testConnection(KEY, 'gemini-3-flash', {
      fetchImpl: fakeFetch(json(200, page)).f,
    });
    expect(r).toMatchObject({ ok: true, modelListed: true });
    const alias = await testConnection(KEY, 'gemini-pro-latest', {
      fetchImpl: fakeFetch(json(200, page)).f,
    });
    expect(alias.modelListed).toBe(false);
  });
});
