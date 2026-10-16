import { useEffect } from 'react';
import type { Settings } from '../domain/types';

const LIGHT = '#f2f2f7';
const DARK = '#000000';

/** Ustawia data-theme i kolor paska przeglądarki/statusu (theme-color aktualizowany dynamicznie). */
export function applyTheme(theme: Settings['theme']) {
  const root = document.documentElement;
  const light = document.getElementById('tc-light');
  const dark = document.getElementById('tc-dark');
  if (theme === 'system') {
    root.removeAttribute('data-theme');
    light?.setAttribute('content', LIGHT);
    light?.setAttribute('media', '(prefers-color-scheme: light)');
    dark?.setAttribute('content', DARK);
    dark?.setAttribute('media', '(prefers-color-scheme: dark)');
    return;
  }
  root.setAttribute('data-theme', theme);
  const color = theme === 'dark' ? DARK : LIGHT;
  for (const m of [light, dark]) {
    m?.setAttribute('content', color);
    m?.removeAttribute('media');
  }
}

export function useTheme(theme: Settings['theme'] | undefined) {
  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);
}
