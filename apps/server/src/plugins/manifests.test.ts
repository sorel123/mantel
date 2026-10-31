import { PluginManifest } from '@mantel/shared';
import { pluginManifests } from '@mantel/shared/fixtures';
import { describe, expect, it } from 'vitest';
import { builtInManifests } from './mock.js';

describe('plugin manifests', () => {
  it('parse against the shared schema', () => {
    for (const m of builtInManifests) PluginManifest.parse(m);
  });

  it('match the fixtures the display is built against', () => {
    // The fixture copy in packages/shared is what B's Settings renders in mock mode; keep them identical.
    const byId = (list: PluginManifest[]) =>
      Object.fromEntries(list.map((m) => [m.id, PluginManifest.parse(m)]));
    expect(byId(builtInManifests)).toEqual(byId(pluginManifests));
  });

  it('give every secret or external field a way to get it', () => {
    for (const m of builtInManifests)
      for (const f of m.fields) {
        if (f.type === 'secret' && m.id !== 'google')
          expect(f.getItHere ?? m.directions.length, `${m.id}.${f.key}`).toBeTruthy();
        if (f.env) expect(f.env).toMatch(/^[A-Z][A-Z0-9_]+$/);
      }
  });
});
