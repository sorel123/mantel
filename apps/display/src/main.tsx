import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './app/Shell';
import { BootstrapProvider } from './lib/bootstrap';
import { AddPage } from './screens/lists/add/AddPage';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BootstrapProvider>
      {/* The phone page for adding to lists (workstream 5); everything else is the wall. */}
      {location.pathname.replace(/\/$/, '') === '/add' ? <AddPage /> : <Shell />}
    </BootstrapProvider>
  </StrictMode>,
);
