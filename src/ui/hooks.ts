import { useEffect, useRef, useState } from 'react';

interface OverlayEntry {
  close: () => void;
  pushed: boolean;
  gone: boolean;
  poppedByUser: boolean;
}
const overlayStack: OverlayEntry[] = [];
let pendingBacks = 0; // history.back() wywołane przez nas — ich popstate ignorujemy
const waiters: (() => void)[] = [];

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (pendingBacks > 0) {
      pendingBacks--;
      if (pendingBacks === 0) waiters.splice(0).forEach((f) => f());
      return;
    }
    const top = overlayStack.pop();
    if (top) {
      top.poppedByUser = true;
      top.close();
    }
  });
}

/**
 * P-15: otwarty sheet/menu dodaje wpis do historii, a systemowe „wstecz” (Android)
 * zamyka go zamiast opuszczać aplikację. Jeden globalny listener + stos nakładek;
 * pushState czeka, aż skończą się nasze własne history.back() (brak wyścigów).
 */
export function useBackClose(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const entry: OverlayEntry = {
      close: () => closeRef.current(),
      pushed: false,
      gone: false,
      poppedByUser: false,
    };
    const push = () => {
      if (entry.gone) return;
      window.history.pushState({ overlay: true }, '');
      entry.pushed = true;
      overlayStack.push(entry);
    };
    if (pendingBacks > 0) waiters.push(push);
    else push();
    return () => {
      entry.gone = true;
      const i = overlayStack.indexOf(entry);
      if (i >= 0) overlayStack.splice(i, 1);
      if (entry.pushed && !entry.poppedByUser) {
        pendingBacks++;
        window.history.back();
      }
    };
  }, [open]);
}

/** P-05: wysokość klawiatury ekranowej (iOS nie zmniejsza layout viewportu). */
export function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) return;
    const update = () =>
      setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      setInset(0);
    };
  }, [active]);
  return inset;
}

/** Android: krótka wibracja; iOS nie ma API — brak błędów. */
export function haptic(ms = 10) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* ignoruj */
  }
}

export const SPRING_BUTTON = { type: 'spring', stiffness: 400, damping: 32 } as const;
export const SPRING_SHEET = { type: 'spring', stiffness: 300, damping: 30 } as const;
