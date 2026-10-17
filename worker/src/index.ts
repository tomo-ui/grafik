/**
 * Wariant B (plan, sekcja 3): proxy do Gemini na Cloudflare Workers.
 * Klucz API siedzi w sekrecie Workera (`wrangler secret put GEMINI_API_KEY`), nigdy w aplikacji.
 * Aplikacja woła POST /api/parse-schedule z nagłówkiem `x-invite-token` i treścią
 * `{ model, body }`, gdzie `body` to zwykłe żądanie `generateContent`.
 */
export interface Env {
  GEMINI_API_KEY: string;
  /** zaproszenia oddzielone przecinkami */
  INVITE_TOKENS: string;
  /** dozwolony Origin aplikacji, np. https://grafik.example.com */
  ALLOWED_ORIGIN: string;
  /** limit zapytań na token na minutę (domyślnie 10) */
  RATE_LIMIT_PER_MIN?: string;
}

const MAX_BODY = 12 * 1024 * 1024;
const UPSTREAM = 'https://generativelanguage.googleapis.com/v1beta/models/';
const MODEL_RE = /^[A-Za-z0-9._-]{1,80}$/;

const hits = new Map<string, number[]>();
/** Okno przesuwne w pamięci izolatu — prosta ochrona; mocniejszy limit: Rate Limiting binding. */
export function rateLimited(key: string, limit: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}
export const resetRateLimit = () => hits.clear();

function cors(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'content-type, x-invite-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}
function json(status: number, body: unknown, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) },
  });
}

export async function handle(
  req: Request,
  env: Env,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(req.url);
  const origin = env.ALLOWED_ORIGIN;
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (url.pathname !== '/api/parse-schedule') return json(404, { error: 'not-found' }, origin);
  if (req.method !== 'POST') return json(405, { error: 'method-not-allowed' }, origin);
  if (req.headers.get('Origin') !== origin) return json(403, { error: 'forbidden-origin' }, origin);

  const token = req.headers.get('x-invite-token') ?? '';
  const allowed = env.INVITE_TOKENS.split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (!token || !allowed.includes(token)) return json(401, { error: 'bad-token' }, origin);

  if (rateLimited(token, Number(env.RATE_LIMIT_PER_MIN ?? 10)))
    return json(429, { error: 'rate-limited' }, origin);

  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_BODY) return json(413, { error: 'too-large' }, origin);

  let payload: { model?: unknown; body?: unknown };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return json(400, { error: 'bad-json' }, origin);
  }
  const model = typeof payload.model === 'string' ? payload.model.replace(/^models\//, '') : '';
  if (!MODEL_RE.test(model) || typeof payload.body !== 'object' || payload.body === null)
    return json(400, { error: 'bad-request' }, origin);

  const upstream = await fetchImpl(`${UPSTREAM}${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify(payload.body),
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) },
  });
}

export default { fetch: (req: Request, env: Env) => handle(req, env) };
