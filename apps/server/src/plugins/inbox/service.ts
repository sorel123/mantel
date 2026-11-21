/**
 * The capture inbox (v4 K). Every way in (Forward to Mantel, the phone's share sheet, the iPhone
 * Shortcut, a photo, pasted text) calls `capture()`; the item is stored at once and read in the
 * background, and the displays hear `inbox.changed`. Nothing is written to the calendar, lists or
 * meal plan until `commit()`, and a commit can be taken back with `undo()` for a short while.
 */
import {
  ImportCandidates,
  sampleImport,
  sampleInvite,
  sampleNewsletter,
  sampleText,
  type ImportAnalyseResponse,
  type ImportCommitRequest,
  type InboxItem,
  type InboxOriginalKind,
  type WsEventInput,
} from '@mantel/shared';
import sharp from 'sharp';
import { HttpError, notFound } from '../../errors.js';
import { log } from '../../log.js';
import type { Providers } from '../../providers/types.js';
import { dateInZone, isoInZone } from '../../providers/real/weather-time.js';
import type { MealsService } from '../meals/index.js';
import { analyseWithClaude, ImportError, type AnalyseContent } from '../import/claude.js';
import { commitImport, type Created } from '../import/commit.js';
import { readIcs } from '../import/ics.js';
import type { InboxStore, NewCapture } from './store.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** The server keeps Undo a little longer than the ten-second toast. */
export const UNDO_MS = 30_000;
/** Photos are scaled to this before they are stored and read. */
const MAX_EDGE = 2000;

export interface InboxDeps {
  store: InboxStore;
  providers: Pick<Providers, 'calendar' | 'lists'>;
  planner?: MealsService;
  emit: (e: WsEventInput) => void;
  now: () => Date;
  timeZone: () => string;
  people: () => Array<{ id: string; name: string }>;
  /** The Claude key (saved for weather quips), or '' when none. */
  claudeKey: () => string;
  mock: boolean;
  /** Tests replace the reader. */
  read?: (c: CaptureContent) => Promise<ImportAnalyseResponse>;
}

export interface CaptureContent {
  kind: InboxOriginalKind;
  name: string | null;
  mime: string | null;
  text: string | null;
  file: Buffer | null;
  subject: string | null;
  hint: InboxItem['hint'];
}

/** A file as it arrived: bytes and whatever type the sender claimed. */
export interface IncomingFile {
  bytes: Buffer;
  mime?: string | null;
  name?: string | null;
}

/** What kind of original these bytes are, by type, name and the first bytes. */
export function sniff(f: IncomingFile): { kind: InboxOriginalKind; mime: string } | null {
  const head = f.bytes.subarray(0, 16).toString('latin1');
  const name = (f.name ?? '').toLowerCase();
  const mime = (f.mime ?? '').toLowerCase().split(';')[0]!.trim();
  if (head.startsWith('%PDF') || mime === 'application/pdf' || name.endsWith('.pdf'))
    return { kind: 'pdf', mime: 'application/pdf' };
  const start = f.bytes.subarray(0, 200).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (start.startsWith('BEGIN:VCALENDAR') || mime === 'text/calendar' || name.endsWith('.ics'))
    return { kind: 'ics', mime: 'text/calendar' };
  if (head.startsWith('\x89PNG')) return { kind: 'image', mime: 'image/png' };
  if (head.startsWith('\xFF\xD8\xFF')) return { kind: 'image', mime: 'image/jpeg' };
  if (head.startsWith('GIF8')) return { kind: 'image', mime: 'image/gif' };
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP')
    return { kind: 'image', mime: 'image/webp' };
  if (head.slice(4, 8) === 'ftyp') return { kind: 'image', mime: 'image/heic' };
  if (mime.startsWith('image/')) return { kind: 'image', mime };
  if (mime.startsWith('text/') || /\.(txt|md|html?|eml|url|webloc)$/.test(name) || !mime)
    return { kind: 'text', mime: 'text/plain' };
  return null;
}

/** Plain words from HTML (an email body, a shared page). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/** Scale a photo for storing and reading: upright, at most 2000 px, JPEG. */
export async function normalisePhoto(
  bytes: Buffer,
  mime: string,
): Promise<{ bytes: Buffer; mime: string }> {
  try {
    const out = await sharp(bytes, { failOn: 'none' })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { bytes: out, mime: 'image/jpeg' };
  } catch {
    if (mime === 'image/heic' || mime === 'image/heif')
      throw new ImportError(
        'This photo is in the iPhone HEIC format, which Mantel cannot open. Share it as a JPEG (in the Shortcut, add Convert Image to JPEG first), or take a screenshot of it and share that.',
      );
    return { bytes, mime };
  }
}

export class InboxService {
  private readonly undo = new Map<string, { created: Created; until: number }>();
  private readonly reading = new Map<string, Promise<void>>();

