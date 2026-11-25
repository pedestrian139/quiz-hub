import { createContext, useContext } from 'react';
import { LEGACY_GUEST_SCOPE } from '../core/practiceScope';
import type { PracticeScope } from '../core/practiceScope';

export const PracticeScopeContext = createContext<PracticeScope>(LEGACY_GUEST_SCOPE);

export function usePracticeScope(): PracticeScope {
  return useContext(PracticeScopeContext);
}
