import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/* ---------------------------------------------------------------- Modal */

/** Okno dialogowe oparte na natywnym <dialog> (pułapka fokusu i Esc zapewnia przeglądarka). */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  label,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  label?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal${wide ? ' wide' : ''}`}
      aria-label={label ?? title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose(); // klik w tło
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </dialog>
  );
}

/* ------------------------------------------------------------- Powiadomienia */

interface ToastItem {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}
type ToastFn = (text: string, action?: ToastItem['action']) => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const toast = useCallback<ToastFn>((text, action) => {
    const id = ++seq.current;
    setItems((l) => [...l.slice(-3), { id, text, action }]);
    window.setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), action ? 8000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast">
            <span>{t.text}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action!.run();
                  setItems((l) => l.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* -------------------------------------------------------------- Potwierdzenia */

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** użytkownik musi wpisać ten tekst (operacje nieodwracalne) */
  requireText?: string;
}
type ConfirmFn = (o: ConfirmOptions) => Promise<boolean>;
const ConfirmCtx = createContext<ConfirmFn>(() => Promise.resolve(false));
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ o: ConfirmOptions; done: (v: boolean) => void } | null>(
    null,
  );
  const [typed, setTyped] = useState('');
  const confirm = useCallback<ConfirmFn>(
    (o) =>
      new Promise((resolve) => {
        setTyped('');
        setState({ o, done: resolve });
      }),
    [],
  );
  const close = (v: boolean) => {
    state?.done(v);
    setState(null);
  };
  const needs = state?.o.requireText;
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <Modal
          title={state.o.title}
          onClose={() => close(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => close(false)}>
                Anuluj
              </button>
              <button
                type="button"
                className={`btn ${state.o.danger ? 'danger' : 'primary'}`}
                disabled={!!needs && typed !== needs}
                onClick={() => close(true)}
              >
                {state.o.confirmLabel ?? 'Potwierdź'}
              </button>
            </>
          }
        >
          {state.o.message && <div>{state.o.message}</div>}
          {needs && (
            <label className="field">
              <span>
                Aby potwierdzić, wpisz: <b>{needs}</b>
              </span>
              <input
                className="input"
                value={typed}
                autoFocus
                onChange={(e) => setTyped(e.target.value)}
                aria-label="Tekst potwierdzenia"
              />
            </label>
          )}
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}

/* ------------------------------------------------------------- Menu kontekstowe */

export interface MenuItem {
  label: string;
  onSelect: () => void;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    const el = ref.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setPos({
        x: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
        y: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
      });
      el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const btns = [
          ...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
        ];
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
      }
    };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
    };
  }, [x, y, onClose]);
  return (
    <div ref={ref} className="menu" role="menu" style={{ left: pos.x, top: pos.y }}>
      {items.map((it, i) => (
        <div key={i}>
          {it.separatorBefore && <hr />}
          <button
            type="button"
            role="menuitem"
            className={it.danger ? 'danger' : ''}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
          >
            {it.label}
            {it.shortcut && <span className="kbd">{it.shortcut}</span>}
          </button>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------------- Drobne */

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function Seg<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Zapis pobieranego pliku (Blob) z natychmiastowym zwolnieniem URL-a. */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function useStable<T>(v: T): T {
  return useMemo(() => v, [v]);
}
