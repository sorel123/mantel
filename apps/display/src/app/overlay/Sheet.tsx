import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { EASE, STD, motionOr, useMotionPreference } from '../motion';

export interface SheetOptions {
  /** 560 px instead of 440 px. */
  wide?: boolean;
  /** Accessible name for the sheet. */
  label?: string;
}

/** Slides in from the right over a scrim. Content is yours; `SheetHeader` is a ready-made top row. */
export function Sheet({
  options,
  onClose,
  children,
}: {
  options: SheetOptions;
  onClose: () => void;
  children: ReactNode;
}) {
  const reduced = useMotionPreference();
  return (
    <motion.aside
      className={`sheet${options.wide ? ' wide' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={options.label ?? 'Details'}
      data-no-swipe
      initial={{ x: '104%' }}
      animate={{ x: 0 }}
      exit={{ x: '104%' }}
      transition={motionOr(reduced, { duration: STD, ease: EASE })}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      {children}
    </motion.aside>
  );
}

/** Big number or title on the left, a round close button on the right. */
export function SheetHeader({
  title,
  subtitle,
  onClose,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="sheet-head">
      <div>
        <div className="display-lg tnum">{title}</div>
        {subtitle && (
          <div className="italic-note" style={{ fontSize: 20, marginTop: 6 }}>
            {subtitle}
          </div>
        )}
      </div>
      <button className="x" aria-label="Close" onClick={onClose}>
        <svg viewBox="0 0 24 24">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
