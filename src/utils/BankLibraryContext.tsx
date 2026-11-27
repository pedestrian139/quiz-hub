import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useBankLibrary, type BankLibraryApi } from './useBankLibrary';

export type ImportModalTab = 'import' | 'banks' | 'practice';

export interface BankLibraryContextValue extends BankLibraryApi {
  importModalOpen: boolean;
  setImportModalOpen: (open: boolean) => void;
  importInitialTab: ImportModalTab;
  openImportModal: (tab?: ImportModalTab) => void;
}

const BankLibraryContext = createContext<BankLibraryContextValue | null>(null);

export function BankLibraryProvider({ children }: { children: ReactNode }) {
  const library = useBankLibrary();
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importInitialTab, setImportInitialTab] = useState<ImportModalTab>('import');

  const openImportModal = useCallback((tab: ImportModalTab = 'import') => {
    setImportInitialTab(tab);
    setImportModalOpen(true);
  }, []);

  const value = useMemo<BankLibraryContextValue>(
    () => ({
      ...library,
      importModalOpen,
      setImportModalOpen,
      importInitialTab,
      openImportModal,
    }),
    [importInitialTab, importModalOpen, library, openImportModal],
  );

  return (
    <BankLibraryContext.Provider value={value}>
      {children}
    </BankLibraryContext.Provider>
  );
}

export function useBankLibraryContext(): BankLibraryContextValue {
  const ctx = useContext(BankLibraryContext);
  if (!ctx) {
    throw new Error('useBankLibraryContext must be used inside <BankLibraryProvider>');
  }
  return ctx;
}

export function useOptionalBankLibraryContext(): BankLibraryContextValue | null {
  return useContext(BankLibraryContext);
}