  constructor(private readonly d: InboxDeps) {
    // Anything left half-read by a restart is read again.
    for (const id of d.store.stuck()) this.startReading(id);
  }

  get store() {
    return this.d.store;
  }

  list() {
    return { items: this.d.store.list(), pending: this.d.store.pending() };
  }

  pending() {
    return this.d.store.pending();
  }

  /** Waits for the item's reading to finish (tests, and the upload route's reply). */
  settled(id: string): Promise<void> {
    return this.reading.get(id) ?? Promise.resolve();
  }

  canRead(): boolean {
    return this.d.mock || !!this.d.claudeKey();
  }

  /** Text pasted or shared. */
  async captureText(
    text: string,
    meta: Pick<NewCapture, 'source' | 'hint' | 'from' | 'subject' | 'name' | 'dedupeKey'>,
  ): Promise<InboxItem> {
    const clean = text.trim().slice(0, 20_000);
    if (!clean) throw new HttpError('bad_request', 'There was no text to add.');
    return this.add({ ...meta, kind: 'text', text: clean, mime: 'text/plain' });
  }

  /** A photo, PDF or calendar file. */
  async captureFile(
    f: IncomingFile,
    meta: Pick<NewCapture, 'source' | 'hint' | 'from' | 'subject' | 'dedupeKey'>,
  ): Promise<InboxItem> {
    const kind = sniff(f);
    if (!kind)
      throw new HttpError(
        'bad_request',
        'Mantel reads photos, PDFs, calendar files (.ics) and text. That file is none of those.',
      );
    if (kind.kind === 'text') {
      const raw = f.bytes.toString('utf8');
      const text = /<html|<body|<div|<p[ >]/i.test(raw) ? htmlToText(raw) : raw;
      return this.captureText(text, { ...meta, name: f.name ?? null });
    }
    if (kind.kind === 'ics')
      return this.add({
        ...meta,
        kind: 'ics',
        name: f.name ?? 'invite.ics',
        mime: kind.mime,
        file: f.bytes,
      });
    if (kind.kind === 'pdf')
      return this.add({
        ...meta,
        kind: 'pdf',
        name: f.name ?? 'document.pdf',
        mime: kind.mime,
        file: f.bytes,
      });
    // A photo: stored scaled down, so the review sheet and the reader both get a sensible size.
    let photo: { bytes: Buffer; mime: string };
    try {
      photo = await normalisePhoto(f.bytes, kind.mime);
    } catch (err) {
      const item = this.d.store.create({
        ...meta,
        kind: 'image',
        name: f.name ?? null,
        mime: kind.mime,
      });
      this.d.store.setRead(item.id, {
        status: 'failed',
        summary: 'Could not open this photo.',
        error: err instanceof Error ? err.message : String(err),
      });
      this.changed();
      return this.d.store.get(item.id)!;
    }
    return this.add({
      ...meta,
      kind: 'image',
      name: f.name ?? null,
      mime: photo.mime,
      file: photo.bytes,
    });
  }

  private add(c: NewCapture): InboxItem {
    const item = this.d.store.create(c);
    this.startReading(item.id);
    this.changed();
    return item;
  }

  retry(id: string): InboxItem {
    const item = this.d.store.get(id);
    if (!item) throw notFound(`inbox item ${id}`);
    if (item.status === 'added') throw new HttpError('bad_request', 'That was already added.');
    this.d.store.setRead(id, { status: 'reading', summary: 'Reading…' });
    this.startReading(id);
    this.changed();
    return this.d.store.get(id)!;
  }

  dismiss(id: string) {
    this.undo.delete(id);
    if (!this.d.store.delete(id)) throw notFound(`inbox item ${id}`);
    this.changed();
  }

  async commit(id: string, body: ImportCommitRequest) {
    const item = this.d.store.get(id);
    if (!item) throw notFound(`inbox item ${id}`);
    if (item.status === 'added') throw new HttpError('bad_request', 'That was already added.');
    if (item.status === 'reading')
      throw new HttpError('bad_request', 'Still reading this one. Try again in a moment.');
    const result = await commitImport(body, this.d.providers, this.d.timeZone(), this.d.planner);
    const { created, ...out } = result;
    const wrote = created.eventIds.length + created.itemIds.length + created.meals.length;
    if (wrote === 0 && out.problems.length)
      throw new HttpError('upstream_error', out.problems.join(' '));
    const kept = ImportCandidates.parse({
      events: body.events ?? [],
      items: body.items ?? [],
      meals: body.meals ?? [],
    });
    this.d.store.markAdded(id, kept);
    const until = this.d.now().getTime() + UNDO_MS;
    this.undo.set(id, { created, until });
    this.changed();
    return {
      ...out,
      item: this.d.store.get(id)!,
      undoUntil: isoInZone(new Date(until), this.d.timeZone()),
    };
  }

