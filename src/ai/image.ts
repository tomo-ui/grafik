/** Przygotowanie zdjęcia po stronie klienta (plan 4.3): dekodowanie, orientacja, kompresja, miniatury. */

export const MAX_IMAGES = 4;
export const MAX_SIDE = 2048;
export const JPEG_QUALITY = 0.85;
export const WORKING_QUALITY = 0.9;
export const MAX_TOTAL_BASE64 = 15 * 1024 * 1024;
export const MAX_PIXELS = 40_000_000; // P-21
export const SMALL_SIDE = 600;
/** powyżej tylu pikseli PNG dekodujemy ze skalowaniem już przy dekodowaniu (P-21) */
const RESIZE_AT_DECODE_PIXELS = 12_000_000;

export type ImageSource = 'camera' | 'library' | 'clipboard' | 'paste' | 'drop' | 'share';

export type ImageErrorCode = 'not-image' | 'heic' | 'too-large' | 'decode' | 'limit';

const IMAGE_MESSAGES: Record<ImageErrorCode, string> = {
  'not-image': 'To nie jest zdjęcie. Wybierz plik graficzny (JPG, PNG).',
  heic: 'Ten format nie jest obsługiwany — zrób zrzut ekranu lub zapisz jako JPG.',
  'too-large':
    'Zdjęcie jest zbyt duże (maks. 40 megapikseli). Zrób zrzut ekranu lub zmniejsz zdjęcie.',
  decode: 'Nie udało się otworzyć zdjęcia. Spróbuj innego pliku.',
  limit: `Możesz dodać maksymalnie ${MAX_IMAGES} zdjęcia.`,
};

export class ImageError extends Error {
  readonly code: ImageErrorCode;
  constructor(code: ImageErrorCode) {
    super(IMAGE_MESSAGES[code]);
    this.name = 'ImageError';
    this.code = code;
  }
}

export interface Crop {
  /** ułamki 0–1 względem obrazu PO obrocie */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScanImage {
  id: string;
  /** zdekodowane i zmniejszone do ≤ 2048 px (JPEG) — baza do obrotu/kadrowania */
  working: Blob;
  url: string; // object URL podglądu (sprzątany przez revokeScanImage)
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  crop: Crop | null;
  source: ImageSource;
  /** dłuższy bok oryginału < 600 px — ostrzeżenie „może być nieczytelne” */
  small: boolean;
}

/* ------------------------------------------------------------ czyste funkcje */

/** Wymiary z nagłówka PNG/JPEG/WebP/GIF bez dekodowania całego obrazu. */
export function probeImageSize(b: Uint8Array): { width: number; height: number } | null {
  const u32 = (o: number) =>
    ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
  // PNG
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: u32(16), height: u32(20) };
  }
  // GIF
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { width: b[6]! | (b[7]! << 8), height: b[8]! | (b[9]! << 8) };
  }
  // JPEG: szukamy znacznika SOFn
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = b[o + 1]!;
      if (marker === 0xff) {
        o++;
        continue;
      }
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return { height: (b[o + 5]! << 8) | b[o + 6]!, width: (b[o + 7]! << 8) | b[o + 8]! };
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        o += 2;
        continue;
      }
      o += 2 + ((b[o + 2]! << 8) | b[o + 3]!);
    }
    return null;
  }
  // WebP (RIFF....WEBP)
  if (b.length > 30 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
    const tag = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
    if (tag === 'VP8X') {
      return {
        width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)),
        height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)),
      };
    }
    if (tag === 'VP8 ') {
      return {
        width: (b[26]! | (b[27]! << 8)) & 0x3fff,
        height: (b[28]! | (b[29]! << 8)) & 0x3fff,
      };
    }
    if (tag === 'VP8L') {
      const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

/** Skalowanie do `max` px dłuższego boku (bez powiększania). */
export function fitWithin(width: number, height: number, max = MAX_SIDE) {
  const long = Math.max(width, height);
  const scale = long > max ? max / long : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/** Wymiary po obrocie o 90/270° zamieniają się miejscami. */
export function rotatedSize(w: number, h: number, rotation: number) {
  return rotation % 180 === 0 ? { width: w, height: h } : { width: h, height: w };
}

/** Czy zestaw (po kompresji) mieści się w limicie żądania (plan 4.3 pkt 6). */
export function batchWithinLimit(base64Lengths: number[]): boolean {
  return (
    base64Lengths.length <= MAX_IMAGES &&
    base64Lengths.reduce((a, b) => a + b, 0) < MAX_TOTAL_BASE64
  );
}

/** Normalizuje ułamkowy kadr: ogranicza do 0–1 i wymusza min. rozmiar. */
export function clampCrop(c: Crop, min = 0.1): Crop {
  const w = Math.min(1, Math.max(min, c.w));
  const h = Math.min(1, Math.max(min, c.h));
  return {
    x: Math.min(1 - w, Math.max(0, c.x)),
    y: Math.min(1 - h, Math.max(0, c.y)),
    w,
    h,
  };
}

/* ------------------------------------------------------------- DOM / canvas */

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: AnyCanvas) {
  const ctx = c.getContext('2d') as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new ImageError('decode');
  return ctx;
}

async function canvasToBlob(c: AnyCanvas, type: string, quality: number): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type, quality });
  return new Promise((res, rej) =>
    (c as HTMLCanvasElement).toBlob(
      (b) => (b ? res(b) : rej(new ImageError('decode'))),
      type,
      quality,
    ),
  );
}

