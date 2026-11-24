/** Photo folder plugin (v4 S): a directory mounted into the container feeds the slideshow. */
import { stat } from 'node:fs/promises';
import type { TestResult } from '@mantel/shared';
import { PhotoCache } from '../../providers/real/photos-cache.js';
import { readFolderPhoto, scanFolder, watchFolder } from '../../providers/real/photos-folder.js';
import type { MixSource } from '../../providers/real/photos-mixer.js';
import { integrationValues, type ProviderContext } from '../../providers/types.js';
import type { Plugin, PluginStatusFields } from '../types.js';
import { manifest } from './manifest.js';

export const FOLDER_REFRESH_MS = 15 * 60_000;

/** A person-readable reason a folder cannot be read. */
export async function folderProblem(path: string): Promise<string | null> {
  try {
    const s = await stat(path);
    return s.isDirectory() ? null : `${path} is a file, not a folder.`;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT')
      return `Mantel cannot see ${path}. Mount your photos into the container at that path (see the steps), then restart the container.`;
    if (code === 'EACCES')
      return `Mantel is not allowed to read ${path}. Check the share's permissions.`;
    return `Mantel could not open ${path}.`;
  }
}

export function photoFolderPlugin(opts: { dir?: string } = {}): Plugin & { source: MixSource } {
  let ctx: ProviderContext | null = null;
  let cache: PhotoCache | null = null;
  let unwatch: (() => void) | null = null;
  let root = '';
  let builtFrom = '';
  let heic = 0;
  let problem: string | null = null;

  const teardown = () => {
    unwatch?.();
    unwatch = null;
    cache?.stop();
  };

  const source: MixSource = {
    id: 'photo-folder',
    name: 'Photo folder',
    short: 'Photo folder',
    enabled: () => (ctx ? integrationValues(ctx, 'photo-folder').enabled : false),
    configured: () => cache !== null,
    items: () => cache?.items() ?? [],
    bytes: async (id) => (cache ? cache.bytes(id) : null),
    status: () => {
      const s = cache?.status();
      return {
        syncing: s?.syncing ?? false,
        lastSync: s?.lastSync ?? null,
        error: problem ?? s?.error ?? null,
      };
    },
  };

  return {
    manifest,
    source,
    start(c) {
      ctx = c;
    },
    stop: teardown,
    apply(config) {
      if (!ctx) return;
      const path = typeof config.path === 'string' ? config.path.trim() : '';
      const key = JSON.stringify([path, config.limit]);
      if (key === builtFrom) return;
      builtFrom = key;
      teardown();
      cache = null;
      problem = null;
      root = path;
      if (!path) return;
      const c = ctx;
      cache = new PhotoCache({
        ctx: c,
        prefix: 'folder',
        limit: typeof config.limit === 'number' ? config.limit : 3000,
        refreshMs: FOLDER_REFRESH_MS,
        ...(opts.dir ? { dir: opts.dir } : {}),
        list: async () => {
          problem = await folderProblem(root);
          if (problem) throw new Error(problem);
          const scan = await scanFolder(root);
          heic = scan.heic;
          return scan.photos;
        },
        read: (photo) => readFolderPhoto(root, photo),
      });
      const current = cache;
      current.start();
      unwatch = watchFolder(root, () => void current.refresh());
    },
    async test(config): Promise<TestResult> {
      const path = typeof config.path === 'string' ? config.path.trim() : '';
      if (!path) return { ok: false, message: 'Type the folder, such as /photos.' };
      const why = await folderProblem(path);
      if (why) return { ok: false, message: why };
      const scan = await scanFolder(path);
      if (!scan.photos.length)
        return {
          ok: false,
          message: scan.heic
            ? `Found ${scan.heic} HEIC photo${scan.heic === 1 ? '' : 's'} but nothing Mantel can show. Export them as JPEG.`
            : `${path} is there but has no photos in it (JPEG, PNG, WebP).`,
        };
      const skipped = scan.heic
        ? ` ${scan.heic} HEIC file${scan.heic === 1 ? '' : 's'} will be skipped.`
        : '';
      return {
        ok: true,
        message: `Found ${scan.photos.length} photo${scan.photos.length === 1 ? '' : 's'}.${skipped}`,
      };
    },
    status(): PluginStatusFields {
      if (!cache)
        return {
          state: 'not_set_up',
          summary: 'Mount a folder and type its path',
          lastOkAt: null,
          lastError: null,
        };
      const s = cache.status();
      const err = problem ?? s.error;
      if (err && !s.count)
        return { state: 'error', summary: err, lastOkAt: s.lastSync, lastError: err };
      const skipped = heic ? `, ${heic} HEIC skipped` : '';
      return {
        state: 'connected',
        summary:
          s.syncing && !s.count
            ? 'Reading the folder…'
            : `${s.count} photo${s.count === 1 ? '' : 's'} from ${root}${skipped}`,
        lastOkAt: s.lastSync,
        lastError: err,
      };
    },
  };
}
