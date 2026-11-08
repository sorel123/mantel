/**
 * Wall notes in SQLite. Expired notes are dropped whenever the list is read, so nothing has to
 * run on a timer; a note "until dismissed" stays until someone deletes it.
 */
import { randomUUID } from 'node:crypto';
import type { NoteCreateRequest } from '@mantel/shared';
import { sampleNotes, type NoteExpiry, type WallNote } from '@mantel/shared';
import { eq, isNotNull } from 'drizzle-orm';
import type { z } from 'zod';
import { schema, type Db } from '../../db/index.js';
import { dateInZone, isoInZone } from '../../providers/real/weather-time.js';
import { shiftDate, wallIso } from '../import/zone.js';

const { notes } = schema;
type Row = typeof notes.$inferSelect;
type CreateBody = z.output<typeof NoteCreateRequest>;

/** At most this many notes stay up; the oldest goes when another arrives. */
export const MAX_NOTES = 12;

const toNote = (r: Row): WallNote => ({
  id: r.id,
  kind: r.kind,
  text: r.text,
  color: r.color as WallNote['color'],
  ...(r.personId ? { personId: r.personId } : {}),
  ...(r.fromName ? { from: r.fromName } : {}),
  createdAt: r.createdAt,
  expiresAt: r.expiresAt,
  hasImage: !!r.image,
});

/** When a note posted at `now` comes down, as an ISO time in the household's zone. */
export function expiryAt(expiry: NoteExpiry, now: Date, timeZone: string): string | null {
  if (expiry === 'dismiss') return null;
  if (expiry === '24h') return isoInZone(new Date(now.getTime() + 864e5), timeZone);
  return wallIso(shiftDate(dateInZone(now, timeZone), 1), '00:00', timeZone);
}

export class NoteStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date,
    private readonly timeZone: () => string,
  ) {}

  /** Mock mode starts with the sample note so the card and Ambient have something to show. */
  seed(sample = sampleNotes(this.now())) {
    if (this.db.select({ id: notes.id }).from(notes).limit(1).all().length) return;
    for (const n of sample)
      this.db
        .insert(notes)
        .values({
          id: n.id,
          kind: n.kind,
          text: n.text,
          color: n.color,
          personId: n.personId ?? null,
          fromName: n.from ?? null,
          image: null,
          createdAt: n.createdAt,
          expiresAt: n.expiresAt,
        })
        .run();
  }

  private sweep() {
    const now = this.now();
    // Expiry strings carry offsets, so compare as instants rather than text.
    const rows = this.db
      .select({ id: notes.id, expiresAt: notes.expiresAt })
      .from(notes)
      .where(isNotNull(notes.expiresAt))
      .all();
    for (const r of rows)
      if (r.expiresAt && Date.parse(r.expiresAt) <= now.getTime())
        this.db.delete(notes).where(eq(notes.id, r.id)).run();
  }

  /** Newest first. Timestamps carry the home's offset, so compare instants, not strings. */
  private newestFirst<T extends { createdAt: string }>(rows: T[]): T[] {
    return rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  list(): WallNote[] {
    this.sweep();
    return this.newestFirst(this.db.select().from(notes).all()).map(toNote);
  }

  create(body: CreateBody, fromName: string | null): WallNote {
    const now = this.now();
    const id = `note-${randomUUID().slice(0, 8)}`;
    const image =
      body.kind === 'drawing' && body.image
        ? Buffer.from(body.image.slice(body.image.indexOf(',') + 1), 'base64')
        : null;
    const row = {
      id,
      kind: body.kind,
      text: body.text,
      color: body.color,
      personId: body.personId ?? null,
      fromName,
      image,
      createdAt: isoInZone(now, this.timeZone()),
      expiresAt: expiryAt(body.expiry, now, this.timeZone()),
    };
    this.db.insert(notes).values(row).run();
    // Keep the wall tidy: drop the oldest beyond the cap.
    const all = this.newestFirst(
      this.db.select({ id: notes.id, createdAt: notes.createdAt }).from(notes).all(),
    );
    for (const old of all.slice(MAX_NOTES)) this.db.delete(notes).where(eq(notes.id, old.id)).run();
    return toNote(row as Row);
  }

  delete(id: string): boolean {
    return this.db.delete(notes).where(eq(notes.id, id)).run().changes > 0;
  }

  image(id: string): Buffer | null {
    const row = this.db.select({ image: notes.image }).from(notes).where(eq(notes.id, id)).get();
    return row?.image ?? null;
  }

  /** Remove notes whose expiry has passed (for tests). */
  expired(): number {
    const before = this.db.select({ id: notes.id }).from(notes).all().length;
    this.sweep();
    return before - this.db.select({ id: notes.id }).from(notes).all().length;
  }
}
