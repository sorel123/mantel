/**
 * A folder of photos on the server (v4 S): an Unraid share or any directory mounted into the
 * container (read-only is fine). Scanned on start and every 15 minutes, and watched so a new
 * photo shows up within seconds. The album caption is the folder a photo sits in; the date is
 * the photo's EXIF date (the cache reads it).
 */
import { watch, type FSWatcher } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import { log } from '../../log.js';
import type { RemotePhoto } from './photos-cache.js';

/** What sharp can read. HEIC needs a libheif build with HEVC, which the image does not ship. */
export const FOLDER_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.tif',
  '.tiff',
  '.avif',
]);
const SKIPPED_EXTENSIONS = new Set(['.heic', '.heif']);
const MAX_DEPTH = 8;
const MAX_FILES = 50_000;

export interface FolderScan {
  photos: RemotePhoto[];
  /** HEIC files seen and left out, so Settings can say so. */
  heic: number;
}

/** Every photo under `root`, newest first. Hidden files and folders (`.thumbnails`, `@eaDir`) are skipped. */
export async function scanFolder(root: string): Promise<FolderScan> {
  const found: { path: string; size: number; mtime: number }[] = [];
  let heic = 0;
  const walk = async (dir: string, depth: number) => {
    if (depth > MAX_DEPTH || found.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (depth === 0) throw err;
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name.startsWith('@')) continue;
      const path = join(dir, e.name);
      if (e.isDirectory()) await walk(path, depth + 1);
      else if (e.isFile()) {
        const ext = extname(e.name).toLowerCase();
        if (SKIPPED_EXTENSIONS.has(ext)) heic++;
        if (!FOLDER_EXTENSIONS.has(ext)) continue;
        try {
          const s = await stat(path);
          found.push({ path, size: s.size, mtime: s.mtimeMs });
        } catch {
          /* vanished mid-scan */
        }
      }
    }
  };
  await walk(root, 0);
  found.sort((a, b) => b.mtime - a.mtime);
  return {
    heic,
    photos: found.map((f) => {
      const rel = relative(root, f.path);
      const folder = dirname(rel);
      return {
        remoteId: rel.split(sep).join('/'),
        version: `${f.size}-${Math.round(f.mtime)}`,
        ...(folder && folder !== '.' ? { album: basename(folder) } : {}),
      };
    }),
  };
}

export async function readFolderPhoto(root: string, photo: RemotePhoto): Promise<Uint8Array> {
  const path = join(root, photo.remoteId);
  // remoteId came from our own scan, but never read outside the root.
  if (relative(root, path).startsWith('..')) throw new Error('outside the photo folder');
  return new Uint8Array(await readFile(path));
}

/** Call `onChange` (debounced) when anything under `root` changes. Returns a stopper. */
export function watchFolder(root: string, onChange: () => void, debounceMs = 5000): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(root, { recursive: true, persistent: false }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, debounceMs);
    });
    watcher.on('error', (err) => log.warn('photo folder: watch stopped', { err: String(err) }));
  } catch (err) {
    // Some network shares cannot be watched; the 15-minute scan still finds new photos.
    log.info('photo folder: not watching, scanning every 15 minutes', { err: String(err) });
  }
  return () => {
    if (timer) clearTimeout(timer);
    watcher?.close();
  };
}
