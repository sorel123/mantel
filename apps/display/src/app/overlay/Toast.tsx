import { AnimatePresence, motion } from 'framer-motion';
import { EASE, STD, motionOr, useMotionPreference } from '../motion';

export interface ToastOptions {
  /** Default 3500 ms. */
  durationMs?: number;
  /** `good` (default), `warn` or `none` for the leading dot. */
  tone?: 'good' | 'warn' | 'none';
  action?: { label: string; onPress: () => void };
}

export interface ToastItem {
  key: number;
  message: string;
  options: ToastOptions;
}

export function Toasts({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (key: number) => void;
  slow: number;
}) {
  const reduced = useMotionPreference();
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.key}
            className="toast"
            layout
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={motionOr(reduced, { duration: STD, ease: EASE })}
            onClick={() => onDismiss(t.key)}
          >
            {t.options.tone !== 'none' && (
              <i className={`dot${t.options.tone === 'warn' ? ' warn' : ''}`} />
            )}
            {t.message}
            {t.options.action && (
              <button
                className="btn"
                onClick={(e) => {
                  e.stopPropagation();
                  t.options.action?.onPress();
                  onDismiss(t.key);
                }}
              >
                {t.options.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
