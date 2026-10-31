import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { formatClock, formatLongDate, useNow } from '../Clock';
import { EASE, SLOW, motionOr, useMotionPreference } from '../motion';
import type { SlidePhoto } from './placeholders';
import { useAmbientPhotos } from './photos';
import { Slideshow } from './Slideshow';
import { useAmbientSlots } from './slots';

/**
 * Full-bleed photo slideshow with the time, the date and whatever features registered beside it.
 * Fades in and out over 700 ms. Any tap wakes the display.
 */
export function Ambient({
  onWake,
  photos,
  aside,
  hint = 'Tap to wake',
}: {
  onWake: () => void;
  /** Override the shared photo store (demo page). */
  photos?: SlidePhoto[];
  /** Override the registered slots (demo page). */
  aside?: ReactNode;
  hint?: string | null;
}) {
  const reduced = useMotionPreference();
  const now = useNow(5000);
  const shared = useAmbientPhotos();
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
      <Slideshow photos={photos ?? shared} />
      <div className="veil" />
      {hint && <div className="hint">{hint}</div>}
      <div className="a-clock">
        <b className="tnum">{formatClock(now)}</b>
        <span>{formatLongDate(now)}</span>
      </div>
      <div className="a-side">{aside ?? slots.map((s) => <s.Component key={s.id} />)}</div>
    </motion.div>
  );
}
