import { Suspense, lazy, type ComponentType } from 'react';

/**
 * Mounts feature-owned layers inside the panel, above the screens and dock: any export whose
 * name ends in `Layer` from `src/features/<name>/index.tsx` (for example WS3's `DoorbellLayer`,
 * which draws the live view over whatever is on screen). Features need no change to the shell.
 */
const modules = import.meta.glob<Record<string, unknown>>('../features/*/index.tsx');

const layers = Object.entries(modules).map(([path, load]) => ({
  path,
  Component: lazy(async () => {
    const mod = await load();
    const found = Object.entries(mod).filter(
      ([name, value]) => name.endsWith('Layer') && typeof value === 'function',
    ) as Array<[string, ComponentType]>;
    const All = () => (
      <>
        {found.map(([name, L]) => (
          <L key={name} />
        ))}
      </>
    );
    return { default: All };
  }),
}));

export function FeatureLayers() {
  if (!layers.length) return null;
  return (
    <Suspense fallback={null}>
      {layers.map(({ path, Component }) => (
        <Component key={path} />
      ))}
    </Suspense>
  );
}
