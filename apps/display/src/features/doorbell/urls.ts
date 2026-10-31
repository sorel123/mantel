import { routeUrl } from '@mantel/shared';
import { getStoredKey } from '../../lib/api';

/**
 * `<img>` cannot send the device-key header, so image routes take `?key=` (the server checks
 * either). `t` busts the browser cache for stills.
 */
export function cameraUrl(cameraId: string, kind: 'snapshot' | 'stream', t?: number): string {
  const key = getStoredKey() ?? undefined;
  return routeUrl(
    kind === 'snapshot' ? 'cameraSnapshot' : 'cameraStream',
    { id: cameraId },
    {
      key,
      t: t === undefined ? undefined : String(t),
    },
  );
}

/** Add the device key to a server-relative image URL such as `MediaPlayer.artworkUrl`. */
export function withDeviceKey(url: string): string {
  const key = getStoredKey();
  if (!key) return url;
  return `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`;
}
