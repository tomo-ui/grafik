// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handle, resetRateLimit, type Env } from '../../worker/src/index';

const env: Env = {
  GEMINI_API_KEY: 'sekret-workera',
  INVITE_TOKENS: 'abc, def',
  ALLOWED_ORIGIN: 'https://grafik.example.com',
  RATE_LIMIT_PER_MIN: '2',
};
const goodHeaders = {
  Origin: 'https://grafik.example.com',
  'x-invite-token': 'abc',
  'content-type': 'application/json',
};
const req = (init: RequestInit = {}, path = '/api/parse-schedule') =>
  new Request(`https://proxy.example.com${path}`, {
    method: 'POST',
    headers: goodHeaders,
    body: JSON.stringify({ model: 'models/gemini-flash-latest', body: { contents: [] } }),
    ...init,
  });
const upstreamOk = () => vi.fn(async () => new Response('{"candidates":[]}', { status: 200 }));
const asFetch = (f: ReturnType<typeof upstreamOk>) => f as unknown as typeof fetch;

beforeEach(() => resetRateLimit());

describe('proxy Gemini (wariant B)', () => {
  it('przekazuje żądanie do Gemini z kluczem z sekretu i zwraca odpowiedź', async () => {
    const f = upstreamOk();
    const res = await handle(req(), env, asFetch(f));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"candidates":[]}');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
    );
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('sekret-workera');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(env.ALLOWED_ORIGIN);
  });

  it('odrzuca zły token, zły Origin, złą metodę i nieznaną ścieżkę — bez wołania Gemini', async () => {
    const f = upstreamOk();
    const call = (r: Request) => handle(r, env, asFetch(f));
    expect((await call(req({ headers: { Origin: env.ALLOWED_ORIGIN } }))).status).toBe(401);
    const wrongOrigin = req({ headers: { ...goodHeaders, Origin: 'https://zly.pl' } });
    expect((await call(wrongOrigin)).status).toBe(403);
    expect((await call(req({}, '/inne'))).status).toBe(404);
    expect((await call(new Request('https://p/api/parse-schedule'))).status).toBe(405);
    expect(f).not.toHaveBeenCalled();
  });

  it('limit zapytań na token: trzecie w minucie dostaje 429', async () => {
    const f = upstreamOk();
    const call = () => handle(req(), env, asFetch(f));
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(429);
  });

  it('waliduje nazwę modelu i treść (brak wstrzykiwania ścieżki)', async () => {
    const f = upstreamOk();
    const bad = req({ body: JSON.stringify({ model: '../../evil', body: {} }) });
    expect((await handle(bad, env, asFetch(f))).status).toBe(400);
    expect((await handle(req({ body: 'nie-json' }), env, asFetch(f))).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it('odpowiada na preflight CORS tylko dla dozwolonego Origin', async () => {
    const res = await handle(
      new Request('https://p/api/parse-schedule', { method: 'OPTIONS' }),
      env,
      asFetch(upstreamOk()),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(env.ALLOWED_ORIGIN);
  });
});
