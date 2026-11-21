import type { DeepLink, Person, SinceLine } from '@mantel/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { EASE, STD, motionOr, useMotionPreference } from '../../app/motion';
import { PluginIcon } from '../plugins';
import type { Since } from './since';
import './digest.css';

const ICON: Record<SinceLine['kind'], string> = {
  'event.added': 'calendar',
  'event.moved': 'calendar',
  'event.removed': 'calendar',
  'list.added': 'box',
  'list.done': 'check',
  'chore.done': 'star',
  'meal.planned': 'leaf',
  'note.posted': 'info',
  'reward.redeemed': 'star',
  'capture.committed': 'bell',
};

/** How long the strip stays after it was shown before it clears itself. */
export const SINCE_AUTO_CLEAR_MS = 45_000;

/**
 * The strip: a row of changes, each a button that jumps to the thing, and a Got it. It clears
 * itself after it has been on screen for a while, or when a line is tapped.
 */
export function SinceStrip({
  since,
  people,
  onOpen,
  autoClearMs = SINCE_AUTO_CLEAR_MS,
  variant = 'wall',
}: {
  since: Since;
  people: Person[];
  onOpen: (link: DeepLink) => void;
  autoClearMs?: number | null;
  variant?: 'wall' | 'phone';
}) {
  const reduced = useMotionPreference();
  const { lines, clear } = since;
  const showing = lines.length > 0;

  useEffect(() => {
    if (!showing || !autoClearMs) return;
    const t = setTimeout(clear, autoClearMs);
    return () => clearTimeout(t);
  }, [showing, autoClearMs, clear, lines.length]);

  return (
    <AnimatePresence>
      {showing && (
        <motion.aside
          key="since"
          className={`since since-${variant}`}
          aria-label="Since you last looked"
          data-testid="since-strip"
          data-no-swipe
          initial={{ opacity: 0, y: variant === 'wall' ? 16 : -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: variant === 'wall' ? 16 : -8 }}
          transition={motionOr(reduced, { duration: STD, ease: EASE })}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="eyebrow since-label">Since you last looked</span>
          <ul className="since-lines">
            <AnimatePresence initial={false}>
              {lines.map((l) => {
                const person = people.find((p) => p.id === l.personId);
                return (
                  <motion.li
                    key={l.key}
                    layout
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={motionOr(reduced, { duration: STD, ease: EASE })}
                  >
                    <button
                      type="button"
                      className="since-line"
                      style={person ? ({ '--pc': person.color } as React.CSSProperties) : undefined}
                      onClick={() => {
                        onOpen(l.link);
                        clear();
                      }}
                    >
                      <span className={`since-ic${person ? ' person' : ''}`}>
                        {person ? person.initial : <PluginIcon name={ICON[l.kind]} />}
                      </span>
                      <span className="since-text">{l.text}</span>
                    </button>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
          <button type="button" className="btn since-ok" onClick={clear}>
            Got it
          </button>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
