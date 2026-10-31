import type { IntegrationConfig, PluginManifest } from '@mantel/shared';
import { describe, expect, it, vi } from 'vitest';
import { openDb } from '../db/index.js';
import type { ProviderContext } from '../providers/types.js';
import { SecretStore, loadOrCreateKey } from '../secrets.js';
import { SettingsStore } from '../settings.js';
import { PluginRegistry, humanError } from './registry.js';
import type { Plugin } from './types.js';

const manifest: PluginManifest = {
  id: 'homeassistant',
  name: 'Home Assistant',
  description: 'test',
  category: 'home',
  step: 'homeassistant',
  connect: 'fields',
  optional: true,
  directions: [],
  contributes: { events: [] },
  fields: [
    {
      key: 'url',
      label: 'Address',
      type: 'url',
      required: true,
      advanced: false,
      readOnly: false,
      env: 'HA_URL',
    },
    {
      key: 'token',
      label: 'Token',
      type: 'secret',
      required: true,
      advanced: false,
      readOnly: false,
      env: 'HA_TOKEN',
    },
    {
      key: 'streamMaxSeconds',
      label: 'Cap',
      type: 'number',
      required: false,
      min: 10,
      max: 600,
      default: 120,
      advanced: true,
      readOnly: false,
    },
    {
      key: 'redirect',
      label: 'Redirect',
      type: 'url',
      required: false,
      advanced: false,
      readOnly: true,
    },
  ],
};

function harness(env: NodeJS.ProcessEnv = {}) {
  const db = openDb(':memory:');
  const settings = new SettingsStore(db);
  const secrets = new SecretStore(db, loadOrCreateKey(':memory:'));
  const ctx = { settings: () => settings.get() } as unknown as ProviderContext;
  const applied: Array<[IntegrationConfig, Record<string, string>]> = [];
  const plugin: Plugin = {
    manifest,
    start: vi.fn(),
    stop: vi.fn(),
    apply: (config, s) => {
      applied.push([config, s]);
    },
    test: async (config, s) => ({
      ok: Boolean(config.url && s.token),
      message: `url=${config.url} token=${s.token}`,
    }),
    status: () => ({ state: 'connected', summary: 'ok', lastOkAt: null, lastError: null }),
    computed: () => ({ redirect: 'http://x/cb' }),
  };
  const registry = new PluginRegistry(ctx, { db, secrets, settings, env });
  registry.register(plugin);
  return { registry, settings, secrets, applied, plugin };
}

describe('plugin registry', () => {
  it('starts plugins with env fallbacks and reports their source', async () => {
    const { registry, applied } = harness({ HA_URL: 'http://ha:8123', HA_TOKEN: 'envtok' });
    await registry.start();
    expect(applied).toEqual([
      [{ url: 'http://ha:8123', streamMaxSeconds: 120 }, { token: 'envtok' }],
    ]);
    const status = registry.status('homeassistant');
    expect(status).toMatchObject({
      id: 'homeassistant',
      enabled: true,
      state: 'connected',
      config: { url: 'http://ha:8123', streamMaxSeconds: 120, redirect: 'http://x/cb' },
      hasSecrets: ['token'],
      sources: { url: 'env', token: 'env' },
    });
  });

  it('prefers saved values over env, validates, and re-applies on save', async () => {
    const { registry, applied, secrets } = harness({ HA_URL: 'http://env:8123' });
    await registry.start();
    const status = await registry.update('homeassistant', {
      config: { url: 'http://saved:8123', streamMaxSeconds: 30 },
      secrets: { token: ' newtok ' },
    });
    expect(status.config).toMatchObject({ url: 'http://saved:8123', streamMaxSeconds: 30 });
    expect(status.sources).toEqual({ url: 'store', streamMaxSeconds: 'store', token: 'store' });
    expect(secrets.get('homeassistant', 'token')).toBe('newtok');
    expect(applied.at(-1)).toEqual([
      { url: 'http://saved:8123', streamMaxSeconds: 30 },
      { token: 'newtok' },
    ]);

    await expect(
      registry.update('homeassistant', { config: { url: 'not a url' } }),
    ).rejects.toThrow(/web address/);
    await expect(
      registry.update('homeassistant', { config: { streamMaxSeconds: 5 } }),
    ).rejects.toThrow(/at least 10/);
    await expect(registry.update('homeassistant', { config: { nope: 'x' } })).rejects.toThrow(
      /no setting/,
    );
    await expect(registry.update('homeassistant', { secrets: { url: 'x' } })).rejects.toThrow(
      /no secret/,
    );
    await expect(
      registry.update('homeassistant', { config: { redirect: 'http://y' } }),
    ).rejects.toThrow(/no setting/);
    await expect(registry.update('nope', {})).rejects.toThrow(/not found/);

    // Clearing a saved value falls back to env; clearing a secret removes it.
    const cleared = await registry.update('homeassistant', {
      config: { url: null },
      secrets: { token: null },
    });
    expect(cleared.config.url).toBe('http://env:8123');
    expect(cleared.sources.url).toBe('env');
    expect(cleared.hasSecrets).toEqual([]);
  });

  it('turns a plugin off through settings and reports it disabled', async () => {
    const { registry, applied, settings } = harness({ HA_URL: 'http://env:8123', HA_TOKEN: 't' });
    await registry.start();
    const off = await registry.update('homeassistant', { enabled: false });
    expect(off.state).toBe('disabled');
    expect(settings.get().integrations.homeassistant).toEqual({ enabled: false });
    expect(applied.at(-1)).toEqual([{}, {}]);
    const on = await registry.update('homeassistant', { enabled: true });
    expect(on.state).toBe('connected');
    expect(applied.at(-1)?.[1]).toEqual({ token: 't' });
  });

  it('tests posted values merged over saved ones without saving them', async () => {
    const { registry } = harness({ HA_TOKEN: 'envtok' });
    await registry.start();
    expect(await registry.test('homeassistant')).toEqual({
      ok: false,
      message: 'url=undefined token=envtok',
    });
    expect(await registry.test('homeassistant', { config: { url: 'http://try:8123' } })).toEqual({
      ok: true,
      message: 'url=http://try:8123 token=envtok',
    });
    expect(registry.status('homeassistant').config.url).toBeUndefined();
  });

  it('exports config and secrets for a backup', async () => {
    const { registry } = harness();
    await registry.start();
    await registry.update('homeassistant', {
      config: { url: 'http://a' },
      secrets: { token: 'tok' },
    });
    expect(registry.exportConfig()).toEqual({
      homeassistant: { enabled: true, config: { url: 'http://a' } },
    });
    expect(registry.exportSecrets()).toEqual({ homeassistant: { token: 'tok' } });
  });

  it('turns upstream errors into a sentence', () => {
    expect(humanError(new Error('getaddrinfo ENOTFOUND ha.local'))).toMatch(/could not be found/);
    expect(humanError(new Error('fetch failed: ECONNREFUSED'))).toMatch(/Nothing answered/);
    expect(humanError(new Error('answered 401'))).toMatch(/refused the credentials/);
  });
});
