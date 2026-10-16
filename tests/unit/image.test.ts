import { describe, expect, it, vi } from 'vitest';
import {
  batchWithinLimit,
  clampCrop,
  fitWithin,
  ImageError,
  MAX_IMAGES,
  probeImageSize,
  rotatedSize,
} from '../../src/ai/image';
import { imageFromClipboardData, readClipboardImage } from '../../src/features/scan/clipboard';

/** minimalny nagłówek PNG o danych wymiarach */
function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const dv = new DataView(b.buffer);
  dv.setUint32(8, 13);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  return b;
}

/** JPEG: SOI + APP0 (16 B) + SOF0 */
function jpeg(w: number, h: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set([0xff, 0xd8]);
  b.set([0xff, 0xe0, 0x00, 0x10], 2); // APP0, długość 16
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08], 20); // SOF0
  b[25] = h >> 8;
  b[26] = h & 0xff;
  b[27] = w >> 8;
  b[28] = w & 0xff;
  return b;
}

describe('probeImageSize', () => {
  it('PNG', () => expect(probeImageSize(png(1170, 2532))).toEqual({ width: 1170, height: 2532 }));
  it('duży PNG (P-21)', () =>
    expect(probeImageSize(png(8000, 6000))).toEqual({ width: 8000, height: 6000 }));
  it('JPEG (SOF0 za APP0)', () =>
    expect(probeImageSize(jpeg(4032, 3024))).toEqual({ width: 4032, height: 3024 }));
  it('GIF', () => {
    const b = new Uint8Array(12);
    b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x01, 0x90, 0x00]);
    expect(probeImageSize(b)).toEqual({ width: 288, height: 144 });
  });
  it('WebP VP8X', () => {
    const b = new Uint8Array(32);
    b.set([0x52, 0x49, 0x46, 0x46], 0);
    b.set([0x57, 0x45, 0x42, 0x50], 8);
    b.set([0x56, 0x50, 0x38, 0x58], 12);
    b.set([0x1f, 0x03, 0x00], 24); // szerokość-1 = 799
    b.set([0x57, 0x02, 0x00], 27); // wysokość-1 = 599
    expect(probeImageSize(b)).toEqual({ width: 800, height: 600 });
  });
  it('nieznany format / śmieci → null', () => {
    expect(probeImageSize(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(probeImageSize(new Uint8Array(100))).toBeNull();
  });
});

describe('skalowanie, obrót, kadr, limity', () => {
  it('fitWithin ogranicza dłuższy bok do 2048 i nie powiększa', () => {
    expect(fitWithin(4000, 3000)).toMatchObject({ width: 2048, height: 1536 });
    expect(fitWithin(3000, 4000)).toMatchObject({ width: 1536, height: 2048 });
    expect(fitWithin(800, 600)).toMatchObject({ width: 800, height: 600, scale: 1 });
    expect(fitWithin(1, 5000).width).toBe(1);
  });
  it('rotatedSize zamienia boki przy 90/270', () => {
    expect(rotatedSize(400, 300, 0)).toEqual({ width: 400, height: 300 });
    expect(rotatedSize(400, 300, 90)).toEqual({ width: 300, height: 400 });
    expect(rotatedSize(400, 300, 180)).toEqual({ width: 400, height: 300 });
    expect(rotatedSize(400, 300, 270)).toEqual({ width: 300, height: 400 });
  });
  it('clampCrop trzyma kadr w obrazie i nie pozwala go zredukować do zera', () => {
    expect(clampCrop({ x: -0.2, y: 0.9, w: 0.5, h: 0.5 })).toEqual({
      x: 0,
      y: 0.5,
      w: 0.5,
      h: 0.5,
    });
    expect(clampCrop({ x: 0, y: 0, w: 0, h: 5 })).toEqual({ x: 0, y: 0, w: 0.1, h: 1 });
  });
  it('limit zestawu: max 4 zdjęcia i < 15 MB łącznie', () => {
    expect(MAX_IMAGES).toBe(4);
    expect(batchWithinLimit([2_000_000, 2_000_000])).toBe(true);
    expect(batchWithinLimit([8_000_000, 8_000_000])).toBe(false);
    expect(batchWithinLimit([1, 1, 1, 1, 1])).toBe(false);
  });
  it('komunikaty błędów obrazu po polsku (P-22)', () => {
    expect(new ImageError('heic').message).toMatch(/zrzut ekranu lub zapisz jako JPG/);
    expect(new ImageError('too-large').message).toMatch(/40 megapikseli/);
  });
});

describe('schowek (4.3a)', () => {
  const stubClipboard = (read: unknown) =>
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: read === undefined ? undefined : { read },
    });

  it('brak clipboard.read → unsupported (ścieżka zapasowa)', async () => {
    stubClipboard(undefined);
    expect(await readClipboardImage('ios')).toEqual({ status: 'unsupported' });
    vi.unstubAllGlobals();
  });
  it('obraz w schowku (dowolny image/*)', async () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    stubClipboard(async () => [{ types: ['text/plain', 'image/png'], getType: async () => blob }]);
    const r = await readClipboardImage('android');
    expect(r.status).toBe('image');
    vi.unstubAllGlobals();
  });
  it('w schowku tylko tekst → no-image (E-14)', async () => {
    stubClipboard(async () => [{ types: ['text/plain'], getType: async () => new Blob() }]);
    expect(await readClipboardImage('ios')).toEqual({ status: 'no-image' });
    vi.unstubAllGlobals();
  });
  it('NotAllowedError: iOS cicho (dismissed), Android z instrukcją (denied) (E-15)', async () => {
    stubClipboard(async () => {
      throw new DOMException('denied', 'NotAllowedError');
    });
    expect(await readClipboardImage('ios')).toEqual({ status: 'dismissed' });
    expect(await readClipboardImage('android')).toEqual({ status: 'denied' });
    vi.unstubAllGlobals();
  });
  it('imageFromClipboardData: pliki i elementy', () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    expect(imageFromClipboardData({ files: [file], items: [] } as unknown as DataTransfer)).toBe(
      file,
    );
    const item = { kind: 'file', type: 'image/jpeg', getAsFile: () => file };
    expect(imageFromClipboardData({ files: [], items: [item] } as unknown as DataTransfer)).toBe(
      file,
    );
    expect(
      imageFromClipboardData({
        files: [],
        items: [{ kind: 'string', type: 'text/plain' }],
      } as unknown as DataTransfer),
    ).toBeNull();
    expect(imageFromClipboardData(null)).toBeNull();
  });
});
