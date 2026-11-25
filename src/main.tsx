import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AuthPracticeRoot } from './components/Auth/AuthPracticeRoot';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthPracticeRoot><App /></AuthPracticeRoot>
  </StrictMode>,
);
