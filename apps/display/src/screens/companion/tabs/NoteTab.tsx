/** Leave a note on the wall, and see (or take down) the ones up now. */
import type { WallNote } from '@mantel/shared';
import { useBootstrap } from '../../../lib/bootstrap';
import { NoteComposer } from '../NoteComposer';
import { ago, noteImageUrl, noteStyle, useNotes } from '../notes';

export function NoteTab() {
  const { notes, create, remove } = useNotes();
  return (
    <>
      <header className="ahead">
        <h1 className="h1">Note for the wall</h1>
        <p className="amuted">It shows on the Today screen and in the corner of Ambient.</p>
      </header>
      <section className="card apanel">
        <NoteComposer onPost={create} />
      </section>
      {notes && notes.length > 0 && (
        <section className="card apanel" aria-label="Notes on the wall now">
          <h2 className="h2">On the wall now</h2>
          <ul className="notes-list">
            {notes.map((n) => (
              <li key={n.id}>
                <StickyNote note={n} />
                <button
                  type="button"
                  className="alink"
                  aria-label={`Take down ${n.text || 'the drawing'}`}
                  onClick={() => void remove(n.id)}
                >
                  Take down
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** One sticky note, as the wall and the phone both draw it. */
export function StickyNote({ note, big = false }: { note: WallNote; big?: boolean }) {
  const boot = useBootstrap();
  const who = boot.people.find((p) => p.id === note.personId)?.name ?? note.from;
  return (
    <div className={`sticky${big ? ' big' : ''}`} style={noteStyle(note.color)}>
      {note.kind === 'drawing' && note.hasImage ? (
        <img src={noteImageUrl(note)} alt={note.text || 'A drawing'} className="sticky-img" />
      ) : null}
      {note.text && <p className="sticky-text">{note.text}</p>}
      <span className="sticky-meta">
        {who ? `${who} · ` : ''}
        {ago(note.createdAt)}
      </span>
    </div>
  );
}
