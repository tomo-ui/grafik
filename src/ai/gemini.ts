import { AiError, mapHttpError, maskKey, parseRetryDelay } from './errors';
import { JSON_SHAPE_HINT } from './prompt';
import { parseModelJson, RESPONSE_SCHEMA, type ParsedSchedule } from './schema';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RATE_RETRIES = 2;

export interface InlineImage {
  mime: string;
  /** base64 bez prefiksu data: */
  base64: string;
}

export interface GenerateOptions {
  apiKey: string;
  model: string;
  prompt: string;
  images: InlineImage[];
  signal?: AbortSignal;
  timeoutMs?: number;
  /** odliczanie przy 429: ile sekund do kolejnej próby (0 = próba właśnie rusza) */
  onWait?: (secondsLeft: number) => void;
  fetchImpl?: typeof fetch;
  /** wstrzykiwane w testach */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface GenerateResult {
  parsed: ParsedSchedule;
  rawText: string;
  model: string;
}

const devLog = (...args: unknown[]) => {
  if (import.meta.env?.DEV) console.debug('[gemini]', ...args);
};

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AiError('aborted'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new AiError('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** „models/gemini-x” → „gemini-x” */
export const modelId = (m: string) => m.trim().replace(/^models\//, '');

function buildBody(o: GenerateOptions, useSchema: boolean, useThinking: boolean) {
  const prompt = useSchema ? o.prompt : `${o.prompt}\n\n${JSON_SHAPE_HINT}`;
  const generationConfig: Record<string, unknown> = {
    temperature: 0,
    responseMimeType: 'application/json',
  };
  if (useSchema) generationConfig.responseSchema = RESPONSE_SCHEMA;
  // najniższy poziom „myślenia” — szybciej i taniej; API może go nie znać (wtedy ponawiamy bez)
  if (useThinking) generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  return {
    contents: [
      {
        parts: [
          { text: prompt },
          ...o.images.map((i) => ({ inline_data: { mime_type: i.mime, data: i.base64 } })),
        ],
      },
    ],
    generationConfig,
  };
}

interface Candidate {
  content?: { parts?: { text?: string; thought?: boolean }[] };
  finishReason?: string;
}
interface GenerateResponse {
  candidates?: Candidate[];
  promptFeedback?: { blockReason?: string };
}

/** Wyciąga tekst odpowiedzi; puste / zablokowane → AiError. */
export function extractText(data: GenerateResponse): string {
  if (data.promptFeedback?.blockReason) throw new AiError('blocked');
  const cand = data.candidates?.[0];
  if (!cand) throw new AiError('empty');
  if (cand.finishReason === 'SAFETY' || cand.finishReason === 'RECITATION') {
    throw new AiError('blocked');
  }
  const text = (cand.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim();
  if (!text) throw new AiError('empty');
  return text;
}

async function fetchWithTimeout(
  f: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  external?: AbortSignal,
): Promise<Response> {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onExternal = () => ctrl.abort();
  if (external?.aborted) ctrl.abort();
  else external?.addEventListener('abort', onExternal, { once: true });
  try {
    return await f(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (external?.aborted) throw new AiError('aborted');
    if (timedOut) throw new AiError('timeout');
    if (e instanceof DOMException && e.name === 'AbortError') throw new AiError('aborted');
    // TypeError: Failed to fetch — brak sieci / zerwane połączenie (P-25)
    throw new AiError('offline', { detail: String(e) });
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onExternal);
  }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

/**
 * Jedno zapytanie = jeden skan. Obsługuje: 429 (RetryInfo + backoff, max 2), fallback bez
 * responseSchema i bez thinkingConfig (HTTP 400), timeout 60 s, anulowanie.
 * Klucz jedzie wyłącznie w nagłówku x-goog-api-key — nigdy w URL ani w body (P-19).
 */
export async function generateSchedule(o: GenerateOptions): Promise<GenerateResult> {
  if (!o.apiKey.trim()) throw new AiError('bad-key');
  const f = o.fetchImpl ?? fetch.bind(globalThis);
  const sleep = o.sleep ?? defaultSleep;
  const model = modelId(o.model);
  const url = `${BASE}/models/${encodeURIComponent(model)}:generateContent`;

  let useSchema = true;
  let useThinking = true;
  let rateRetries = 0;

  for (let attempt = 0; attempt < 6; attempt++) {
    if (o.signal?.aborted) throw new AiError('aborted');
    const body = buildBody(o, useSchema, useThinking);
    devLog('POST', model, `key=${maskKey(o.apiKey)}`, { useSchema, useThinking, attempt });

    const res = await fetchWithTimeout(
      f,
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': o.apiKey },
        body: JSON.stringify(body),
      },
      o.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      o.signal,
    );

    if (res.ok) {
      const data = (await readJson(res)) as GenerateResponse | undefined;
      if (!data) throw new AiError('bad-json');
      const rawText = extractText(data);
      return { parsed: parseModelJson(rawText), rawText, model };
    }

    const errBody = await readJson(res);
    const err = mapHttpError(res.status, errBody);

    if (err.code === 'rate-limit') {
      if (rateRetries >= MAX_RATE_RETRIES) throw err;
      const wait = Math.min(60, err.retryAfterSec ?? 5 * 2 ** rateRetries);
      rateRetries++;
      for (let s = wait; s > 0; s--) {
        o.onWait?.(s);
        await sleep(1000, o.signal);
      }
      o.onWait?.(0);
      continue;
    }

    if (res.status === 400) {
      const msg = String(
        (errBody as { error?: { message?: string } })?.error?.message ?? '',
      ).toLowerCase();
      if (useThinking && /thinking/.test(msg)) {
        devLog('model odrzucił thinkingConfig — ponawiam bez');
        useThinking = false;
        continue;
      }
      if (useSchema && /schema|nullable|response_?mime|enum|json/.test(msg)) {
        devLog('model odrzucił responseSchema — ponawiam bez');
        useSchema = false;
        continue;
      }
    }
    throw err;
  }
  throw new AiError('unknown');
}

/* --------------------------------------------------------- modele i test */

export interface ModelInfo {
  id: string;
  displayName?: string;
}

/** Lista modeli obsługujących generateContent (GET /v1beta/models). Waliduje też klucz. */
export async function listModels(
  apiKey: string,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<ModelInfo[]> {
  if (!apiKey.trim()) throw new AiError('bad-key');
  const f = opts.fetchImpl ?? fetch.bind(globalThis);
  const out: ModelInfo[] = [];
  let pageToken = '';
  for (let page = 0; page < 5; page++) {
    const url = `${BASE}/models?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetchWithTimeout(
      f,
      url,
      { headers: { 'x-goog-api-key': apiKey } },
      opts.timeoutMs ?? 15_000,
      opts.signal,
    );
    const data = (await readJson(res)) as
      | {
          models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
          nextPageToken?: string;
        }
      | undefined;
    if (!res.ok) throw mapHttpError(res.status, data);
    for (const m of data?.models ?? []) {
      if (m.supportedGenerationMethods?.includes('generateContent')) {
        out.push({ id: modelId(m.name), displayName: m.displayName });
      }
    }
    if (!data?.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out;
}

export interface ConnectionTest {
  ok: boolean;
  models: ModelInfo[];
  /** czy wybrany model jest na liście (aliasy „-latest” mogą się na niej nie pojawić) */
  modelListed: boolean;
}

/** „Testuj połączenie”: klucz poprawny i (jeśli się da) model dostępny. */
export async function testConnection(
  apiKey: string,
  model: string,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<ConnectionTest> {
  const models = await listModels(apiKey, opts);
  const id = modelId(model);
  return { ok: true, models, modelListed: models.some((m) => m.id === id) };
}

/** Podpowiedzi do pola modelu. */
export const MODEL_SUGGESTIONS = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
export { parseRetryDelay };
