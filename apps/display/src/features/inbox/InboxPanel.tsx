/**
 * The inbox on the wall: a large card over any screen, opened from the inbox chip in the dock.
 * Waiting items down the left, the review of the chosen one on the right. After an Add or a
 * Dismiss the next item opens by itself; the last one leaves "All caught up".
 */
import type { InboxCommitResponse, InboxItem } from '@mantel/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { EmptyState } from '../../app/EmptyState';
import { EASE, STD, motionOr, useMotionPreference } from '../../app/motion';
import { useOverlay } from '../../app/overlay';
import { InboxReview, InboxRow } from './Review';
import { useInbox, useUndo } from './store';

export function InboxPanel({ close }: { close: () => void }) {
  const { waiting, loaded, error } = useInbox();
  const overlay = useOverlay();
  const undo = useUndo(overlay.toast);
  const reduced = useMotionPreference();
  const [chosen, setChosen] = useState<string | null>(null);

  // Keep a valid selection as items arrive, are added or are dismissed.
  const current = waiting.find((i) => i.id === chosen) ?? waiting[0] ?? null;
  useEffect(() => {
    if (current && current.id !== chosen) setChosen(current.id);
  }, [current, chosen]);

  const next = (done: InboxItem) => {
    const rest = waiting.filter((i) => i.id !== done.id);
    const at = waiting.findIndex((i) => i.id === done.id);
    setChosen(rest[Math.min(at, rest.length - 1)]?.id ?? null);
  };
  const committed = (r: InboxCommitResponse) => {
    next(r.item);
    undo(r);
  };

  return (
    <div className="ibx-panel">
      <header className="ibx-phead">
        <div>
          <div className="eyebrow">Inbox</div>
          <h2 className="h2">
            {!loaded
              ? 'Inbox'
              : waiting.length
                ? `${waiting.length} thing${waiting.length === 1 ? '' : 's'} to check`
                : 'All caught up'}
          </h2>
        </div>
        <button type="button" className="btn icon" aria-label="Close" onClick={close}>
          <svg viewBox="0 0 24 24">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      {!loaded ? (
        <div className="ibx-pbody">
          <div className="ibx-rail">
            {[0, 1].map((i) => (
              <div key={i} className="skeleton" style={{ height: 72 }} />
            ))}
          </div>
          <div className="skeleton grow" style={{ minHeight: 320 }} />
        </div>
      ) : error && !waiting.length ? (
        <p className="ibx-error" role="alert">
          {error}
        </p>
      ) : !current ? (
        <EmptyState
          icon={
            <svg viewBox="0 0 24 24">
              <path d="M3 13h5l1.5 3h5L16 13h5" />
              <path d="M5.5 5h13L21 13v6H3v-6z" />
            </svg>
          }
          action="Ways to send things in"
          section="capture"
        >
          Nothing waiting. Forward an email, share from a phone, or snap a flyer in the phone app,
          and it shows up here to check.
        </EmptyState>
      ) : (
        <div className="ibx-pbody">
          {waiting.length > 1 && (
            <nav className="ibx-rail" aria-label="Waiting in the inbox">
              {waiting.map((i) => (
                <InboxRow
                  key={i.id}
                  item={i}
                  selected={i.id === current.id}
                  onOpen={() => setChosen(i.id)}
                />
              ))}
            </nav>
          )}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={current.id}
              className="ibx-pmain"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={motionOr(reduced, { duration: STD, ease: EASE })}
            >
              <InboxReview
                item={current}
                layout="wall"
                onCommitted={committed}
                onDismissed={(i) => {
                  next(i);
                  overlay.toast('Dismissed.');
                }}
              />
            </motion.div>
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
