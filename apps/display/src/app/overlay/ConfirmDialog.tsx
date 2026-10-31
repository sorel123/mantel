import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { EASE, STD, motionOr, useMotionPreference } from '../motion';

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  /** Default "Confirm". */
  confirmLabel?: string;
  /** Default "Cancel". */
  cancelLabel?: string;
  /** Paint the confirm button in the warning colour (unlocking, deleting). */
  danger?: boolean;
}

export function ConfirmDialog({
  options,
  onSettle,
}: {
  options: ConfirmOptions;
  onSettle: (ok: boolean) => void;
}) {
  const reduced = useMotionPreference();
  return (
    <motion.div
      className="dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      data-no-swipe
      initial={{ opacity: 0, x: '-50%', y: '-46%', scale: 0.96 }}
      animate={{ opacity: 1, x: '-50%', y: '-50%', scale: 1 }}
      exit={{ opacity: 0, x: '-50%', y: '-46%', scale: 0.96 }}
      transition={motionOr(reduced, { duration: STD, ease: EASE })}
    >
      <h3 id="confirm-title">{options.title}</h3>
      {options.body && <p>{options.body}</p>}
      <div className="btns">
        <button className="btn" onClick={() => onSettle(false)} autoFocus>
          {options.cancelLabel ?? 'Cancel'}
        </button>
        <button
          className={`btn ${options.danger ? 'danger' : 'primary'}`}
          onClick={() => onSettle(true)}
        >
          {options.confirmLabel ?? 'Confirm'}
        </button>
      </div>
    </motion.div>
  );
}
