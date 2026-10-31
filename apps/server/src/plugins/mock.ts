/**
 * Mock-mode plugins: the real manifests with fixture statuses, so Settings and the wizard
 * can be built and screenshotted with no accounts. Saving values and toggles works (they go
 * to the same stores), Test always succeeds, and nothing talks to the outside world.
 */
import type { PluginManifest } from '@mantel/shared';
import { integrationStatuses } from '@mantel/shared/fixtures';
import type { Plugin } from './types.js';
import {
  googleManifest,
  homeAssistantManifest,
  icloudManifest,
  photosManifest,
  pollenManifest,
  quipsManifest,
  routesManifest,
  weatherManifest,
} from './index.js';

export const builtInManifests: PluginManifest[] = [
  googleManifest,
  icloudManifest,
  homeAssistantManifest,
  photosManifest,
  routesManifest,
  pollenManifest,
  weatherManifest,
  quipsManifest,
];

export function mockPlugins(now: () => Date = () => new Date()): Plugin[] {
  return builtInManifests.map((manifest) => ({
    manifest,
    start() {},
    stop() {},
    apply() {},
    async test() {
      return { ok: true, message: `${manifest.name} answered (mock mode, nothing was contacted).` };
    },
    status() {
      const fixture = integrationStatuses(now()).find((s) => s.id === manifest.id)!;
      return {
        state: fixture.state === 'disabled' ? 'not_set_up' : fixture.state,
        summary: fixture.state === 'disabled' ? 'Not set up' : fixture.summary,
        lastOkAt: fixture.lastOkAt,
        lastError: fixture.lastError,
      };
    },
    computed() {
      const fixture = integrationStatuses(now()).find((s) => s.id === manifest.id)!;
      return fixture.config;
    },
    ...(manifest.connect === 'oauth'
      ? {
          authorizeUrl: () => ({
            url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=mock&scope=calendar',
            redirectUri: 'http://localhost:8787/api/calendar/google/callback',
            pasteBack: true,
          }),
          callback: async () => {},
        }
      : {}),
  }));
}
