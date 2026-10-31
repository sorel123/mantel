/**
 * The plugin registry: loads every plugin, merges its saved config and secrets with
 * environment fallbacks, calls `apply` so providers hot-reload, answers the `/api/plugins`
 * and `/api/integrations` routes, and keeps a status per integration for Health.
 */
import type {
  IntegrationConfig,
  IntegrationId,
  IntegrationPatch,
  IntegrationStatus,
  PluginManifest,
  SetupField,
  TestResult,
  ValueSource,
} from '@mantel/shared';
import { IntegrationId as IntegrationIdSchema } from '@mantel/shared';
import { kvGet, kvSet, type Db } from '../db/index.js';
import { HttpError, notFound } from '../errors.js';
import { log } from '../log.js';
import type { ProviderContext } from '../providers/types.js';
import type { SecretStore } from '../secrets.js';
import type { SettingsStore } from '../settings.js';
import type { Plugin, PluginValues } from './types.js';

const KV_PREFIX = 'integration.';

interface StoredConfig {
  config: IntegrationConfig;
}

export interface RegistryOptions {
  db: Db;
  secrets: SecretStore;
  settings: SettingsStore;
  env?: NodeJS.ProcessEnv;
  /** Last successful sync per source, shared with `/api/health`. */
  sync?: Map<string, string | null>;
}

const isSecret = (f: SetupField) => f.type === 'secret';

/** Coerce a saved or environment value to the field's type; undefined when it does not fit. */
function coerce(field: SetupField, raw: unknown): IntegrationConfig[string] | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  switch (field.type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'toggle':
      return typeof raw === 'boolean' ? raw : raw === 'true' || raw === '1';
    default:
      return typeof raw === 'string' ? raw : String(raw);
  }
}

export class PluginRegistry {
  private readonly plugins = new Map<IntegrationId, Plugin>();
  private readonly started = new Set<IntegrationId>();
  private readonly env: NodeJS.ProcessEnv;
  private readonly sync: Map<string, string | null>;

  constructor(
    private readonly ctx: ProviderContext,
    private readonly opts: RegistryOptions,
  ) {
    this.env = opts.env ?? process.env;
    this.sync = opts.sync ?? new Map();
  }

  register(plugin: Plugin): void {
    const id = plugin.manifest.id;
    if (this.plugins.has(id)) throw new Error(`plugin ${id} registered twice`);
    this.plugins.set(id, plugin);
  }

  /**
   * Start every plugin and apply the enabled ones' current values. Runs synchronously as far
   * as the plugins do (the built-in ones all are), so providers exist before the first
   * request; the returned promise settles when any async work has too. Errors in one plugin
   * never stop the others.
   */
  start(): Promise<void> {
    const pending: Promise<unknown>[] = [];
    const failed = (id: string, what: string) => (err: unknown) =>
      log.error(`plugins: ${id} failed to ${what}`, { err: String(err) });
    for (const plugin of this.plugins.values()) {
      const id = plugin.manifest.id;
      try {
        const started = plugin.start(this.ctx);
        if (started) pending.push(started.catch(failed(id, 'start')));
        this.started.add(id);
        if (this.enabled(id)) {
          const { config, secrets } = this.values(id);
          const applied = plugin.apply(config, secrets);
          if (applied) pending.push(applied.catch(failed(id, 'apply its settings')));
        }
      } catch (err) {
        failed(id, 'start')(err);
      }
    }
    return Promise.all(pending).then(() => undefined);
  }

