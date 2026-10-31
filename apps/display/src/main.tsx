import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './app/Shell';
import { BootstrapProvider } from './lib/bootstrap';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BootstrapProvider>
      <Shell />
    </BootstrapProvider>
  </StrictMode>,
);
