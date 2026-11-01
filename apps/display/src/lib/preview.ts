/**
 * "Preview on the wall": Settings opens the real display in a new tab with the unsaved
 * choices in its address, so the family sees the actual screens before saving. `look` carries
 * the appearance draft as base64url JSON (a custom skin included); the layout keys are the
 * ones the display already reads (`today`, `month`, `fit`, `scale`).
 */
import { Appearance, type LayoutSettings } from '@mantel/shared';

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export interface PreviewOptions {
  appearance?: Appearance;
  layout?: LayoutSettings;
  screen?: 'today' | 'month' | 'lists' | 'home';
  mode?: 'daylight' | 'dusk';
}

/** The display's address showing these choices, marked as a preview. */
export function previewUrl(opts: PreviewOptions): string {
  const q = new URLSearchParams({ preview: '1' });
  if (opts.screen) q.set('screen', opts.screen);
  if (opts.mode) q.set('mode', opts.mode);
  if (opts.appearance) q.set('look', toBase64Url(JSON.stringify(opts.appearance)));
  if (opts.layout) {
    q.set('today', opts.layout.todayPreset);
    q.set('month', opts.layout.monthPreset);
    q.set('density', opts.layout.monthDensity);
    q.set('rows', opts.layout.todayRows.join(','));
    q.set('fit', opts.layout.fit);
    q.set('scale', String(opts.layout.scale));
  }
  return `/?${q}`;
}

/** The appearance a preview address carries, or null (also for anything malformed). */
export function appearanceFromSearch(search: string): Appearance | null {
  const raw = new URLSearchParams(search).get('look');
  if (!raw) return null;
  try {
    const parsed = Appearance.safeParse(JSON.parse(fromBase64Url(raw)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const isPreview = (search: string) => new URLSearchParams(search).get('preview') === '1';

/** Opens the preview in a new tab (a kiosk without tabs just navigates). */
export function openPreview(opts: PreviewOptions) {
  const url = previewUrl(opts);
  const w = window.open(url, '_blank', 'noopener');
  if (!w) location.href = url;
}