  async undoCommit(id: string) {
    const item = this.d.store.get(id);
    if (!item) throw notFound(`inbox item ${id}`);
    const entry = this.undo.get(id);
    if (!entry || entry.until < this.d.now().getTime())
      throw new HttpError(
        'bad_request',
        'Too late to undo. Change it on the calendar or list instead.',
      );
    this.undo.delete(id);
    const problems: string[] = [];
    let removed = 0;
    for (const eventId of entry.created.eventIds) {
      try {
        await this.d.providers.calendar.deleteEvent(eventId);
        removed++;
      } catch (err) {
        problems.push(`Could not take an event back off the calendar: ${String(err)}`);
      }
    }
    for (const itemId of entry.created.itemIds) {
      try {
        await this.d.providers.lists.deleteItem(itemId);
        removed++;
      } catch (err) {
        problems.push(`Could not take an item back off its list: ${String(err)}`);
      }
    }
    for (const m of entry.created.meals) {
      try {
        await this.d.planner?.plan({ date: m.date, slot: m.slot, title: m.before ?? '' });
        removed++;
      } catch (err) {
        problems.push(`Could not undo the meal on ${m.date}: ${String(err)}`);
      }
    }
    this.d.store.markReady(id);
    this.changed();
    return { item: this.d.store.get(id)!, removed, problems };
  }

  /* ---- reading ---- */

  private startReading(id: string) {
    const run = this.readOne(id).finally(() => this.reading.delete(id));
    this.reading.set(id, run);
  }

  private async readOne(id: string) {
    const row = this.d.store.content(id);
    if (!row) return;
    const c: CaptureContent = {
      kind: row.kind,
      name: row.name,
      mime: row.mime,
      text: row.text,
      file: row.file,
      subject: row.subject,
      hint: row.hint as CaptureContent['hint'],
    };
    try {
      const found = await (this.d.read ?? ((x: CaptureContent) => this.read(x)))(c);
      if (!this.d.store.get(id)) return; // dismissed while reading
      const n = found.events.length + found.items.length + found.meals.length;
      this.d.store.setRead(id, {
        status: 'ready',
        summary: found.summary || (n ? `Found ${n} things to add.` : 'Nothing to add was found.'),
        candidates: { events: found.events, items: found.items, meals: found.meals },
      });
    } catch (err) {
      const message =
        err instanceof ImportError || err instanceof HttpError
          ? err.message
          : 'Could not read this. Try again.';
      if (!(err instanceof ImportError || err instanceof HttpError))
        log.error('inbox: read failed', { err: String(err) });
      if (!this.d.store.get(id)) return;
      this.d.store.setRead(id, { status: 'failed', summary: 'Could not be read.', error: message });
    }
    this.changed();
  }

  /** The real reader: .ics directly, everything else through Claude (or the mock samples). */
  private async read(c: CaptureContent): Promise<ImportAnalyseResponse> {
    const now = this.d.now();
    const tz = this.d.timeZone();
    if (c.kind === 'ics') return readIcs(c.file?.toString('utf8') ?? c.text ?? '', tz, now);
    if (this.d.mock) {
      await new Promise((r) => setTimeout(r, 400));
      const words = `${c.name ?? ''} ${c.subject ?? ''}`;
      if (/newsletter|news/i.test(words) || c.kind === 'pdf') return sampleNewsletter(now);
      if (/invite|party|birthday/i.test(words)) return sampleInvite(now);
      if (c.kind === 'image') return sampleImport(now);
      return sampleText(now);
    }
    const apiKey = this.d.claudeKey();
    if (!apiKey)
      throw new ImportError(
        'Mantel needs a Claude key to read this. Add one in Settings › Weather quips. Calendar files (.ics) work without one.',
      );
    const today = dateInZone(now, tz);
    const lists = await this.d.providers.lists
      .lists()
      .then((r) => r.lists)
      .catch(() => []);
    let content: AnalyseContent;
    if (c.kind === 'image')
      content = {
        kind: 'image',
        dataUrl: `data:${c.mime ?? 'image/jpeg'};base64,${c.file!.toString('base64')}`,
      };
    else if (c.kind === 'pdf')
      content = {
        kind: 'pdf',
        base64: c.file!.toString('base64'),
        ...(c.name ? { name: c.name } : {}),
      };
    else
      content = { kind: 'text', text: c.text ?? '', ...(c.subject ? { subject: c.subject } : {}) };
    return analyseWithClaude({
      apiKey,
      content,
      hint: c.hint,
      today,
      weekday: WEEKDAYS[new Date(`${today}T12:00:00Z`).getUTCDay()]!,
      timeZone: tz,
      people: this.d.people() as Parameters<typeof analyseWithClaude>[0]['people'],
      lists,
    });
  }

  private changed() {
    const pending = this.d.store.pending();
    this.d.emit({ type: 'inbox.changed', payload: { pending } });
    this.d.emit({ type: 'plugin.changed', payload: { id: 'inbox' } });
  }
}
