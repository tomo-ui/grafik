// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const headers = readFileSync('public/_headers', 'utf8');
const csp = /Content-Security-Policy: (.+)/.exec(headers)![1]!.trim();
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

describe('wdrożenie', () => {
  it('CSP: tylko własne skrypty, połączenia do własnej domeny i Gemini, brak eval', () => {
    const d = Object.fromEntries(
      csp.split(';').map((p) => {
        const [k, ...v] = p.trim().split(/\s+/);
        return [k!, v];
      }),
    ) as Record<string, string[]>;
    expect(d['script-src']).toEqual(["'self'"]);
    expect(d['connect-src']).toEqual(["'self'", 'https://generativelanguage.googleapis.com']);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['frame-ancestors']).toEqual(["'none'"]);
    expect(csp).not.toContain('unsafe-eval');
    expect(d['script-src']).not.toContain("'unsafe-inline'");
  });

  it('vercel.json ma tę samą CSP co _headers', () => {
    const all = vercel.headers.find((h) => h.source === '/(.*)')!;
    expect(all.headers.find((h) => h.key === 'Content-Security-Policy')!.value).toBe(csp);
  });

  it('_redirects przekierowuje wszystko na index.html (SPA)', () => {
    expect(readFileSync('public/_redirects', 'utf8').trim()).toBe('/*    /index.html   200');
  });

  it('service worker i index.html nie są cache’owane na stałe', () => {
    expect(headers).toMatch(/\/sw\.js\s+Cache-Control: no-cache/);
    expect(headers).toMatch(/\/index\.html\s+Cache-Control: no-cache/);
  });
});
