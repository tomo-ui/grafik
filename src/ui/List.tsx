import { useRef, useState, type ReactNode } from 'react';
import { animate, motion, useMotionValue } from 'motion/react';
import { ChevronRight } from 'lucide-react';
import { haptic, SPRING_BUTTON } from './hooks';
import styles from './List.module.css';

export function GroupedList({
  header,
  footer,
  children,
}: {
  header?: string;
  footer?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      {header && <h2 className={styles.header}>{header}</h2>}
      <div className={styles.group}>{children}</div>
      {footer && <p className={styles.footer}>{footer}</p>}
    </section>
  );
}

export function ListRow({
  title,
  subtitle,
  value,
  leading,
  trailing,
  chevron = false,
  last = false,
  onClick,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  /** ostatni wiersz grupy (gdy wiersze są opakowane i CSS nie zgadnie sam) */
  last?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      {leading && <span className={styles.leading}>{leading}</span>}
      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </span>
      {value && <span className={styles.value}>{value}</span>}
      {trailing}
      {chevron && <ChevronRight size={18} strokeWidth={2.25} className={styles.chevron} />}
    </>
  );
  // separator zaczyna się od lewej krawędzi tekstu (--inset)
  const inset = leading ? 'calc(1rem + 40px + 0.75rem)' : '1rem';
  return onClick ? (
    <button
      type="button"
      className={`${styles.row} ${styles.rowButton} ${last ? styles.rowLast : ''}`}
      style={{ ['--inset' as string]: inset }}
      onClick={onClick}
    >
      {body}
    </button>
  ) : (
    <div
      className={`${styles.row} ${last ? styles.rowLast : ''}`}
      style={{ ['--inset' as string]: inset }}
    >
      {body}
    </div>
  );
}

/** Wiersz z etykietą i polem tekstowym (>= 16 px, P-13). */
export function TextRow({
  label,
  value,
  onChange,
  placeholder,
  autoCapitalize = 'words',
  onEnter,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoCapitalize?: 'words' | 'none' | 'sentences';
  onEnter?: () => void;
  autoFocus?: boolean;
}) {
  return (
    <label className={styles.inputRow}>
      <span>{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        autoCapitalize={autoCapitalize}
        autoCorrect="off"
        autoFocus={autoFocus}
        enterKeyHint={onEnter ? 'done' : undefined}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onEnter?.();
        }}
      />
    </label>
  );
}

export interface SwipeAction {
  label: string;
  onAction: () => void;
  color: 'red' | 'blue';
}

const ACTION_W = 80;

/**
 * Przesunięcie w lewo odsłania akcje; pełne przeciągnięcie wykonuje ostatnią (usunięcie).
 * P-07: kierunek rozpoznawany po 10 px ruchu (dragDirectionLock), przewijanie pionowe zostaje natywne.
 */
export function SwipeActions({
  actions,
  children,
}: {
  actions: SwipeAction[];
  children: ReactNode;
}) {
  const x = useMotionValue(0);
  const [open, setOpen] = useState(false);
  const width = actions.length * ACTION_W;
  const last = actions[actions.length - 1];
  const busy = useRef(false);
  const downAt = useRef({ x: 0, y: 0 });
  const startX = useRef(0);

  const settle = (to: number) => {
    setOpen(to !== 0);
    void animate(x, to, SPRING_BUTTON);
  };

  const run = (a: SwipeAction) => {
    if (busy.current) return; // brak podwójnych akcji
    busy.current = true;
    haptic();
    settle(0);
    a.onAction();
    setTimeout(() => (busy.current = false), 400);
  };

  return (
    <div className={styles.swipe}>
      <div className={styles.swipeActions} style={{ width: width }}>
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            tabIndex={open ? 0 : -1}
            aria-hidden={!open}
            className={`${styles.swipeBtn} ${a.color === 'red' ? styles.swipeRed : styles.swipeBlue}`}
            onClick={() => run(a)}
          >
            {a.label}
          </button>
        ))}
      </div>
      <motion.div
        className={styles.swipeContent}
        style={{ x, touchAction: 'pan-y' }}
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: -width * 2.2, right: 0 }}
        dragElastic={0.05}
        // własna animacja domknięcia (settle) — bez bezwładności Motion, która by ją nadpisała
        dragMomentum={false}
        // przeciągnięcie albo otwarte akcje nie mogą wywołać „tapnięcia” w wierszu pod spodem
        // „click” po przeciągnięciu blokujemy na podstawie ruchu wskaźnika (a nie zdarzeń Motion,
        // które w klatkach animacji mogą przyjść później niż click); otwarte akcje: tap tylko zamyka
        onPointerDownCapture={(e) => {
          downAt.current = { x: e.clientX, y: e.clientY };
        }}
        onClickCapture={(e) => {
          const moved = Math.hypot(e.clientX - downAt.current.x, e.clientY - downAt.current.y) > 8;
          if (moved || open) {
            e.stopPropagation();
            e.preventDefault();
            if (open && !moved) settle(0);
          }
        }}
        onDragStart={() => {
          startX.current = x.get();
        }}
        onDragEnd={(_, info) => {
          // decyzja z przesunięcia wskaźnika, nie z x.get() (x nadąża dopiero w kolejnej klatce)
          const cur = Math.min(0, Math.max(-width * 2.2, startX.current + info.offset.x));
          if (last && cur < -width * 1.6) return run(last);
          settle(cur < -width / 2 || info.velocity.x < -500 ? -width : 0);
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}
