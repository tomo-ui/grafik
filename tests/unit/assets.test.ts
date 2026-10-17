// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

describe('zasoby PWA', () => {
  it.each([
    ['public/icons/icon-192.png', 192],
    ['public/icons/icon-512.png', 512],
    ['public/icons/maskable-512.png', 512],
    ['public/icons/apple-touch-icon.png', 180],
  ])('ikona %s ma rozmiar %i×%i', async (file, size) => {
    const m = await sharp(file).metadata();
    expect([m.width, m.height]).toEqual([size, size]);
  });

  it('apple-touch-icon jest nieprzezroczysta w narożnikach (wymóg iOS)', async () => {
    const { data, info } = await sharp('public/icons/apple-touch-icon.png')
      .raw()
      .toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return info.channels === 4 ? data[i + 3]! : 255;
    };
    for (const [x, y] of [
      [0, 0],
      [179, 0],
      [0, 179],
      [179, 179],
    ] as const)
      expect(px(x, y)).toBe(255);
  });

  it('ikona maskable ma tło aż do krawędzi (bezpieczna strefa na treść)', async () => {
    const { data, info } = await sharp('public/icons/maskable-512.png')
      .raw()
      .toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) =>
      info.channels === 4 ? data[(y * info.width + x) * 4 + 3]! : 255;
    expect(alpha(0, 0)).toBe(255);
    expect(alpha(511, 511)).toBe(255);
  });

  it('splash screeny: wymiary zgodne z nazwą, jasny i ciemny, linki w index.html wskazują istniejące pliki', async () => {
    const files = readdirSync('public/splash').filter((f) => f.endsWith('.png'));
    expect(files.length).toBeGreaterThanOrEqual(16);
    for (const f of files) {
      const [, w, h] = /^(\d+)x(\d+)-(light|dark)\.png$/.exec(f)!.map(Number) as unknown as [
        string,
        number,
        number,
      ];
      const m = await sharp(`public/splash/${f}`).metadata();
      expect([m.width, m.height]).toEqual([w, h]);
    }
    const html = readFileSync('index.html', 'utf8');
    const hrefs = [...html.matchAll(/rel="apple-touch-startup-image"[^>]*href="([^"]+)"/g)].map(
      (m) => m[1]!,
    );
    expect(hrefs.length).toBe(files.length);
    for (const h of hrefs) expect(existsSync(`public${h}`), h).toBe(true);
    // iPhone 12 (390×844 @3) ma swój splash w obu motywach
    expect(html).toContain(
      '(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)',
    );
    expect(html).toContain('prefers-color-scheme: dark');
  });

  it('index.html: meta iOS i ikona dotykowa', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('/icons/apple-touch-icon.png');
  });
});
