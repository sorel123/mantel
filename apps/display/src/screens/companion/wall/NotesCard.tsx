/**
 * The wall's side of notes: the `notes` Today card (newest first, tap one to take it down, a
 * button to leave one), the Ambient line with the newest note, and the sheet that writes or
 * draws a note on the wall itself.
 */
import { useCallback } from 'react';
import { SheetHeader, useOverlay } from '../../../app/overlay';
import { EmptyIcon, EmptyState } from '../../../app/EmptyState';
import { NoteComposer } from '../NoteComposer';
import { ago, useNotes } from '../notes';
import { StickyNote } from '../tabs/NoteTab';
import './wall.css';

/** `open()` slides in the note composer, with the drawing pad first. */
export function useNoteSheet() {
  const { openSheet, toast } = useOverlay();
  const { create } = useNotes();
  return useCallback(
    (startWith: 'text' | 'drawing' = 'drawing') =>
      openSheet(
        (close) => (
          <>
            <SheetHeader title="Note" subtitle="For the wall" onClose={close} />
            <div className="sheet-body">
              <NoteComposer
                wall
                startWith={startWith}
                onCancel={close}
                onPost={async (n) => {
                  await create(n);
                  toast('On the wall.');
                  close();
                }}
              />
            </div>
          </>
        ),
        { label: 'Leave a note', wide: true },
      ),
    [openSheet, create, toast],
  );
}

export function NotesCard() {
  const { notes, remove } = useNotes();
  const { confirm } = useOverlay();
  const open = useNoteSheet();
  const takeDown = async (id: string, text: string) => {
    const ok = await confirm({
      title: 'Take this note down?',
      body: text || 'The drawing goes from every display.',
      confirmLabel: 'Take down',
    });
    if (ok) await remove(id);
  };
  return (
    <div className="card notes-card" aria-label="Notes">
      <div className="head">
        <h2 className="h2">Notes</h2>
        <button className="add" aria-label="Leave a note" onClick={() => open('text')}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
      {!notes || notes.length === 0 ? (
        <div className="notes-empty">
          <EmptyState icon={EmptyIcon.list} compact>
            {notes ? 'Nothing on the wall. Leave a note from a phone or right here.' : 'Loading…'}
          </EmptyState>
          <button type="button" className="btn sm primary" onClick={() => open('text')}>
            Leave a note
          </button>
        </div>
      ) : (
        <div className="notes-stack">
          {notes.slice(0, 4).map((n, i) => (
            <button
              key={n.id}
              type="button"
              className="notes-tap"
              style={{ '--tilt': `${((i % 3) - 1) * 1.2}deg` } as React.CSSProperties}
              aria-label={`${n.text || 'A drawing'}, ${ago(n.createdAt)}. Tap to take down`}
              onClick={() => void takeDown(n.id, n.text)}
            >
              <StickyNote note={n} big={i === 0 && notes.length === 1} />
            </button>
          ))}
          {notes.length > 4 && (
            <span className="muted notes-more">and {notes.length - 4} more</span>
          )}
        </div>
      )}
    </div>
  );
}

/** Ambient's corner: the newest note, in its colour. */
export function AmbientNote() {
  const { notes } = useNotes();
  const n = notes?.[0];
  if (!n) return null;
  return (
    <div className="nx ambient-note">
      Note{n.from || n.personId ? ` · ${ago(n.createdAt)}` : ''}
      <b>{n.text || 'A drawing on the wall'}</b>
    </div>
  );
}
