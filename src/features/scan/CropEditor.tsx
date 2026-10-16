import { useEffect, useRef, useState } from 'react';
import { clampCrop, renderRotated, type Crop, type ScanImage } from '../../ai/image';
import styles from './Scan.module.css';

type Handle = 'tl' | 'tr' | 'bl' | 'br';

/**
 * Podgląd zdjęcia z obrotem i prostym kadrowaniem (przeciąganie narożników).
 * Kadr trzymany jako ułamki obrazu po obrocie (plan 4.3 pkt 4).
 */
export function CropEditor({
  image,
  cropping,
  onCrop,
}: {
  image: ScanImage;
  cropping: boolean;
  onCrop: (c: Crop | null) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ handle: Handle; start: Crop } | null>(null);

  // podgląd po obrocie; poprzedni URL zwalniany (brak wycieków)
  useEffect(() => {
    let cancelled = false;
    let current: string | null = null;
    renderRotated(image).then((b) => {
      if (cancelled) return;
      current = URL.createObjectURL(b);
      setUrl(current);
    });
    return () => {
      cancelled = true;
      if (current) URL.revokeObjectURL(current);
    };
  }, [image.working, image.rotation]); // eslint-disable-line react-hooks/exhaustive-deps

  const crop = image.crop ?? { x: 0, y: 0, w: 1, h: 1 };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = box.current;
    if (!d || !el) return;
    const r = el.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const s = d.start;
    let left = s.x;
    let top = s.y;
    let right = s.x + s.w;
    let bottom = s.y + s.h;
    if (d.handle === 'tl' || d.handle === 'bl') left = Math.min(px, right - 0.1);
    if (d.handle === 'tr' || d.handle === 'br') right = Math.max(px, left + 0.1);
    if (d.handle === 'tl' || d.handle === 'tr') top = Math.min(py, bottom - 0.1);
    if (d.handle === 'bl' || d.handle === 'br') bottom = Math.max(py, top + 0.1);
    onCrop(clampCrop({ x: left, y: top, w: right - left, h: bottom - top }));
  };

  const handle = (h: Handle) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = { handle: h, start: crop };
    },
    onPointerMove: onMove,
    onPointerUp: () => (drag.current = null),
    onPointerCancel: () => (drag.current = null),
  });

  const pos: Record<Handle, React.CSSProperties> = {
    tl: { left: `${crop.x * 100}%`, top: `${crop.y * 100}%` },
    tr: { left: `${(crop.x + crop.w) * 100}%`, top: `${crop.y * 100}%` },
    bl: { left: `${crop.x * 100}%`, top: `${(crop.y + crop.h) * 100}%` },
    br: { left: `${(crop.x + crop.w) * 100}%`, top: `${(crop.y + crop.h) * 100}%` },
  };

  return (
    <div className={styles.previewWrap}>
      <div className={styles.previewBox} ref={box} data-testid="preview-box">
        {url ? (
          <img
            src={url}
            alt="Podgląd zdjęcia grafiku"
            className={styles.previewImg}
            draggable={false}
          />
        ) : (
          <div className={styles.previewPlaceholder} />
        )}
        {cropping && (
          <>
            <div className={styles.cropClip} aria-hidden="true">
              <div
                className={styles.cropRect}
                data-testid="crop-rect"
                style={{
                  left: `${crop.x * 100}%`,
                  top: `${crop.y * 100}%`,
                  width: `${crop.w * 100}%`,
                  height: `${crop.h * 100}%`,
                }}
              />
            </div>
            {(['tl', 'tr', 'bl', 'br'] as Handle[]).map((h) => (
              <span
                key={h}
                role="slider"
                aria-label={`Narożnik kadru: ${{ tl: 'lewy górny', tr: 'prawy górny', bl: 'lewy dolny', br: 'prawy dolny' }[h]}`}
                aria-valuenow={0}
                tabIndex={0}
                data-testid={`crop-${h}`}
                className={styles.cropHandle}
                style={pos[h]}
                {...handle(h)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
