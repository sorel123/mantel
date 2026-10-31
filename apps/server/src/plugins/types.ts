/**
 * Server side of the plugin framework (types shared with the display are in
 * `@mantel/shared` `plugins.ts`). A plugin is one folder under `plugins/` exporting a
 * `Plugin`; the registry owns its config, secrets and lifecycle. See `docs/plugins.md`.
 */
import type {
  AuthorizeUrlResponse,
  IntegrationConfig,
  IntegrationId,
  PluginManifest,
  PluginRuntime,
} from '@mantel/shared';
import type { ProviderContext } from '../providers/types.js';

/** Merged values a plugin receives: config by field key, secrets by field key, both store-over-env. */
export interface PluginValues {
  config: IntegrationConfig;
  secrets: Record<string, string>;
}

export interface Plugin extends PluginRuntime<ProviderContext> {
  manifest: PluginManifest;
  /** OAuth plugins (`manifest.connect === 'oauth'`): where to send the browser. */
  authorizeUrl?(): AuthorizeUrlResponse;
  /** OAuth plugins: the address the provider redirected to (or pasted back). Connects on success. */
  callback?(url: string): Promise<void>;
  /** Fill server-computed read-only fields (a redirect URI) into the status config. */
  computed?(): IntegrationConfig;
}

export type PluginFactory = (ctx: ProviderContext) => Plugin;

export interface PluginStatusFields {
  state: 'not_set_up' | 'connected' | 'error' | 'disabled';
  summary: string;
  lastOkAt: string | null;
  lastError: string | null;
}

export type { IntegrationId };
