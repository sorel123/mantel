import { lazy, Suspense } from 'react';
import { BootstrapProvider } from '../lib/bootstrap';
import { CompanionApp } from '../screens/companion/App';
import { SettingsPage } from '../screens/settings';
import { SetupWizard } from '../screens/setup';
import { Shell } from './Shell';

const Demo = lazy(() => import('./demo/Demo'));
const SkinsGallery = lazy(() => import('./demo/SkinsGallery'));

/**
 * Routes by path: `/settings` is the hub where everything is configured, `/setup` the first-run
 * wizard over the same sections, `/app` (and the older `/add`) the companion app for phones,
 * `/demo` the design-system
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
  return (
    <BootstrapProvider>
      {path === '/add' || path === '/app' ? <CompanionApp /> : <Shell />}
    </BootstrapProvider>
  );
}
