/**
 * Question of the day (v4 G): a conversation starter for dinner, from 371 bundled questions (344
 * kid-friendly). The same question all day on every display; Another one moves on for today
 * only. An optional Ambient line from half an hour before dinner.
 */
import {
  toIsoDate,
  type IntegrationConfig,
  type PluginActionResponse,
  type PluginBlocksInput,
  type TestResult,
} from '@mantel/shared';
import { kvGet, kvSet } from '../../db/index.js';
import { HttpError } from '../../errors.js';
import type { ProviderContext } from '../../providers/types.js';
import { bool, parseClock, str, type PackDeps } from '../pack/util.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import { manifest } from './manifest.js';
import { QUESTIONS } from './questions.js';

export const questionsFor = (kids: boolean) =>
  QUESTIONS.filter((q) => !kids || !q.startsWith('*')).map((q) => q.replace(/^\*/, ''));

/** Day number since 2000-01-01 in local time, so every display agrees all day. */
const dayNumber = (d: Date) =>
  Math.floor(
    (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2000, 0, 1)) / 86_400_000,
  );

/** A fixed shuffle (so neighbouring days are not neighbouring lines in the file). */
export function questionFor(date: Date, kids: boolean, skip = 0): string {
  const list = questionsFor(kids);
  const n = list.length;
  // 97 is prime and does not divide any list length near 365, so this walks every question.
  const i = ((((dayNumber(date) + skip) * 97) % n) + n) % n;
  return list[i]!;
}

export function qotdPlugin(_deps: PackDeps = {}): Plugin {
  let ctx: ProviderContext | null = null;
  let config: IntegrationConfig = {};
  let memorySkip = 0;
  const now = () => ctx?.now() ?? new Date();
  const kvKey = () => `plugin.qotd.skip.${toIsoDate(now())}`;
  const skip = () => (ctx ? (kvGet<number>(ctx.db, kvKey()) ?? 0) : memorySkip);
  const kids = () => bool(config.kids, true);
  const question = () => questionFor(now(), kids(), skip());

  return {
    manifest,
    start(c) {
      ctx = c;
    },
    stop() {},
    apply(next) {
      config = next;
      ctx?.emit({ type: 'plugin.changed', payload: { id: 'qotd' } });
    },
    async test(next): Promise<TestResult> {
      return { ok: true, message: `Today: ${questionFor(now(), bool(next.kids, true))}` };
    },
    status(): PluginStatusFields {
      return {
        state: 'connected',
        summary: `${questionsFor(kids()).length} questions${kids() ? ', kid-friendly' : ''}`,
        lastOkAt: null,
        lastError: null,
      };
    },
    blocks(name): PluginBlocksInput | null | undefined {
      if (name === 'card')
        return {
          title: 'Question of the day',
          icon: 'chat',
          lead: question(),
          lines: [],
          actions: [{ name: 'next', label: 'Another one' }],
        };
      if (name === 'ambient') {
        if (!bool(config.ambient, false)) return null;
        const dinner = parseClock(str(config.dinner) || '17:30') ?? 17 * 60 + 30;
        const m = now().getHours() * 60 + now().getMinutes();
        return m >= dinner - 30 && m <= dinner + 120
          ? { title: question(), icon: 'chat', lines: [] }
          : null;
      }
      return undefined;
    },
    async action(name): Promise<PluginActionResponse> {
      if (name !== 'next') throw new HttpError('not_found', `Question of the day can’t ${name}.`);
      const next = skip() + 1;
      memorySkip = next;
      if (ctx) kvSet(ctx.db, kvKey(), next);
      ctx?.emit({ type: 'plugin.changed', payload: { id: 'qotd' } });
      return { ok: true };
    },
  };
}
