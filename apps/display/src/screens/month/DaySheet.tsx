/**
 * The day sheet from the mockup: slides in from the right over the whole panel with a scrim,
 * lists the day's events and holds quick add. WS1 is building a shared sheet primitive; this
 * one can move onto it in the integration pass.
 */
import type { CalendarEvent } from '@mantel/shared';
import { addDays, startOfDay } from '@mantel/shared';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { dayNames, eventsOn, monthNames, useEvents } from '../today/calendar';
import { EventRow, Icon, Svg } from '../today/parts';
import { QuickAdd } from './QuickAdd';

const EASE = [0.2, 0.8, 0.2, 1] as const;

/** Render over the whole panel (above the dock), falling back to the body in tests. */
export function Overlay({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => setHost(document.querySelector('.panel') ?? document.body), []);
  return host ? createPortal(children, host) : null;
}

export function DaySheet({
  day,
  startWithAdd = false,
  onClose,
}: {
  day: Date | null;
  startWithAdd?: boolean;
  onClose: () => void;
}) {
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!day) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [day, onClose]);

  return (
    <Overlay>
      <AnimatePresence>
        {day && (
          <motion.div
            key="scrim"
            className="cal-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.32, ease: EASE }}
            onClick={onClose}
          />
        )}
        {day && (
          <motion.aside
            key="sheet"
            className="cal cal-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={`${dayNames[day.getDay()]}, ${monthNames[day.getMonth()]} ${day.getDate()}`}
            initial={{ x: '104%' }}
            animate={{ x: 0 }}
            exit={{ x: '104%' }}
            transition={{ duration: reduce ? 0 : 0.32, ease: EASE }}
          >
            <SheetBody day={day} startWithAdd={startWithAdd} onClose={onClose} />
          </motion.aside>
        )}
      </AnimatePresence>
    </Overlay>
  );
}

function SheetBody({
  day,
  startWithAdd,
  onClose,
}: {
  day: Date;
  startWithAdd: boolean;
  onClose: () => void;
}) {
  const from = startOfDay(day);
  const { events, status } = useEvents(from, addDays(from, 1));
  const [adding, setAdding] = useState(startWithAdd);
  const list: CalendarEvent[] = eventsOn(events, day);

  return (
    <>
      <div className="sh">
        <div>
          <div className="sd tnum">{day.getDate()}</div>
          <div className="swd">
            {dayNames[day.getDay()]}, {monthNames[day.getMonth()]}
          </div>
        </div>
        <button className="x" aria-label="Close" onClick={onClose}>
          <Svg>{Icon.close}</Svg>
        </button>
      </div>
      {adding ? (
        <QuickAdd day={day} onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
      ) : (
        <>
          <div className="list">
            {list.length ? (
              list.map((e) => <EventRow key={e.id} event={e} day={day} />)
            ) : (
              <div className="empty">
                {status === 'loading' ? 'Loading…' : 'Nothing planned. A free day.'}
              </div>
            )}
          </div>
          <button className="addbtn" onClick={() => setAdding(true)}>
            <Svg>{Icon.plus}</Svg> Quick add
          </button>
        </>
      )}
    </>
  );
}
