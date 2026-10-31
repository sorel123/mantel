import { lazy, Suspense } from 'react';
import { BootstrapProvider } from '../lib/bootstrap';
import { AddPage } from '../screens/lists/add/AddPage';
import { SettingsPage } from '../screens/settings';
import { SetupWizard } from '../screens/setup';
import { Shell } from './Shell';

const Demo = lazy(() => import('./demo/Demo'));

/**
 * Routes by path: `/settings` is the hub where everything is configured, `/setup` the first-run
 * wizard over the same sections, `/add` the phone page for lists, `/demo` the design-system
 * gallery (no server). Everything else is the wall display.
 */
export function App() {
  const path = location.pathname.replace(/\/+$/, '');
  if (path === '/settings') return <SettingsPage />;
  if (path === '/setup') return <SetupWizard />;
  if (path === '/demo')
    return (
      <Suspense fallback={null}>
        <Demo />
      </Suspense>
    );
  return <BootstrapProvider>{path === '/add' ? <AddPage /> : <Shell />}</BootstrapProvider>;
}
