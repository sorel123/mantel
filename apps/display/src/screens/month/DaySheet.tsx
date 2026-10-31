/**
 * The day sheet: the shell's side sheet (`useOverlay().openSheet`) with the day's events and
 * quick add. Today and Month open it with `useDaySheet()`.
 */
import type { CalendarEvent } from '@mantel/shared';
import { addDays, startOfDay } from '@mantel/shared';
import { useCallback, useEffect, useState } from 'react';
import { SheetHeader, useOverlay } from '../../app/overlay';
import { dayNames, eventsOn, monthNames, useEvents } from '../today/calendar';
import { EventRow, Icon, Svg } from '../today/parts';
import { QuickAdd } from './QuickAdd';

export interface DaySheetOptions {
  /** Open straight on quick add (the + button on Today). */
  add?: boolean;
  /** Called once the sheet has gone, for a selected-day highlight. */
  onClosed?: () => void;
}

/** `open(day)` slides the day sheet in over the panel. */
export function useDaySheet() {
  const { openSheet } = useOverlay();
  return useCallback(
    (day: Date, { add = false, onClosed }: DaySheetOptions = {}) =>
      openSheet(
        (close) => (
          <DaySheetBody day={day} startWithAdd={add} onClose={close} onClosed={onClosed} />
        ),
        { label: `${dayNames[day.getDay()]}, ${monthNames[day.getMonth()]} ${day.getDate()}` },
      ),
    [openSheet],
  );
}

export function DaySheetBody({
  day,
  startWithAdd,
  onClose,
  onClosed,
}: {
  day: Date;
  startWithAdd: boolean;
  onClose: () => void;
  onClosed?: () => void;
}) {
  const from = startOfDay(day);
  const { events, status } = useEvents(from, addDays(from, 1));
  const [adding, setAdding] = useState(startWithAdd);
  const list: CalendarEvent[] = eventsOn(events, day);

  // The sheet unmounts after its exit animation; that is when the caller's highlight goes.
  useEffect(() => () => onClosed?.(), [onClosed]);

  return (
    <>
      <SheetHeader
        title={day.getDate()}
        subtitle={`${dayNames[day.getDay()]}, ${monthNames[day.getMonth()]}`}
        onClose={onClose}
      />
      <div className="cal day-sheet">
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
      </div>
    </>
  );
}
