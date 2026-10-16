import { useEffect, useRef } from 'react';

const MAX_AGE_MS = 24 * 3600 * 1000;

/** Szkic formularza (P-12): iOS potrafi ubić PWA w tle, więc zapisujemy stan przy ukryciu aplikacji. */
export function loadDraft<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; value: T };
    if (Date.now() - parsed.at > MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

export function clearDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* tryb prywatny / brak miejsca — szkic to tylko udogodnienie */
  }
}

export function saveDraft<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), value }));
  } catch {
    /* jw. */
  }
}

/** Zapisuje `value` przy visibilitychange: hidden / pagehide, dopóki `active`. */
export function useDraftOnHide<T>(key: string, value: T, active: boolean) {
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  });
  useEffect(() => {
    if (!active) return;
    const flush = () => saveDraft(key, latest.current);
    const onVis = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', flush);
    };
  }, [key, active]);
}
