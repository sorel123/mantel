import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { EASE, STD, motionOr, useMotionPreference } from '../motion';

export interface PopoverOptions {
  /** Close by itself after this long; a progress bar shows the time left. */
  durationMs?: number;
  /** Dim the screen behind it (default true). */
  scrim?: boolean;
  /** Tapping the scrim closes it (default true). */
  dismissOnScrim?: boolean;
  /** Accessible name. */
  label?: string;
}

/**
 * A large centred card over any screen. Content is yours; `PopoverHeader` gives a title row with a
 * close button and `pop-media` / `pop-body` classes lay out a video with text under it.
 */
export function Popover({
  options,
  onClose,
  children,
}: {
  options: PopoverOptions;
  onClose: () => void;
  children: ReactNode;
}) {
  const reduced = useMotionPreference();
  return (
    <motion.div
      className="popover"
      role="dialog"
      aria-modal="true"
      aria-label={options.label ?? 'Notification'}
      data-no-swipe
      initial={{ opacity: 0, x: '-50%', y: '-46%', scale: 0.96 }}
      animate={{ opacity: 1, x: '-50%', y: '-50%', scale: 1 }}
      exit={{ opacity: 0, x: '-50%', y: '-47%', scale: 0.98 }}
      transition={motionOr(reduced, { duration: STD, ease: EASE })}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      {children}
      {options.durationMs && (
        <div className="pop-timer" aria-hidden="true">
          <motion.i
            initial={{ scaleX: 1 }}
            animate={{ scaleX: 0 }}
            transition={{ duration: options.durationMs / 1000, ease: 'linear' }}
          />
        </div>
      )}
    </motion.div>
  );
}

export function PopoverHeader({
  eyebrow,
  title,
  onClose,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="pop-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2 className="h2">{title}</h2>
      </div>
      <div className="row">
        {children}
        <button className="btn icon sm" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