async function decodeBitmap(
  blob: Blob,
  resizeTo?: { width: number; height: number },
): Promise<ImageBitmap> {
  const opts: ImageBitmapOptions = { imageOrientation: 'from-image' };
  if (resizeTo) {
    opts.resizeWidth = resizeTo.width;
    opts.resizeHeight = resizeTo.height;
    opts.resizeQuality = 'high';
  }
  try {
    return await createImageBitmap(blob, opts);
  } catch {
    // starsze przeglądarki: opcje nieobsługiwane — próba bez opcji
    return await createImageBitmap(blob);
  }
}

let seq = 0;
const newId = () => `img${Date.now().toString(36)}${(seq++).toString(36)}`;

async function readHead(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(0, 1_048_576).arrayBuffer());
}

/**
 * Wspólna ścieżka dla wszystkich źródeł (aparat, galeria, schowek, wklejanie, drag&drop):
 * walidacja → limit pikseli → dekodowanie z korektą EXIF → zmniejszenie do ≤ 2048 px.
 */
export async function ingestImage(blob: Blob, source: ImageSource): Promise<ScanImage> {
  const type = blob.type.toLowerCase();
  if (type && !type.startsWith('image/')) throw new ImageError('not-image');
  const heic = /heic|heif/.test(type);

  const probed = probeImageSize(await readHead(blob));
  if (probed && probed.width * probed.height > MAX_PIXELS) throw new ImageError('too-large');

  let bitmap: ImageBitmap;
  try {
    const big =
      probed && type === 'image/png' && probed.width * probed.height > RESIZE_AT_DECODE_PIXELS;
    bitmap = await decodeBitmap(blob, big ? fitWithin(probed.width, probed.height) : undefined);
  } catch {
    throw new ImageError(heic ? 'heic' : type ? 'decode' : 'not-image');
  }

  try {
    if (bitmap.width * bitmap.height > MAX_PIXELS) throw new ImageError('too-large');
    const originalLong = probed
      ? Math.max(probed.width, probed.height)
      : Math.max(bitmap.width, bitmap.height);
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = makeCanvas(width, height);
    ctx2d(canvas).drawImage(bitmap, 0, 0, width, height);
    const working = await canvasToBlob(canvas, 'image/jpeg', WORKING_QUALITY);
    return {
      id: newId(),
      working,
      url: URL.createObjectURL(working),
      width,
      height,
      rotation: 0,
      crop: null,
      source,
      small: originalLong < SMALL_SIDE,
    };
  } finally {
    bitmap.close();
  }
}

export function revokeScanImage(img: ScanImage) {
  URL.revokeObjectURL(img.url);
}

export interface RenderedImage {
  blob: Blob;
  base64: string;
  width: number;
  height: number;
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(new ImageError('decode'));
    r.readAsDataURL(blob);
  });
}

/** Końcowy obraz do wysłania: obrót + kadr, ≤ 2048 px, JPEG 0,85 → base64 (plan 4.3 pkt 5). */
export async function renderForUpload(img: ScanImage): Promise<RenderedImage> {
  const bitmap = await createImageBitmap(img.working);
  try {
    const rot = rotatedSize(bitmap.width, bitmap.height, img.rotation);
    const crop = img.crop ? clampCrop(img.crop) : { x: 0, y: 0, w: 1, h: 1 };
    // 1. obrót na pełnym obrazie
    const rotated = makeCanvas(rot.width, rot.height);
    const rc = ctx2d(rotated);
    rc.translate(rot.width / 2, rot.height / 2);
    rc.rotate((img.rotation * Math.PI) / 180);
    rc.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    // 2. kadr i ograniczenie rozmiaru
    const sx = Math.round(crop.x * rot.width);
    const sy = Math.round(crop.y * rot.height);
    const sw = Math.max(1, Math.round(crop.w * rot.width));
    const sh = Math.max(1, Math.round(crop.h * rot.height));
    const out = fitWithin(sw, sh);
    const canvas = makeCanvas(out.width, out.height);
    ctx2d(canvas).drawImage(
      rotated as CanvasImageSource,
      sx,
      sy,
      sw,
      sh,
      0,
      0,
      out.width,
      out.height,
    );
    const blob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY);
    return { blob, base64: await blobToBase64(blob), width: out.width, height: out.height };
  } finally {
    bitmap.close();
  }
}

/** Podgląd po obrocie (bez kadru), do wyświetlenia w arkuszu skanowania. */
export async function renderRotated(img: ScanImage, maxSide = 1400): Promise<Blob> {
  const bitmap = await createImageBitmap(img.working);
  try {
    const rot = rotatedSize(bitmap.width, bitmap.height, img.rotation);
    const out = fitWithin(rot.width, rot.height, maxSide);
    const canvas = makeCanvas(out.width, out.height);
    const c = ctx2d(canvas);
    c.translate(out.width / 2, out.height / 2);
    c.rotate((img.rotation * Math.PI) / 180);
    const w = rot.width === bitmap.width ? out.width : out.height;
    const hh = rot.width === bitmap.width ? out.height : out.width;
    c.drawImage(bitmap, -w / 2, -hh / 2, w, hh);
    return await canvasToBlob(canvas, 'image/jpeg', 0.8);
  } finally {
    bitmap.close();
  }
}

/** Miniatura JPEG ~200 px jako data URL (prostsze niż Blob w IndexedDB na iOS — plan 5). */
export async function makeThumbnail(blob: Blob, size = 200): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, size);
    const canvas = makeCanvas(width, height);
    ctx2d(canvas).drawImage(bitmap, 0, 0, width, height);
    const out = await canvasToBlob(canvas, 'image/jpeg', 0.7);
    const b64 = await blobToBase64(out);
    return `data:image/jpeg;base64,${b64}`;
  } finally {
    bitmap.close();
  }
}
