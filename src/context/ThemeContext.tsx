import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ThemeMode = ThemePreference;
export type ResolvedTheme = 'light' | 'dark';

/** Separate key on purpose — never collides with the progress store `ai-intro-quiz-v1`. */
export const THEME_STORAGE_KEY = 'ai-intro-quiz-theme';

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (next: ThemePreference) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function normalizePreference(raw: string | null | undefined): ThemePreference {
  if (raw === 'light' || raw === 'dark' || raw === 'system') {
    return raw;
  }
  return 'system';
}

function readStoredTheme(): ThemePreference {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return 'system';
    return normalizePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

function persistThemePreference(next: ThemePreference): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Storage may be unavailable (private mode / quota) — theme still applies for this visit.
  }
}

function getSystemPrefersDark(): boolean {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(DARK_MEDIA_QUERY).matches;
  } catch {
    return false;
  }
}

function resolveThemePreference(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') {
    return preference;
  }
  return systemPrefersDark ? 'dark' : 'light';
}

function applyThemeToDocument(preference: ThemePreference, resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  root.setAttribute('data-theme-mode', preference);
  root.style.colorScheme = resolved;
}

function useThemeState(disabled = false): ThemeContextValue {
  const [theme, setThemeState] = useState<ThemePreference>(() =>
    disabled ? 'system' : readStoredTheme(),
  );
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() =>
    disabled ? false : getSystemPrefersDark(),
  );

  const resolvedTheme = resolveThemePreference(theme, systemPrefersDark);

  useEffect(() => {
    if (disabled) return;
    applyThemeToDocument(theme, resolvedTheme);
  }, [disabled, theme, resolvedTheme]);

  useEffect(() => {
    if (disabled || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    try {
      const mql = window.matchMedia(DARK_MEDIA_QUERY);
      if (!mql) return;
      setSystemPrefersDark(Boolean(mql.matches));

      const handleChange = (event: MediaQueryListEvent) => {
        setSystemPrefersDark(Boolean(event.matches));
      };

      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', handleChange);
        return () => {
          try {
            mql.removeEventListener('change', handleChange);
          } catch {
            // Ignore cleanup errors on restricted MediaQueryList implementations.
          }
        };
      }

      if (typeof mql.addListener === 'function') {
        mql.addListener(handleChange);
        return () => {
          try {
            mql.removeListener(handleChange);
          } catch {
            // Ignore cleanup errors on restricted MediaQueryList implementations.
          }
        };
      }
    } catch {
      // matchMedia may throw in restricted contexts — fall back safely.
    }
  }, [disabled]);

  useEffect(() => {
    if (disabled || typeof window === 'undefined') return;

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      setThemeState(normalizePreference(event.newValue));
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [disabled]);

  const setTheme = useCallback(
    (next: ThemePreference) => {
      const normalized = normalizePreference(next);
      if (!disabled) {
        persistThemePreference(normalized);
      }
      setThemeState(normalized);
    },
    [disabled],
  );

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const currentResolved = resolveThemePreference(
        prev,
        prev === 'system' ? getSystemPrefersDark() : systemPrefersDark,
      );
      const next: ThemePreference = currentResolved === 'dark' ? 'light' : 'dark';
      if (!disabled) {
        persistThemePreference(next);
      }
      return next;
    });
  }, [disabled, systemPrefersDark]);

  return useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      toggleTheme,
    }),
    [theme, resolvedTheme, setTheme, toggleTheme],
  );
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const value = useThemeState(false);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  const fallback = useThemeState(ctx !== null);
  return ctx ?? fallback;
}
