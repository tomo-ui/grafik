import { useEffect, useState } from 'react';
import { todayISO } from '../domain/dates';

/**
 * „Teraz” odświeżane co 30 s i po powrocie aplikacji z tła (visibilitychange) —
 * aplikacja może być otwarta przez północ (plan 1.4).
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = window.setInterval(tick, 30_000);
    const onVis = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return now;
}

export function useToday(): string {
  return todayISO(useNow());
}

/** Systemowy większy tekst (rem) — siatka ustępuje wtedy miejsca liście dni (plan 11). */
export function useLargeText(): boolean {
  const [large, setLarge] = useState(() => readLarge());
  useEffect(() => {
    const check = () => setLarge(readLarge());
    window.addEventListener('resize', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('resize', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return large;
}

function readLarge(): boolean {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) >= 20;
}
