import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './app/Shell';
import { BootstrapProvider } from './lib/bootstrap';
import { SettingsPage } from './screens/settings';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';

// `/settings` is the setup page (WS6); everything else is the wall display.
const isSettings = location.pathname.replace(/\/+$/, '') === '/settings';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isSettings ? (
      <SettingsPage />
    ) : (
      <BootstrapProvider>
        <Shell />
      </BootstrapProvider>
    )}
  </StrictMode>,
);
