import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

/** Separate key on purpose — never collides with the progress store `ai-intro-quiz-v1`. */
export const THEME_STORAGE_KEY = 'ai-intro-quiz-theme';

function readStoredTheme(): ThemeMode {
  try {
    if (typeof window === 'undefined') return 'light';
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else {
    root.removeAttribute('data-theme');
  }
  root.style.colorScheme = theme;
}

/**
 * Light (`material-review`) is the default. Only an explicit user toggle writes
 * the preference, so fresh sessions — including every E2E context — stay light.
 */
export function useTheme(): { theme: ThemeMode; toggleTheme: () => void } {
  const [theme, setTheme] = useState<ThemeMode>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: ThemeMode = prev === 'dark' ? 'light' : 'dark';
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Storage may be unavailable (private mode / quota) — theme still applies for this visit.
      }
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
