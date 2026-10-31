/**
 * Weather quips plugin. The quip library and generation live in workstream D's
 * `providers/real/quips.ts`, which reads the key through `ctx.integration('quips')`.
 */
import type { TestResult } from '@mantel/shared';
import { humanError } from '../registry.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import { manifest } from './manifest.js';

export const CLAUDE_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const QUIP_MODEL = 'claude-haiku-5-5';

export function quipsPlugin(doFetch?: typeof fetch): Plugin {
  const fetcher = doFetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  let hasKey = false;
  return {
    manifest,
    start() {},
    stop() {},
    apply(_config, secrets) {
      hasKey = Boolean(secrets.claudeApiKey);
    },
    async test(_config, secrets): Promise<TestResult> {
      if (!secrets.claudeApiKey)
        return { ok: true, message: 'No key: quips come from the built-in library.' };
      try {
        const res = await fetcher(CLAUDE_MESSAGES_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': secrets.claudeApiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: QUIP_MODEL,
            max_tokens: 8,
            messages: [{ role: 'user', content: 'Say "ok".' }],
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (res.status === 401)
          return { ok: false, message: 'Claude refused the key. Copy it again from the console.' };
        if (!res.ok)
          throw new Error(`Claude answered ${res.status}: ${(await res.text()).slice(0, 120)}`);
        return { ok: true, message: 'Claude answered. A fresh quip will be written each day.' };
      } catch (err) {
        return { ok: false, message: humanError(err) };
      }
    },
    status(): PluginStatusFields {
      return {
        state: 'connected',
        summary: hasKey ? 'Claude writes a fresh line each day' : 'Built-in library',
        lastOkAt: null,
        lastError: null,
      };
    },
  };
}
