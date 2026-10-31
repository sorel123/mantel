import { motion } from 'framer-motion';
import { formatClock, useNow } from '../Clock';
import { EASE, SLOW, motionOr, useMotionPreference } from '../motion';

/** Overnight: black, a faint clock, any tap wakes it. */
export function ScreenOff({ onWake }: { onWake: () => void }) {
  const reduced = useMotionPreference();
  const now = useNow(5000);
  return (
    <motion.div
      className="screen-off"
      role="button"
      aria-label="Screen off. Tap to wake"
      tabIndex={0}
      data-no-swipe
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={motionOr(reduced, { duration: SLOW, ease: EASE })}
      onPointerDown={onWake}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onWake()}
    >
      <span className="clock tnum">{formatClock(now)}</span>
    </motion.div>
  );
}
