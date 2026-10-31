import { useSyncExternalStore, type ComponentType } from 'react';

/**
 * What Ambient shows beside the clock: weather now (WS4), the next event (WS2)... Features
 * register a small component; Ambient renders them stacked, bottom right. Nothing is registered
 * by the shell itself.
 */
export interface AmbientSlot {
  id: string;
  Component: ComponentType;
  /** Lower renders first (higher up). Default 0. */
  order?: number;
}

let slots: AmbientSlot[] = [];
const listeners = new Set<() => void>();

export function registerAmbientSlot(slot: AmbientSlot): () => void {
  slots = [...slots.filter((s) => s.id !== slot.id), slot].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  listeners.forEach((l) => l());
  return () => {
    slots = slots.filter((s) => s.id !== slot.id);
    listeners.forEach((l) => l());
  };
}

export function useAmbientSlots(): AmbientSlot[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => slots,
    () => slots,
  );
}
