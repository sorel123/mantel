import { lazy, Suspense } from 'react';
import { BootstrapProvider } from '../lib/bootstrap';
import { AddPage } from '../screens/lists/add/AddPage';
import { SettingsPage } from '../screens/settings';
import { SetupWizard } from '../screens/setup';
import { Shell } from './Shell';

const Demo = lazy(() => import('./demo/Demo'));
const SkinsGallery = lazy(() => import('./demo/SkinsGallery'));

/**
 * Routes by path: `/settings` is the hub where everything is configured, `/setup` the first-run
 * wizard over the same sections, `/add` the phone page for lists, `/demo` the design-system
 * gallery (no server), `/demo/skins` the skin gallery (real screens, so it needs the server;
 * mock mode is fine). Everything else is the wall display.
 */
export function App() {
  const path = location.pathname.replace(/\/+$/, '');
  if (path === '/settings') return <SettingsPage />;
  if (path === '/setup') return <SetupWizard />;
  if (path === '/demo/skins')
    return (
      <BootstrapProvider>
        <Suspense fallback={null}>
          <SkinsGallery />
        </Suspense>
      </BootstrapProvider>
    );
  if (path === '/demo')
    return (
      <Suspense fallback={null}>
        <Demo />
      </Suspense>
    );
  return <BootstrapProvider>{path === '/add' ? <AddPage /> : <Shell />}</BootstrapProvider>;
}
