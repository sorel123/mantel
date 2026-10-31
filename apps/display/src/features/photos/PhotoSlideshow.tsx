import type { PhotoRef } from '@mantel/shared';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { PhotoFeed, type LoadedPhoto } from './feed';
import './photos.css';

interface Slide extends LoadedPhoto {
  key: number;
  /** Which of the four drift paths this slide takes. */
  drift: number;
}

const RETRY_EMPTY_MS = 60_000;

/**
 * Full-bleed photos from the server, one every `intervalMs`, cross-dissolving over each other
 * while each drifts slowly (Ken Burns). The dominant colour fills in behind each photo.
 * `onPhoto` reports each new photo, e.g. to tint the ambient clock. With reduced motion the
 * photos swap without fading or drifting.
 */
export function PhotoSlideshow({
  intervalMs = 9000,
  onPhoto,
  feed: feedProp,
}: {
  intervalMs?: number;
  onPhoto?: (photo: PhotoRef | null) => void;
  /** Supply photos from somewhere other than the server (tests, demos). */
  feed?: PhotoFeed;
}) {
  const [slides, setSlides] = useState<Slide[]>([]);
  const onPhotoRef = useRef(onPhoto);
  onPhotoRef.current = onPhoto;

  useEffect(() => {
    const feed = feedProp ?? new PhotoFeed();
    let shown: Slide[] = [];
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let counter = 0;

    const step = async () => {
      const next = await feed.next();
      if (!alive) {
        if (next) feed.release(next.src);
        return;
      }
      if (next) {
        const slide = { ...next, key: counter++, drift: counter % 4 };
        // Keep the outgoing slide underneath while the new one fades in; release the one before it.
        const keep = [...shown.slice(-1), slide];
        shown.slice(0, -1).forEach((s) => feed.release(s.src));
        shown = keep;
        setSlides(keep);
      }
      onPhotoRef.current?.(next?.photo ?? null);
      timer = setTimeout(step, next ? intervalMs : RETRY_EMPTY_MS);
    };
    void step();

    return () => {
      alive = false;
      clearTimeout(timer);
      shown.forEach((s) => feed.release(s.src));
      feed.dispose();
    };
  }, [feedProp, intervalMs]);

  return (
    <div
      className="ph-show"
      style={{ '--ph-hold': `${intervalMs}ms` } as CSSProperties}
      aria-hidden="true"
    >
      {slides.map((s) => (
        <div
          key={s.key}
          className="ph-slide"
          data-drift={s.drift}
          style={{ backgroundColor: s.photo.dominant }}
        >
          <img src={s.src} alt="" draggable={false} />
        </div>
      ))}
    </div>
  );
}
