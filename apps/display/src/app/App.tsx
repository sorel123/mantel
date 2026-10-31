import { lazy, Suspense } from 'react';
import { BootstrapProvider } from '../lib/bootstrap';
import { Shell } from './Shell';

const Demo = lazy(() => import('./demo/Demo'));

/** `/demo` is the design-system gallery (no server needed); everything else is the display. */
export function App() {
  if (location.pathname.startsWith('/demo'))
    return (
      <Suspense fallback={null}>
        <Demo />
      </Suspense>
    );
  return (
    <BootstrapProvider>
      <Shell />
    </BootstrapProvider>
  );
}
