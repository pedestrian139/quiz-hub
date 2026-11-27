import { useCallback, useEffect, useState } from 'react';
import { LEGACY_GUEST_SCOPE, practiceStorageKey, type PracticeScope } from '../core/practiceScope';
import { usePracticeScope } from './practiceScope';

export const WORKSPACE_PREFS_STORAGE_KEY = 'quizhub-v2:workspace-prefs';

export type ShortAnswerMode = 'self' | 'ai';

export interface WorkspacePrefs {
  autoExplainOnWrong: boolean;
  shortAnswerMode: ShortAnswerMode;
}

export const DEFAULT_WORKSPACE_PREFS: WorkspacePrefs = {
  autoExplainOnWrong: false,
  shortAnswerMode: 'self',
};

function normalizeWorkspacePrefs(raw: unknown): WorkspacePrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_WORKSPACE_PREFS };
  }
  const obj = raw as Record<string, unknown>;
  return {
    autoExplainOnWrong: obj.autoExplainOnWrong === true,
    shortAnswerMode: obj.shortAnswerMode === 'ai' ? 'ai' : 'self',
  };
}

export function loadWorkspacePrefs(scope?: PracticeScope): WorkspacePrefs {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...DEFAULT_WORKSPACE_PREFS };
    }
    const key = practiceStorageKey(WORKSPACE_PREFS_STORAGE_KEY, scope ?? LEGACY_GUEST_SCOPE);
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return { ...DEFAULT_WORKSPACE_PREFS };
    }
    return normalizeWorkspacePrefs(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_WORKSPACE_PREFS };
  }
}

export function saveWorkspacePrefs(
  prefs: Partial<WorkspacePrefs>,
  scope?: PracticeScope,
): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return false;
    }
    const key = practiceStorageKey(WORKSPACE_PREFS_STORAGE_KEY, scope ?? LEGACY_GUEST_SCOPE);
    window.localStorage.setItem(key, JSON.stringify(normalizeWorkspacePrefs(prefs)));
    return true;
  } catch {
    return false;
  }
}

export function useWorkspacePrefs(scopeOverride?: PracticeScope) {
  const contextScope = usePracticeScope();
  const scope = scopeOverride ?? contextScope;
  const [prefs, setPrefs] = useState<WorkspacePrefs>(() => loadWorkspacePrefs(scope));

  useEffect(() => {
    setPrefs(loadWorkspacePrefs(scope));
  }, [scope]);

  const updatePrefs = useCallback(
    (updater: WorkspacePrefs | ((prev: WorkspacePrefs) => WorkspacePrefs)) => {
      setPrefs((prev) => {
        const next = normalizeWorkspacePrefs(
          typeof updater === 'function' ? updater(prev) : updater,
        );
        saveWorkspacePrefs(next, scope);
        return next;
      });
    },
    [scope],
  );

  const setAutoExplainOnWrong = useCallback(
    (autoExplainOnWrong: boolean) => {
      updatePrefs((prev) => ({ ...prev, autoExplainOnWrong }));
    },
    [updatePrefs],
  );

  const toggleAutoExplainOnWrong = useCallback(() => {
    updatePrefs((prev) => ({ ...prev, autoExplainOnWrong: !prev.autoExplainOnWrong }));
  }, [updatePrefs]);

  const setShortAnswerMode = useCallback(
    (shortAnswerMode: ShortAnswerMode) => {
      updatePrefs((prev) => ({
        ...prev,
        shortAnswerMode: shortAnswerMode === 'ai' ? 'ai' : 'self',
      }));
    },
    [updatePrefs],
  );

  return {
    prefs,
    setAutoExplainOnWrong,
    toggleAutoExplainOnWrong,
    setShortAnswerMode,
  };
}
