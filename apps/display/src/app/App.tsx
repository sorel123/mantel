import { lazy, Suspense } from 'react';
import { BootstrapProvider } from '../lib/bootstrap';
import { AddPage } from '../screens/lists/add/AddPage';
import { SettingsPage } from '../screens/settings';
import { Shell } from './Shell';

const Demo = lazy(() => import('./demo/Demo'));
const SkinsGallery = lazy(() => import('./demo/SkinsGallery'));

/**
 * Routes by path: `/settings` is the setup page (workstream 6, loads its own data), `/add` the
 * phone page for lists (workstream 5), `/demo` the design-system gallery (no server). Everything
 * else is the wall display. `/demo/skins` is the skin gallery (workstream E); it shows the real
 * screens, so it needs the server (mock mode is fine).
 */
export function App() {
  const path = location.pathname.replace(/\/+$/, '');
  if (path === '/settings') return <SettingsPage />;
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
