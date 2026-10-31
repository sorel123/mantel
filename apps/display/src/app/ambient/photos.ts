import { useSyncExternalStore } from 'react';
import { placeholderPhotos, type SlidePhoto } from './placeholders';

/**
 * The photos Ambient shows. Starts as generated placeholders; a feature (WS4's shared-album
 * reader) calls `setAmbientPhotos` with real ones and Ambient picks them up on its next slide.
 */
let photos: SlidePhoto[] = placeholderPhotos();
const listeners = new Set<() => void>();

export function setAmbientPhotos(next: SlidePhoto[]) {
  photos = next.length ? next : placeholderPhotos();
  listeners.forEach((l) => l());
}

export function useAmbientPhotos(): SlidePhoto[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => photos,
    () => photos,
  );
}
