/** Błędy skanowania AI z polskimi komunikatami (plan 4.1). */
export type AiErrorCode =
  | 'bad-request' // 400: zły obraz/parametr
  | 'bad-key' // 401/403
  | 'no-model' // 404
  | 'rate-limit' // 429
  | 'server' // 5xx
  | 'timeout'
  | 'offline'
  | 'region'
  | 'blocked' // filtry bezpieczeństwa
  | 'empty'
  | 'bad-json'
  | 'bad-schema'
  | 'aborted'
  | 'unknown';

const MESSAGES: Record<AiErrorCode, string> = {
  'bad-request': 'Nie udało się przetworzyć zdjęcia lub ustawień. Spróbuj innego zdjęcia.',
  'bad-key': 'Klucz API jest nieprawidłowy lub zablokowany. Sprawdź go w Ustawieniach.',
  'no-model': 'Wybrany model nie istnieje. Wybierz inny model w Ustawieniach.',
  'rate-limit': 'Limit darmowego API — spróbuj za minutę.',
  server: 'Usługa Gemini jest chwilowo niedostępna. Spróbuj ponownie.',
  timeout: 'Analiza trwa zbyt długo. Spróbuj ponownie.',
  offline: 'Brak połączenia z internetem.',
  region: 'Darmowe API nie jest dostępne w Twoim regionie.',
  blocked: 'Nie udało się odczytać grafiku, spróbuj wyraźniejszego zdjęcia.',
  empty: 'Nie udało się odczytać grafiku, spróbuj wyraźniejszego zdjęcia.',
  'bad-json': 'Odpowiedź AI była uszkodzona. Spróbuj ponownie.',
  'bad-schema': 'Odpowiedź AI miała nieoczekiwany format. Spróbuj ponownie.',
  aborted: 'Anulowano.',
  unknown: 'Wystąpił nieoczekiwany błąd. Spróbuj ponownie.',
};

export class AiError extends Error {
  readonly code: AiErrorCode;
  /** dla 429: ile sekund czekać (z RetryInfo.retryDelay) */
  readonly retryAfterSec?: number;
  /** dla błędów, po których warto otworzyć ustawienia */
  readonly goToSettings: boolean;

  constructor(code: AiErrorCode, opts: { retryAfterSec?: number; detail?: string } = {}) {
    super(MESSAGES[code]);
    this.name = 'AiError';
    this.code = code;
    this.retryAfterSec = opts.retryAfterSec;
    this.goToSettings = code === 'bad-key' || code === 'no-model';
    if (opts.detail) this.cause = opts.detail;
  }
}

/** „30s”, „1.5s”, „45” → sekundy (zaokrąglone w górę). */
export function parseRetryDelay(value: unknown): number | undefined {
  if (typeof value === 'number') return Math.ceil(value);
  if (typeof value !== 'string') return undefined;
  const m = /^(\d+(?:\.\d+)?)s?$/.exec(value.trim());
  return m ? Math.ceil(Number(m[1])) : undefined;
}

interface GoogleErrorBody {
  error?: {
    code?: number;
    status?: string;
    message?: string;
    details?: { '@type'?: string; retryDelay?: string }[];
  };
}

/** Mapuje odpowiedź HTTP błędu na AiError. */
export function mapHttpError(status: number, body: unknown): AiError {
  const b = (body ?? {}) as GoogleErrorBody;
  const msg = (b.error?.message ?? '').toLowerCase();
  const detail = b.error?.message;

  if (/location|region|not supported in your|user location/.test(msg)) {
    return new AiError('region', { detail });
  }
  if (status === 429 || b.error?.status === 'RESOURCE_EXHAUSTED') {
    const info = b.error?.details?.find((d) => d['@type']?.includes('RetryInfo'));
    return new AiError('rate-limit', { retryAfterSec: parseRetryDelay(info?.retryDelay), detail });
  }
  if (status === 401 || status === 403) return new AiError('bad-key', { detail });
  if (status === 404) return new AiError('no-model', { detail });
  if (status === 400) {
    if (/api key|api_key/.test(msg)) return new AiError('bad-key', { detail });
    return new AiError('bad-request', { detail });
  }
  if (status >= 500) return new AiError('server', { detail });
  return new AiError('unknown', { detail });
}

/** Maskowanie klucza w logach (P-19): „****xyz”. */
export function maskKey(key: string | undefined): string {
  if (!key) return '(brak)';
  return `****${key.slice(-3)}`;
}
