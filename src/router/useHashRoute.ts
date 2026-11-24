import { useCallback, useEffect, useState } from 'react';

export type Route = 'hub' | 'quiz' | 'wrong' | 'fav' | 'notes';

export const ROUTE_HASH: Record<Route, string> = {
  hub: '#/',
  quiz: '#/quiz',
  wrong: '#/wrong',
  fav: '#/fav',
  notes: '#/notes',
};

const PATH_TO_ROUTE: Record<string, Route> = {
  '': 'hub',
  quiz: 'quiz',
  wrong: 'wrong',
  fav: 'fav',
  notes: 'notes',
};

/** Parses `#/quiz`, `#quiz`, `#/quiz?x=1`, `#/quiz/` ... Returns null for unknown paths. */
export function parseHash(hash: string): Route | null {
  const path = hash.replace(/^#/, '').replace(/^\/+/, '').split(/[/?#]/)[0] ?? '';
  const key = path.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PATH_TO_ROUTE, key) ? PATH_TO_ROUTE[key]! : null;
}

function currentRoute(): Route {
  if (typeof window === 'undefined') return 'hub';
  return parseHash(window.location.hash) ?? 'hub';
}

function normalizeUnknownHash(): void {
  if (typeof window === 'undefined') return;
  if (parseHash(window.location.hash) === null) {
    try {
      const { pathname, search } = window.location;
      window.history.replaceState(window.history.state, '', `${pathname}${search}#/`);
    } catch {
      // History API may be unavailable in exotic sandboxes — the in-memory route still falls back to hub.
    }
  }
}

export function useHashRoute(onRouteChange?: (next: Route) => void) {
  const [route, setRoute] = useState<Route>(() => {
    normalizeUnknownHash();
    return currentRoute();
  });

  useEffect(() => {
    const handle = () => {
      normalizeUnknownHash();
      const next = currentRoute();
      setRoute(next);
      onRouteChange?.(next);
    };
    window.addEventListener('hashchange', handle);
    return () => window.removeEventListener('hashchange', handle);
  }, [onRouteChange]);

  const navigate = useCallback((next: Route) => {
    const target = ROUTE_HASH[next];
    if (parseHash(window.location.hash) === next) {
      // Same route: no hashchange will fire, so notify synchronously.
      onRouteChange?.(next);
      return;
    }
    window.location.hash = target;
  }, [onRouteChange]);

  return { route, navigate };
}
