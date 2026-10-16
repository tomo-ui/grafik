import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useBackClose } from '../../ui';
import styles from './Scan.module.css';

/** Pełny ekran z powiększaniem dwoma palcami (pinch), przeciąganiem i przyciskami +/−. */
export function ImageViewer({ src, onClose }: { src: string; onClose: () => void }) {
  useBackClose(true, onClose);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const pan = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const clamp = (v: number) => Math.min(5, Math.max(1, v));
  const set = (v: number) => {
    const s = clamp(v);
    setScale(s);
    if (s === 1) setPos({ x: 0, y: 0 });
  };

  return (
    <div
      className={styles.viewer}
      role="dialog"
      aria-modal="true"
      aria-label="Zdjęcie grafiku"
      data-testid="image-viewer"
      onPointerDown={(e) => {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()] as [
            { x: number; y: number },
            { x: number; y: number },
          ];
          pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale };
          pan.current = null;
        } else {
          pan.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
        }
      }}
      onPointerMove={(e) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2 && pinch.current) {
          const [a, b] = [...pointers.current.values()] as [
            { x: number; y: number },
            { x: number; y: number },
          ];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          set(pinch.current.scale * (d / pinch.current.dist));
        } else if (pan.current && scale > 1) {
          setPos({
            x: pan.current.px + e.clientX - pan.current.x,
            y: pan.current.py + e.clientY - pan.current.y,
          });
        }
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) pinch.current = null;
        pan.current = null;
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        pinch.current = null;
        pan.current = null;
      }}
      onDoubleClick={() => set(scale > 1 ? 1 : 2.5)}
    >
      <button
        type="button"
        className={styles.viewerClose}
        aria-label="Zamknij podgląd"
        onClick={onClose}
      >
        <X size={26} />
      </button>
      <img
        src={src}
        alt="Zdjęcie grafiku"
        draggable={false}
        style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})` }}
      />
      <div className={styles.viewerZoom}>
        <button type="button" aria-label="Pomniejsz" onClick={() => set(scale - 0.5)}>
          −
        </button>
        <button type="button" aria-label="Powiększ" onClick={() => set(scale + 0.5)}>
          +
        </button>
      </div>
    </div>
  );
}
