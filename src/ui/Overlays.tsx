import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useDragControls } from 'motion/react';
import { haptic, SPRING_SHEET, useBackClose, useKeyboardInset } from './hooks';
import styles from './Overlays.module.css';

/* ---------- Sheet ---------- */

export type Detent = 'medium' | 'large';

export function Sheet({
  open,
  onClose,
  title,
  detent = 'medium',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  detent?: Detent;
  children: ReactNode;
}) {
  const [current, setCurrent] = useState<Detent>(detent);
  const controls = useDragControls();
  const kb = useKeyboardInset(open); // P-05
  useBackClose(open, onClose); // P-15

  // Tło strony lekko pomniejszone
  useEffect(() => {
    if (!open) return;
    const root = document.getElementById('root');
    root?.setAttribute('data-sheet-open', '');
    return () => root?.removeAttribute('data-sheet-open');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence onExitComplete={() => setCurrent(detent)}>
      {open && (
        <div className={styles.layer}>
          <motion.div
            className={styles.scrim}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            data-testid="sheet-scrim"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={`${styles.sheet} glass`}
            style={{
              height: current === 'large' ? 'calc(100dvh - var(--sat) - 12px)' : '55dvh',
              bottom: kb,
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={SPRING_SHEET}
            drag="y"
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.1, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) onClose();
              else if (info.offset.y < -60 && current === 'medium') setCurrent('large');
              else if (info.offset.y > 60 && current === 'large') setCurrent('medium');
            }}
          >
            <div
              className={styles.grabberZone}
              onPointerDown={(e) => controls.start(e)}
              style={{ touchAction: 'none' }}
            >
              <span className={styles.grabber} />
            </div>
            {title && <h2 className={styles.sheetTitle}>{title}</h2>}
            <div className={styles.sheetBody}>{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ---------- ContextMenu / Menu ---------- */

export interface MenuItem {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

function MenuPopover({
  items,
  anchor,
  onClose,
}: {
  items: MenuItem[];
  anchor: { x: number; y: number };
  onClose: () => void;
}) {
  useBackClose(true, onClose);
  const width = 240;
  const left = Math.min(Math.max(8, anchor.x - width / 2), window.innerWidth - width - 8);
  const top = Math.min(anchor.y, window.innerHeight - items.length * 48 - 24);
  return createPortal(
    <div className={styles.layer}>
      <div className={`${styles.scrim} ${styles.blur}`} onClick={onClose} />
      <motion.div
        role="menu"
        className={`${styles.menu} glass`}
        style={{ left, top, width }}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={SPRING_SHEET}
      >
        {items.map((it) => (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            className={`${styles.menuItem} ${it.destructive ? styles.destructive : ''}`}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
          >
            {it.label}
          </button>
        ))}
      </motion.div>
    </div>,
    document.body,
  );
}

/** Long-press 450 ms (P-06: bez systemowego menu/zaznaczenia). */
export function ContextMenu({
  items,
  children,
  display,
}: {
  items: MenuItem[];
  children: ReactNode;
  /** np. 'contents', gdy opakowanie nie może zaburzać układu siatki */
  display?: 'contents';
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const start = useRef({ x: 0, y: 0 });
  const close = useCallback(() => setAnchor(null), []);

  const cancel = () => window.clearTimeout(timer.current);
  useEffect(() => cancel, []);

  return (
    <div
      className={styles.longPress}
      style={display ? { display } : undefined}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, y: e.clientY };
        cancel();
        timer.current = window.setTimeout(() => {
          haptic();
          setAnchor({ x: start.current.x, y: start.current.y });
        }, 450);
      }}
      onPointerMove={(e) => {
        if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
    >
      {children}
      {anchor && <MenuPopover items={items} anchor={anchor} onClose={close} />}
    </div>
  );
}

/** Menu otwierane tapnięciem (np. przycisk „+”). */
export function MenuButton({
  items,
  children,
  label,
  className,
}: {
  items: MenuItem[];
  children: ReactNode;
  label: string;
  className?: string;
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        className={`${className ?? ''} pressable`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor({ x: r.left + r.width / 2, y: r.top - items.length * 48 - 16 });
        }}
      >
        {children}
      </button>
      {anchor && <MenuPopover items={items} anchor={anchor} onClose={close} />}
    </>
  );
}

/* ---------- Alert / ActionSheet ---------- */

export interface DialogAction {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

function useDialogShell(open: boolean, onClose: () => void) {
  useBackClose(open, onClose);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
}

export function Alert({
  open,
  title,
  message,
  actions,
  onClose,
}: {
  open: boolean;
  title: string;
  message?: string;
  actions: DialogAction[];
  onClose: () => void;
}) {
  useDialogShell(open, onClose);
  const busy = useRef(false);
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className={`${styles.layer} ${styles.center}`}>
          <motion.div
            className={styles.scrim}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-label={title}
            className={`${styles.alert} glass`}
            initial={{ opacity: 0, scale: 1.1 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={SPRING_SHEET}
          >
            <h2 className={styles.alertTitle}>{title}</h2>
            {message && <p className={styles.alertMessage}>{message}</p>}
            <div className={styles.alertActions}>
              {actions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className={`${styles.alertBtn} ${a.destructive ? styles.destructive : ''}`}
                  onClick={() => {
                    if (busy.current) return;
                    busy.current = true;
                    setTimeout(() => (busy.current = false), 400);
                    onClose();
                    a.onSelect();
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function ActionSheet({
  open,
  title,
  actions,
  cancelLabel = 'Anuluj',
  onClose,
}: {
  open: boolean;
  title?: string;
  actions: DialogAction[];
  cancelLabel?: string;
  onClose: () => void;
}) {
  useDialogShell(open, onClose);
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className={styles.layer}>
          <motion.div
            className={styles.scrim}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title ?? 'Wybierz akcję'}
            className={styles.actionSheet}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={SPRING_SHEET}
          >
            <div className={`${styles.asGroup} glass`}>
              {title && <p className={styles.asTitle}>{title}</p>}
              {actions.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className={`${styles.asBtn} ${a.destructive ? styles.destructive : ''}`}
                  onClick={() => {
                    onClose();
                    a.onSelect();
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <button type="button" className={`${styles.asCancel} glass`} onClick={onClose}>
              {cancelLabel}
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ---------- Toast z „Cofnij” ---------- */

interface ToastItem {
  id: number;
  message: string;
  undo?: () => void;
}
const ToastContext = createContext<(message: string, undo?: () => void) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0);

  const show = useCallback((message: string, undo?: () => void) => {
    window.clearTimeout(timer.current);
    const item = { id: ++seq.current, message, undo };
    setToast(item);
    timer.current = window.setTimeout(() => setToast(null), 5000);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {createPortal(
        <div className={styles.toastWrap} aria-live="polite">
          <AnimatePresence>
            {toast && (
              <motion.div
                key={toast.id}
                role="status"
                className={`${styles.toast} glass`}
                initial={{ opacity: 0, y: 24, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12 }}
                transition={SPRING_SHEET}
              >
                <span>{toast.message}</span>
                {toast.undo && (
                  <button
                    type="button"
                    className={styles.toastUndo}
                    onClick={() => {
                      const undo = toast.undo;
                      setToast(null);
                      undo?.();
                    }}
                  >
                    Cofnij
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
