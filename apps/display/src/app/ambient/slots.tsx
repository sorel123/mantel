import { Component, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';

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

/** Renders a slot and swallows its errors, so one feature cannot take Ambient down. */
export class SlotBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

export const renderSlot = (slot: AmbientSlot) => (
  <SlotBoundary key={slot.id}>
    <slot.Component />
  </SlotBoundary>
);
