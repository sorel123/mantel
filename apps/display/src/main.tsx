import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './app/Shell';
import { BootstrapProvider } from './lib/bootstrap';
import { AddPage } from './screens/lists/add/AddPage';
import { SettingsPage } from './screens/settings';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';

const path = location.pathname.replace(/\/+$/, '');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* The setup page (workstream 6) loads its own data; everything else needs bootstrap. */}
    {path === '/settings' ? (
      <SettingsPage />
    ) : (
      <BootstrapProvider>
        {/* The phone page for adding to lists (workstream 5); everything else is the wall. */}
        {path === '/add' ? <AddPage /> : <Shell />}
      </BootstrapProvider>
    )}
  </StrictMode>,
);
