import { createApiClient } from '@mantel/shared';

const KEY_STORAGE = 'mantel.deviceKey';

export const getStoredKey = () => localStorage.getItem(KEY_STORAGE);
export const storeKey = (key: string | null) =>
  key ? localStorage.setItem(KEY_STORAGE, key) : localStorage.removeItem(KEY_STORAGE);

/** The one API client. Same-origin: Vite proxies `/api` and `/ws` in dev; the server serves the display in production. */
export const api = createApiClient({ baseUrl: '', deviceKey: getStoredKey() });

export function setDeviceKey(key: string | null) {
  storeKey(key);
  api.setDeviceKey(key);
}
