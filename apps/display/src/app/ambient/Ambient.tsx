import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { formatClock, formatLongDate, useNow } from '../Clock';
import { EASE, SLOW, motionOr, useMotionPreference } from '../motion';
import { PhotoSlideshow } from '../../features/photos';
import type { SlidePhoto } from './placeholders';
import { Slideshow } from './Slideshow';
import { renderSlot, useAmbientSlots } from './slots';

/**
 * Full-bleed photo slideshow (the server's album through WS4's `PhotoSlideshow`, or the given
 * placeholder photos) with the time, the date and whatever features registered beside it.
 * Fades in and out over 700 ms. Any tap wakes the display.
 */
export function Ambient({
  onWake,
  photos,
  aside,
  hint = 'Tap to wake',
}: {
  onWake: () => void;
  /** Show these instead of the server's album (demo page, tests). */
  photos?: SlidePhoto[];
  /** Override the registered slots (demo page). */
  aside?: ReactNode;
  hint?: string | null;
}) {
  const reduced = useMotionPreference();
  const now = useNow(5000);
  const slots = useAmbientSlots();
  return (
    <motion.div
      className="ambient"
      role="button"
      aria-label="Ambient mode. Tap to wake"
      tabIndex={0}
      data-no-swipe
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={motionOr(reduced, { duration: SLOW, ease: EASE })}
      onPointerDown={onWake}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onWake()}
    >
      {photos ? <Slideshow photos={photos} /> : <PhotoSlideshow />}
      <div className="veil" />
      {hint && <div className="hint">{hint}</div>}
      <div className="a-clock">
        <b className="tnum">{formatClock(now)}</b>
        <span>{formatLongDate(now)}</span>
      </div>
      <div className="a-side">{aside ?? slots.map(renderSlot)}</div>
    </motion.div>
  );
}
