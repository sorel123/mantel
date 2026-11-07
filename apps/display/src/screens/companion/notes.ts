import type { NoteColor, NoteCreateRequest, WallNote } from '@mantel/shared';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { api } from '../../lib/api';
import { useServerEvent } from '../../lib/events';

/** Sticky-note colours as skin tokens, so every look keeps them readable. */
export const noteStyle = (color: NoteColor): CSSProperties =>
  ({ '--note': `var(--note-${color})` }) as CSSProperties;

export const NOTE_COLOR_NAMES: Record<NoteColor, string> = {
  sun: 'Yellow',
  rose: 'Pink',
  sky: 'Blue',
  mint: 'Green',
  paper: 'White',
};

/** Wall notes, refreshed on `notes.changed`. */
export function useNotes() {
  const [notes, setNotes] = useState<WallNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api
      .call('notes')
      .then((r) => {
        setNotes(r.notes);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);
  useEffect(load, [load]);
  useServerEvent('notes.changed', load);

  const create = async (body: NoteCreateRequest) => {
    const { note } = await api.call('noteCreate', { body });
    setNotes((n) => (n && !n.some((x) => x.id === note.id) ? [note, ...n] : n));
    return note;
  };
  const remove = async (id: string) => {
    setNotes((n) => n?.filter((x) => x.id !== id) ?? n);
    await api.call('noteDelete', { params: { id } }).catch(load);
  };
  return { notes, error, reload: load, create, remove };
}

/** `/api/notes/:id/image?key=` for an `<img>`. */
export const noteImageUrl = (note: WallNote) =>
  api.url('noteImage', { id: note.id }, api.deviceKey ? { key: api.deviceKey } : undefined);

/** "2 min ago", "Yesterday", for the note's corner. */
export function ago(iso: string, now = new Date()): string {
  const mins = Math.round((now.getTime() - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Yesterday' : `${days} days ago`;
}