  async stop(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      try {
        await plugin.stop();
      } catch (err) {
        log.warn(`plugins: ${plugin.manifest.id} failed to stop`, { err: String(err) });
      }
    }
    this.started.clear();
  }

  manifests(): PluginManifest[] {
    return [...this.plugins.values()].map((p) => p.manifest);
  }

  ids(): IntegrationId[] {
    return [...this.plugins.keys()];
  }

  get(id: string): Plugin {
    const parsed = IntegrationIdSchema.safeParse(id);
    const plugin = parsed.success ? this.plugins.get(parsed.data) : undefined;
    if (!plugin) throw notFound(`integration ${id}`);
    return plugin;
  }

  enabled(id: IntegrationId): boolean {
    return this.opts.settings.get().integrations[id]?.enabled ?? true;
  }

  /* ---- values: store over env ---- */

  private storedConfig(id: IntegrationId): IntegrationConfig {
    return kvGet<StoredConfig>(this.opts.db, KV_PREFIX + id)?.config ?? {};
  }

  /** Merged config and secrets for a plugin, and where each came from. */
  resolve(id: IntegrationId): PluginValues & { sources: Record<string, ValueSource> } {
    const plugin = this.get(id);
    const stored = this.storedConfig(id);
    const config: IntegrationConfig = {};
    const secrets: Record<string, string> = {};
    const sources: Record<string, ValueSource> = {};
    for (const field of plugin.manifest.fields) {
      if (field.readOnly) continue;
      if (isSecret(field)) {
        const fromStore = this.opts.secrets.get(id, field.key);
        const fromEnv = field.env ? this.env[field.env] : undefined;
        const value = fromStore ?? (fromEnv?.trim() ? fromEnv.trim() : undefined);
        if (value !== undefined) {
          secrets[field.key] = value;
          sources[field.key] = fromStore !== undefined ? 'store' : 'env';
        }
        continue;
      }
      const fromStore = coerce(field, stored[field.key]);
      const fromEnv = field.env ? coerce(field, this.env[field.env]) : undefined;
      const value = fromStore ?? fromEnv ?? coerce(field, field.default);
      if (value !== undefined) config[field.key] = value;
      if (fromStore !== undefined) sources[field.key] = 'store';
      else if (fromEnv !== undefined) sources[field.key] = 'env';
    }
    return { config, secrets, sources };
  }

  values(id: IntegrationId): PluginValues {
    const { config, secrets } = this.resolve(id);
    return { config, secrets };
  }

  /* ---- status ---- */

  status(id: IntegrationId): IntegrationStatus {
    const plugin = this.get(id);
    const { config, secrets, sources } = this.resolve(id);
    const enabled = this.enabled(id);
    const computed = plugin.computed?.() ?? {};
    let fields;
    try {
      fields = plugin.status();
    } catch (err) {
      fields = {
        state: 'error' as const,
        summary: 'Status unavailable',
        lastOkAt: null,
        lastError: String(err),
      };
    }
    if (!fields.lastOkAt) {
      // Fall back to the sync clock when the plugin names its source.
      const synced = this.sync.get(id);
      if (synced) fields = { ...fields, lastOkAt: synced };
    }
    return {
      id,
      enabled,
      ...fields,
      ...(enabled ? {} : { state: 'disabled' as const, summary: 'Turned off' }),
      config: { ...config, ...computed },
      hasSecrets: Object.keys(secrets),
      sources,
    };
  }

  statuses(): IntegrationStatus[] {
    return this.ids().map((id) => this.status(id));
  }

  /* ---- writes ---- */

  /** Validate against the manifest; the message is written for the person typing. */
  private validate(plugin: Plugin, patch: IntegrationPatch): void {
    const byKey = new Map(plugin.manifest.fields.map((f) => [f.key, f]));
    for (const [key, value] of Object.entries(patch.config ?? {})) {
      const field = byKey.get(key);
      if (!field || isSecret(field) || field.readOnly)
        throw new HttpError(
          'bad_request',
          `${plugin.manifest.name} has no setting called "${key}"`,
        );
      if (value === null || value === '') continue;
      if (field.type === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value))
          throw new HttpError('bad_request', `${field.label} must be a number`);
        if (field.min !== undefined && value < field.min)
          throw new HttpError('bad_request', `${field.label} must be at least ${field.min}`);
        if (field.max !== undefined && value > field.max)
          throw new HttpError('bad_request', `${field.label} must be at most ${field.max}`);
      } else if (field.type === 'toggle') {
        if (typeof value !== 'boolean')
          throw new HttpError('bad_request', `${field.label} must be on or off`);
      } else if (typeof value !== 'string') {
        throw new HttpError('bad_request', `${field.label} must be text`);
      } else if (field.type === 'url') {
        try {
          const u = new URL(value);
          if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
        } catch {
          throw new HttpError(
            'bad_request',
            `${field.label} must be a web address starting with http:// or https://`,
          );
        }
      } else if (field.type === 'select' && field.options?.length) {
        if (!field.options.some((o) => o.value === value))
          throw new HttpError('bad_request', `${field.label} must be one of the choices`);
      }
      if (
        field.pattern &&
        typeof value === 'string' &&
        !new RegExp(field.pattern.regex).test(value)
      )
        throw new HttpError('bad_request', field.pattern.message);
    }
    for (const key of Object.keys(patch.secrets ?? {})) {
      const field = byKey.get(key);
      if (!field || !isSecret(field))
        throw new HttpError('bad_request', `${plugin.manifest.name} has no secret called "${key}"`);
    }
  }

  /** Save a patch, then hot-reload the plugin. Returns the new status. */
  async update(idRaw: string, patch: IntegrationPatch): Promise<IntegrationStatus> {
    const plugin = this.get(idRaw);
    const id = plugin.manifest.id;
    this.validate(plugin, patch);

    if (patch.config) {
      const next = { ...this.storedConfig(id) };
      for (const [key, value] of Object.entries(patch.config)) {
        if (value === null || value === '') delete next[key];
        else next[key] = value;
      }
      kvSet(this.opts.db, KV_PREFIX + id, { config: next } satisfies StoredConfig);
    }
    if (patch.secrets) {
      for (const [key, value] of Object.entries(patch.secrets)) {
        if (value === null || value === '') this.opts.secrets.delete(id, key);
        else this.opts.secrets.set(id, key, value.trim());
      }
    }
    if (patch.enabled !== undefined) {
      const s = this.opts.settings.get();
      this.opts.settings.put({
        ...s,
        integrations: { ...s.integrations, [id]: { enabled: patch.enabled } },
      });
    }
    await this.refresh(id);
    return this.status(id);
  }

  /** Re-apply the current values (after a settings change) or stop a plugin that was turned off. */
  async refresh(id: IntegrationId): Promise<void> {
    const plugin = this.get(id);
    try {
      if (this.enabled(id)) {
        const { config, secrets } = this.values(id);
        await plugin.apply(config, secrets);
      } else {
        await plugin.apply({}, {});
      }
    } catch (err) {
      log.error(`plugins: ${id} failed to apply new settings`, { err: String(err) });
    }
  }

  /** Re-apply every plugin whose enabled flag changed between two settings. */
  async refreshToggles(
    before: Record<string, { enabled: boolean }>,
    after: Record<string, { enabled: boolean }>,
  ): Promise<void> {
    for (const id of this.ids()) {
      const was = before[id]?.enabled ?? true;
      const is = after[id]?.enabled ?? true;
      if (was !== is) await this.refresh(id);
    }
  }

  /** Test the saved values, or the posted ones merged over them. Never throws for an upstream failure. */
  async test(idRaw: string, patch?: IntegrationPatch): Promise<TestResult> {
    const plugin = this.get(idRaw);
    const id = plugin.manifest.id;
    if (patch) this.validate(plugin, patch);
    const current = this.values(id);
    const config = { ...current.config };
    for (const [k, v] of Object.entries(patch?.config ?? {})) {
      if (v === null || v === '') delete config[k];
      else config[k] = v;
    }
    const secrets = { ...current.secrets };
    for (const [k, v] of Object.entries(patch?.secrets ?? {})) {
      if (v === null || v === '') delete secrets[k];
      else secrets[k] = v.trim();
    }
    try {
      return await plugin.test(config, secrets);
    } catch (err) {
      return { ok: false, message: humanError(err) };
    }
  }

  /** Non-secret config of every plugin, for export. */
  exportConfig(): Record<string, { enabled: boolean; config: IntegrationConfig }> {
    return Object.fromEntries(
      this.ids().map((id) => [id, { enabled: this.enabled(id), config: this.storedConfig(id) }]),
    );
  }

  /** Every plugin's secrets, decrypted, for a passphrase-protected export. */
  exportSecrets(): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {};
    for (const id of this.ids()) {
      const s = this.opts.secrets.all(id);
      if (Object.keys(s).length) out[id] = s;
    }
    return out;
  }
}

/** One sentence a person can act on, from whatever an upstream call threw. */
export function humanError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (/ENOTFOUND|EAI_AGAIN/.test(text))
    return 'That address could not be found. Check the spelling and that this computer can reach it.';
  if (/ECONNREFUSED/.test(text))
    return 'Nothing answered at that address. Check the port and that the service is running.';
  if (/ETIMEDOUT|timeout|TimeoutError|aborted/i.test(text))
    return 'No answer in time. Check the address and the network.';
  if (/certificate|self.signed|CERT_/i.test(text))
    return 'The connection is not trusted (certificate problem). Try http:// for a local address.';
  if (/\b401\b|unauthori[sz]ed|invalid_grant|invalid_client/i.test(text))
    return 'The service refused the credentials. Check the token or password.';
  if (/\b403\b|forbidden|PERMISSION_DENIED/i.test(text))
    return 'The service said this key is not allowed to do that. Check the API is enabled for it.';
  if (/\b404\b/.test(text)) return 'The service answered "not found". Check the address.';
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}
