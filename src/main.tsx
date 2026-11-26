import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthPracticeRoot } from './components/Auth/AuthPracticeRoot';
import { SmartWrongBookLauncher } from './features/wrong-book';
import { BankLibraryProvider } from './utils/BankLibraryContext';
import './styles/workspace.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthPracticeRoot>
      <BankLibraryProvider>
        <App />
        <SmartWrongBookLauncher />
      </BankLibraryProvider>
    </AuthPracticeRoot>
  </StrictMode>,
);
