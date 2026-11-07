/**
 * What the Today screen's + button offers now: an event (quick add, as before), a note or a
 * drawing for the wall, or a photo to read with Magic Import (the tablet's camera).
 */
import { useCallback } from 'react';
import { SheetHeader, useOverlay } from '../../../app/overlay';
import { MagicImport } from '../MagicImport';
import { useNoteSheet } from './NotesCard';
import './wall.css';

export function useAddMenu(onEvent: () => void) {
  const { openSheet, closeSheet, toast } = useOverlay();
  const openNote = useNoteSheet();
  const openImport = useCallback(
    () =>
      openSheet(
        (close) => (
          <>
            <SheetHeader
              title="Photo"
              subtitle="Read a flyer, a schedule or a list"
              onClose={close}
            />
            <div className="sheet-body wall-import">
              <MagicImport
                onDone={(r) => {
                  const n = r.events.length + r.items + r.meals;
                  if (n) toast(`Added ${n} ${n === 1 ? 'thing' : 'things'}.`);
                }}
              />
            </div>
          </>
        ),
        { label: 'Read a photo', wide: true },
      ),
    [openSheet, toast],
  );

  return useCallback(
    () =>
      openSheet(
        (close) => (
          <>
            <SheetHeader title="Add" subtitle="What would you like to add?" onClose={close} />
            <div className="sheet-body add-menu">
              <button
                type="button"
                className="add-choice"
                onClick={() => {
                  closeSheet();
                  // Let the sheet close before the day sheet replaces it.
                  setTimeout(onEvent, 0);
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />
                </svg>
                <span>
                  <b>An event</b>
                  <small>On the family calendar</small>
                </span>
              </button>
              <button type="button" className="add-choice" onClick={() => openNote('text')}>
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M5 4h14v11l-5 5H5zM14 20v-5h5M8 9h8M8 13h5" />
                </svg>
                <span>
                  <b>A note</b>
                  <small>Words for the wall</small>
                </span>
              </button>
              <button type="button" className="add-choice" onClick={() => openNote('drawing')}>
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M4 20l4-1 11-11-3-3L5 16zM14 7l3 3" />
                </svg>
                <span>
                  <b>A drawing</b>
                  <small>Draw with a finger</small>
                </span>
              </button>
              <button type="button" className="add-choice" onClick={openImport}>
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                  <circle cx="12" cy="13" r="3.5" />
                </svg>
                <span>
                  <b>A photo of a flyer</b>
                  <small>Mantel reads the dates and lists off it</small>
                </span>
              </button>
            </div>
          </>
        ),
        { label: 'Add' },
      ),
    [openSheet, closeSheet, onEvent, openNote, openImport],
  );
}
