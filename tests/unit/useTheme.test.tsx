import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopNav } from '../../src/components/TopNav';
import {
  THEME_STORAGE_KEY,
  ThemeProvider,
  useTheme,
  type ThemeContextValue,
} from '../../src/hooks/useTheme';

interface MatchMediaMock {
  matches: boolean;
  dispatch: (matches: boolean) => void;
  listenerCount: () => number;
}

function installMatchMediaMock(initialDark = false): MatchMediaMock {
  let currentMatches = initialDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  const mql = {
    get matches() {
      return currentMatches;
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn((event: string, cb: (e: MediaQueryListEvent) => void) => {
      if (event === 'change') {
        listeners.add(cb);
      }
    }),
    removeEventListener: vi.fn((event: string, cb: (e: MediaQueryListEvent) => void) => {
      if (event === 'change') {
        listeners.delete(cb);
      }
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };

  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql),
  );

  return {
    get matches() {
      return currentMatches;
    },
    dispatch(nextDark: boolean) {
      currentMatches = nextDark;
      const evt = { matches: nextDark, media: '(prefers-color-scheme: dark)' } as MediaQueryListEvent;
      for (const cb of listeners) {
        cb(evt);
      }
    },
    listenerCount: () => listeners.size,
  };
}

describe('useTheme & ThemeProvider', () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-mode');
    document.documentElement.style.colorScheme = '';
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mountProbe(onValue: (val: ThemeContextValue) => void) {
    function Probe() {
      const value = useTheme();
      onValue(value);
      return (
        <div
          data-testid="probe"
          data-pref={value.theme}
          data-resolved={value.resolvedTheme}
        />
      );
    }

    root = createRoot(container);
    act(() => {
      root!.render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      );
    });
  }

  it('defaults to system mode and resolves to light when prefers-color-scheme is light', () => {
    installMatchMediaMock(false);
    let latest!: ThemeContextValue;
    mountProbe((val) => {
      latest = val;
    });

    expect(latest.theme).toBe('system');
    expect(latest.resolvedTheme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme-mode')).toBe('system');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('resolves system mode to dark when prefers-color-scheme is dark', () => {
    installMatchMediaMock(true);
    let latest!: ThemeContextValue;
    mountProbe((val) => {
      latest = val;
    });

    expect(latest.theme).toBe('system');
    expect(latest.resolvedTheme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme-mode')).toBe('system');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('persists light/dark/system changes to localStorage and syncs html attributes', () => {
    installMatchMediaMock(false);
    let latest!: ThemeContextValue;
    mountProbe((val) => {
      latest = val;
    });

    act(() => {
      latest.setTheme('dark');
    });
    expect(latest.theme).toBe('dark');
    expect(latest.resolvedTheme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme-mode')).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');

    act(() => {
      latest.setTheme('light');
    });
    expect(latest.theme).toBe('light');
    expect(latest.resolvedTheme).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme-mode')).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');

    act(() => {
      latest.setTheme('system');
    });
    expect(latest.theme).toBe('system');
    expect(latest.resolvedTheme).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
    expect(document.documentElement.getAttribute('data-theme-mode')).toBe('system');
  });

  it('responds to live matchMedia changes only when in system mode', () => {
    const mm = installMatchMediaMock(false);
    let latest!: ThemeContextValue;
    mountProbe((val) => {
      latest = val;
    });

    expect(mm.listenerCount()).toBe(1);
    expect(latest.resolvedTheme).toBe('light');

    act(() => {
      mm.dispatch(true);
    });
    expect(latest.resolvedTheme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    // Manual override ignores OS media changes until returning to system
    act(() => {
      latest.setTheme('light');
    });
    expect(latest.resolvedTheme).toBe('light');

    act(() => {
      mm.dispatch(false);
    });
    expect(latest.resolvedTheme).toBe('light');

    act(() => {
      mm.dispatch(true);
    });
    expect(latest.resolvedTheme).toBe('light');

    // Switching back to system picks up the latest OS preference immediately
    act(() => {
      latest.setTheme('system');
    });
    expect(latest.resolvedTheme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('falls back gracefully on invalid localStorage values or throwing Storage APIs', () => {
    installMatchMediaMock(false);
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');

    let latest!: ThemeContextValue;
    mountProbe((val) => {
      latest = val;
    });
    expect(latest.theme).toBe('system');
    expect(latest.resolvedTheme).toBe('light');

    act(() => {
      root?.unmount();
    });
    root = null;

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    mountProbe((val) => {
      latest = val;
    });
    expect(latest.theme).toBe('system');
    act(() => {
      latest.setTheme('dark');
    });
    expect(latest.theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('renders TopNav 3-state switcher and updates aria-pressed, storage, and html data-theme', () => {
    installMatchMediaMock(false);
    root = createRoot(container);
    act(() => {
      root!.render(
        <ThemeProvider>
          <TopNav route="hub" wrongCount={0} favCount={0} onNavClick={() => {}} />
        </ThemeProvider>,
      );
    });

    const group = container.querySelector('[data-testid="theme-toggle"]');
    const btnSystem = container.querySelector<HTMLButtonElement>('[data-testid="theme-option-system"]');
    const btnLight = container.querySelector<HTMLButtonElement>('[data-testid="theme-option-light"]');
    const btnDark = container.querySelector<HTMLButtonElement>('[data-testid="theme-option-dark"]');

    expect(group).not.toBeNull();
    expect(btnSystem?.getAttribute('aria-pressed')).toBe('true');
    expect(btnLight?.getAttribute('aria-pressed')).toBe('false');
    expect(btnDark?.getAttribute('aria-pressed')).toBe('false');

    act(() => {
      btnDark?.click();
    });
    expect(btnDark?.getAttribute('aria-pressed')).toBe('true');
    expect(btnSystem?.getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    act(() => {
      btnLight?.click();
    });
    expect(btnLight?.getAttribute('aria-pressed')).toBe('true');
    expect(btnDark?.getAttribute('aria-pressed')).toBe('false');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    act(() => {
      btnSystem?.click();
    });
    expect(btnSystem?.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });

  it('resolves same-tick batched toggleTheme() calls deterministically without stale closures', () => {
    installMatchMediaMock(true);
    let latest!: ThemeContextValue;
    mountProbe((val) => {
      latest = val;
    });

    expect(latest.theme).toBe('system');
    expect(latest.resolvedTheme).toBe('dark');

    // Two toggles from dark -> light -> dark in the same act() tick
    act(() => {
      latest.toggleTheme();
      latest.toggleTheme();
    });
    expect(latest.theme).toBe('dark');
    expect(latest.resolvedTheme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    // Mixed setTheme + batched toggleTheme() in one tick
    act(() => {
      latest.setTheme('light');
      latest.setTheme('dark');
      latest.setTheme('light');
      latest.toggleTheme();
      latest.toggleTheme();
    });
    expect(latest.theme).toBe('light');
    expect(latest.resolvedTheme).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    // Single toggle from light -> dark
    act(() => {
      latest.toggleTheme();
    });
    expect(latest.theme).toBe('dark');
    expect(latest.resolvedTheme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('stays resilient when both localStorage and window.matchMedia throw', () => {
    vi.stubGlobal('matchMedia', () => {
      throw new Error('matchMedia blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    let latest!: ThemeContextValue;
    mountProbe((val) => {
      latest = val;
    });

    expect(latest.theme).toBe('system');
    expect(latest.resolvedTheme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    act(() => {
      latest.toggleTheme();
    });
    expect(latest.theme).toBe('dark');
    expect(latest.resolvedTheme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('index.html inline anti-FOUC script always sets data-theme even if localStorage or matchMedia throws', () => {
    const htmlPath = path.resolve(process.cwd(), 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');
    const match = html.match(/<head>[\s\S]*?<script>([\s\S]*?)<\/script>/i);
    expect(match).not.toBeNull();
    const inlineScript = match![1]!;

    const runHeadScript = (opts: {
      getItem: () => string | null;
      matchMedia?: (q: string) => { matches: boolean };
    }) => {
      const attrs = new Map<string, string>();
      const style: { colorScheme?: string } = {};
      const sandbox = {
        localStorage: { getItem: opts.getItem },
        document: {
          documentElement: {
            setAttribute(k: string, v: string) {
              attrs.set(k, v);
            },
            style,
          },
        },
        window: {} as { matchMedia?: (q: string) => { matches: boolean } },
      };
      if (opts.matchMedia) {
        sandbox.window.matchMedia = opts.matchMedia;
      }
      vm.runInNewContext(inlineScript, sandbox);
      return {
        dataTheme: attrs.get('data-theme'),
        dataThemeMode: attrs.get('data-theme-mode'),
        colorScheme: style.colorScheme,
      };
    };

    // Case 1: localStorage.getItem throws, OS prefers dark
    expect(
      runHeadScript({
        getItem: () => {
          throw new Error('SecurityError');
        },
        matchMedia: () => ({ matches: true }),
      }),
    ).toEqual({
      dataTheme: 'dark',
      dataThemeMode: 'system',
      colorScheme: 'dark',
    });

    // Case 2: localStorage returns 'dark' while matchMedia throws (should short-circuit and succeed)
    const throwingMatchMedia = vi.fn(() => {
      throw new Error('matchMedia error');
    });
    expect(
      runHeadScript({
        getItem: () => 'dark',
        matchMedia: throwingMatchMedia,
      }),
    ).toEqual({
      dataTheme: 'dark',
      dataThemeMode: 'dark',
      colorScheme: 'dark',
    });
    expect(throwingMatchMedia).not.toHaveBeenCalled();

    // Case 3: Both localStorage and matchMedia throw -> falls back safely to light
    expect(
      runHeadScript({
        getItem: () => {
          throw new Error('SecurityError');
        },
        matchMedia: () => {
          throw new Error('matchMedia error');
        },
      }),
    ).toEqual({
      dataTheme: 'light',
      dataThemeMode: 'system',
      colorScheme: 'light',
    });
  });
});
