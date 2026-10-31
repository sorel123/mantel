/**
 * The live-view pop-over's state, shared so any screen can open it: the doorbell event opens
 * it for 30 seconds, and a tap on a camera tile opens it too.
 */
import { useSyncExternalStore } from 'react';

export interface LiveView {
  cameraId: string;
  name: string;
  reason: 'doorbell' | 'tap';
  /** Epoch ms when it closes by itself. */
  until: number;
  /** Bumps on every open so the view restarts its timer. */
  seq: number;
}

let current: LiveView | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const names = new Map<string, string>();
const set = (next: LiveView | null) => {
  current = next;
  listeners.forEach((l) => l());
};

/** "camera.front_door_live_view" reads as "Front door". */
export function cameraName(id: string): string {
  const known = names.get(id);
  if (known) return known;
  const base = (id.split('.')[1] ?? id).replace(/_(live_view|last_recording|snapshot)$/, '');
  const words = base.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The Home screen tells us the real names once it has loaded them. */
export function rememberCameraNames(cameras: { id: string; name: string }[]) {
  for (const c of cameras) names.set(c.id, c.name);
}

export function openLive(cameraId: string, reason: LiveView['reason'], seconds = 30) {
  const until = Date.now() + seconds * 1000;
  // A ring while someone is already watching that camera keeps the view up, not restarted.
  if (current?.cameraId === cameraId) {
    set({
      ...current,
      reason: reason === 'doorbell' ? reason : current.reason,
      until: Math.max(current.until, until),
    });
    return;
  }
  set({ cameraId, name: cameraName(cameraId), reason, until, seq: ++seq });
}

export function extendLive(seconds = 30) {
  if (current) set({ ...current, until: Math.max(current.until, Date.now()) + seconds * 1000 });
}

export function closeLive() {
  set(null);
}

export function useLiveView(): LiveView | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
