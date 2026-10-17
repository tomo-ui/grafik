// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const csp = readFileSync('config/csp.txt', 'utf8').trim();

describe('wdrożenie na Vercel', () => {
  it('CSP: tylko własne skrypty, połączenia do własnej domeny i Gemini, brak eval', () => {
    const d = Object.fromEntries(
      csp.split(';').map((p) => {
        const [k, ...v] = p.trim().split(' ');
        return [k!, v];
      }),
    ) as Record<string, string[]>;
    expect(d['script-src']).toEqual(["'self'"]);
    expect(d['connect-src']).toEqual(["'self'", 'https://generativelanguage.googleapis.com']);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('frame-ancestors'); // w <meta> ignorowane
  });

  it('vercel.json: te same dyrektywy CSP co config/csp.txt, SPA fallback, brak cache SW', () => {
    const v = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      rewrites: { source: string; destination: string }[];
      headers: { source: string; headers: { key: string; value: string }[] }[];
    };
    const all = v.headers.find((h) => h.source === '/(.*)')!;
    const header = all.headers.find((h) => h.key === 'Content-Security-Policy')!.value;
    expect(header.startsWith(csp)).toBe(true);
    expect(header).toContain("frame-ancestors 'none'");
    const spa = v.rewrites.find((r) => r.destination === '/index.html')!;
    expect(spa.source).toContain('pc/'); // konsola /pc/ nie jest przekierowywana na aplikację mobilną
    expect(v.rewrites.some((r) => r.source === '/pc' && r.destination === '/pc/index.html')).toBe(
      true,
    );
    const sw = v.headers.find((h) => h.source === '/sw.js')!;
    expect(sw.headers[0]!.value).toBe('no-cache');
    expect(existsSync('.github/workflows')).toBe(false);
  });
});

describe('konsola na komputer (/pc/)', () => {
  it('osobne wejście w buildzie, własny manifest (zakres /pc/) i trasa service workera', () => {
    expect(readFileSync('vite.config.ts', 'utf8')).toContain("pc: 'pc/index.html'");
    const manifest = JSON.parse(readFileSync('public/pc.webmanifest', 'utf8')) as Record<
      string,
      unknown
    >;
    expect(manifest.scope).toBe('pc/');
    expect(manifest.start_url).toBe('pc/');
    const sw = readFileSync('src/sw.ts', 'utf8');
    expect(sw).toContain('pc/index.html');
    // trasa /pc/ jest rejestrowana przed trasą aplikacji mobilnej, a ta wyklucza /pc/
    expect(sw.indexOf('pc/index.html')).toBeLessThan(sw.indexOf('${BASE}index.html'));
    expect(sw).toContain('share-target|api/|pc(/|$)');
  });

  it('konsola nie współdzieli komponentów ekranów z aplikacją mobilną (tylko logika i dane)', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
      );
    // ekrany i komponenty aplikacji mobilnej: src/ui oraz katalogi ekranów w src/features
    const forbidden = [
      'src/ui',
      'src/features/team',
      'src/features/my-schedule',
      'src/features/calendar',
      'src/features/settings',
      'src/features/onboarding',
      'src/features/shift-editor',
      'src/features/scan/Scan',
      'src/features/scan/Review',
    ].map((p) => resolve(p));
    const files = walk('src/pc').filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/from '([^']+)'/g)) {
        const spec = m[1]!;
        if (!spec.startsWith('.')) continue;
        const target = resolve(dirname(f), spec);
        for (const bad of forbidden) {
          expect(target.startsWith(bad), `${f} importuje ${spec}`).toBe(false);
        }
      }
    }
  });
});

describe('prywatność i aktualizacje', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
    );
  // klucze Google API: „AIza” + 35 znaków
  const KEY = /AIza[0-9A-Za-z_-]{35}/;

  it('w src/, worker/, tests/, docs/ i public/ nie ma klucza API; brak plików .env', () => {
    const files = ['src', 'worker', 'tests', 'docs', 'public', 'scripts']
      .filter((d) => existsSync(d))
      .flatMap(walk)
      .filter((f) => /\.(ts|tsx|js|mjs|json|md|html|css|toml|txt)$/.test(f));
    expect(files.length).toBeGreaterThan(50);
    for (const f of files) expect(KEY.test(readFileSync(f, 'utf8')), f).toBe(false);
    expect(readdirSync('.').filter((f) => f.startsWith('.env'))).toEqual([]);
  });

  it('zbudowany dist/ nie zawiera klucza API (gdy istnieje)', () => {
    if (!existsSync('dist')) return;
    for (const f of walk('dist').filter((f) => /\.(js|mjs|html|json|css)$/.test(f)))
      expect(KEY.test(readFileSync(f, 'utf8')), f).toBe(false);
  });

  it('P-09: SW czeka na zgodę — skipWaiting tylko po wiadomości, tryb „prompt”', () => {
    const sw = readFileSync('src/sw.ts', 'utf8');
    expect(sw.match(/skipWaiting\(\)/g)).toHaveLength(1);
    expect(sw).toMatch(/SKIP_WAITING[\s\S]{0,80}skipWaiting\(\)/);
    expect(readFileSync('vite.config.ts', 'utf8')).toContain("registerType: 'prompt'");
  });
});
