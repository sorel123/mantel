import { Suspense, lazy, type ComponentType, type ReactNode } from 'react';

/**
 * Sections other workstreams own: C's `HomeSetupSection` in `./home/`, E's `AppearanceSection`
 * in `./appearance/`, F's `LayoutSection` in `./layout/`. Each is mounted when its folder
 * exists, with no edit here (the same trick the shell uses for feature layers), and the fallback
 * shows until then.
 */
const modules = import.meta.glob<Record<string, unknown>>(
  ['./home/index.tsx', './appearance/index.tsx', './layout/index.tsx'],
  { eager: false },
);

function optional(path: string, exportName: string): ComponentType<Record<string, unknown>> | null {
  const load = modules[path];
  if (!load) return null;
  const Nothing: ComponentType<Record<string, unknown>> = () => null;
  return lazy(async () => {
    const mod = await load();
    const found = mod[exportName];
    return {
      default:
        typeof found === 'function' ? (found as ComponentType<Record<string, unknown>>) : Nothing,
    };
  });
}

export const HomeSetupSection = optional('./home/index.tsx', 'HomeSetupSection');
export const AppearanceSection = optional('./appearance/index.tsx', 'AppearanceSection');
export const LayoutSection = optional('./layout/index.tsx', 'LayoutSection');

export function Mount({
  Component,
  fallback,
  props = {},
}: {
  Component: ComponentType<Record<string, unknown>> | null;
  fallback: ReactNode;
  props?: Record<string, unknown>;
}) {
  if (!Component) return <>{fallback}</>;
  return (
    <Suspense fallback={null}>
      <Component {...props} />
    </Suspense>
  );
}
