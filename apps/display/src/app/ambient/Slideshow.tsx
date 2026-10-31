import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { EASE, useMotionPreference } from '../motion';
import type { SlidePhoto } from './placeholders';

/**
 * Cross-dissolves through `photos` with a slow Ken Burns drift. The next image is preloaded so
 * the dissolve never shows a blank frame; the backdrop takes each photo's dominant colour.
 */
export function Slideshow({
  photos,
  intervalMs = 9000,
  dissolveMs = 1600,
  startIndex = 0,
  onChange,
}: {
  photos: SlidePhoto[];
  intervalMs?: number;
  dissolveMs?: number;
  startIndex?: number;
  onChange?: (index: number) => void;
}) {
  const reduced = useMotionPreference();
  const [index, setIndex] = useState(startIndex);
  const count = photos.length;
  const photo = count ? photos[index % count] : undefined;

  useEffect(() => {
    if (count < 2) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % count), intervalMs);
    return () => clearInterval(t);
  }, [count, intervalMs]);

  useEffect(() => {
    onChange?.(index);
    const next = photos[(index + 1) % Math.max(count, 1)];
    if (next && !next.url.startsWith('data:')) {
      const img = new Image();
      img.src = next.url;
    }
  }, [index, photos, count, onChange]);

  return (
    <div
      className="slideshow"
      style={{ '--slide-bg': photo?.dominant ?? '#000' } as React.CSSProperties}
    >
      <AnimatePresence initial={false}>
        {photo && (
          <motion.div
            key={`${index}-${photo.url.slice(0, 64)}`}
            className={`slide${reduced ? '' : ` drift${index % 2 ? ' alt' : ''}`}`}
            style={{ backgroundImage: `url("${photo.url}")` }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : dissolveMs / 1000, ease: EASE }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
