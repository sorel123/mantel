/**
 * Magic Import: a photo of a flyer, schedule, list or menu becomes things to add. The photo is
 * read by Claude on the server (only when a key is set), every candidate is shown with a
 * checkbox and editable fields, and nothing is written until Add is pressed.
 *
 * Used on the companion's Calendar and Lists tabs and in a sheet on the wall.
 */
import type {
  ImportAnalyseResponse,
  ImportCommitResponse,
  ImportEvent,
  ImportHint,
  ImportItem,
  ImportMeal,
  ResponseOf,
} from '@mantel/shared';
import { ApiRequestError } from '@mantel/shared';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { api } from '../../lib/api';
import { useBootstrap } from '../../lib/bootstrap';
import { readPhoto } from './image';

type Status = ResponseOf<'importStatus'>;

type Picked<T> = T & { keep: boolean };
interface Draft {
  summary: string;
  events: Picked<ImportEvent>[];
  items: Picked<ImportItem>[];
  meals: Picked<ImportMeal>[];
}

type Step =
  | { kind: 'pick' }
  | { kind: 'reading'; preview: string }
  | { kind: 'review'; preview: string; draft: Draft }
  | { kind: 'done'; result: ImportCommitResponse }
  | { kind: 'error'; message: string; preview?: string };

/** Whether this server can read a photo right now. */
export function useImportStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    api
      .call('importStatus')
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);
  return status;
}

const draftFrom = (r: ImportAnalyseResponse): Draft => ({
  summary: r.summary,
  events: r.events.map((e) => ({ ...e, keep: true })),
  items: r.items.map((i) => ({ ...i, keep: true })),
  meals: r.meals.map((m) => ({ ...m, keep: true })),
});

const prettyDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

export function MagicImport({
  hint = 'auto',
  onDone,
  compact = false,
}: {
  hint?: ImportHint;
  /** Called after a commit, with what was created. */
  onDone?: (result: ImportCommitResponse) => void;
  /** Just the camera button; the rest opens in place once a photo is picked. */
  compact?: boolean;
}) {
  const boot = useBootstrap();
  const status = useImportStatus();
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [busy, setBusy] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let image: string;
    try {
      image = await readPhoto(file);
    } catch (err) {
      setStep({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      return;
    }
    setStep({ kind: 'reading', preview: image });
    try {
      const found = await api.call('importAnalyse', { body: { image, hint } });
      setStep({ kind: 'review', preview: image, draft: draftFrom(found) });
    } catch (err) {
      setStep({
        kind: 'error',
        preview: image,
        message:
          err instanceof ApiRequestError
            ? err.message
            : 'Could not reach Mantel. Check the connection and try again.',
      });
    }
  };

  const commit = async (draft: Draft) => {
    setBusy(true);
    try {
      const result = await api.call('importCommit', {
        body: {
          events: draft.events.filter((e) => e.keep).map(({ keep: _k, ...e }) => e),
          items: draft.items.filter((i) => i.keep).map(({ keep: _k, ...i }) => i),
          meals: draft.meals.filter((m) => m.keep).map(({ keep: _k, ...m }) => m),
        },
      });
      setStep({ kind: 'done', result });
      onDone?.(result);
    } catch (err) {
      setStep({
        kind: 'error',
        message: err instanceof ApiRequestError ? err.message : 'Could not save. Try again.',
      });
    } finally {
      setBusy(false);
    }
  };

  const inputs = (
    <>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => void onFile(e)}
        data-testid="import-camera"
      />
      <input
        ref={library}
        type="file"
        accept="image/*,.heic,.heif"
        hidden
        onChange={(e) => void onFile(e)}
        data-testid="import-file"
      />
    </>
  );

  if (step.kind === 'pick') {
    const ready = status?.ready ?? false;
    return (
      <div className={`mi mi-pick${compact ? ' compact' : ''}`}>
        {inputs}
        {!compact && (
          <div className="mi-lead">
            <h2 className="h2">Read a photo</h2>
            <p className="amuted">
              Snap a school flyer, a team schedule, a menu or a shopping list. Mantel reads it and
              shows you what to add before anything is saved.
            </p>
          </div>
        )}
        <div className="mi-buttons">
          <button
            type="button"
            className="abtn"
            disabled={!ready}
            onClick={() => camera.current?.click()}
          >
            <Cam /> Take a photo
          </button>
          <button
            type="button"
            className="abtn ghost"
            disabled={!ready}
            onClick={() => library.current?.click()}
          >
            Choose a photo
          </button>
        </div>
        {status && !status.ready && (
          <p className="mi-note" role="status">
            {status.message}{' '}
            <a href="/settings#quips" target="_blank" rel="noreferrer">
              Open Settings
            </a>
          </p>
        )}
        {status?.ready && !status.mock && (
          <p className="mi-note">
            The photo is sent to Anthropic (Claude) to be read, then deleted. Nothing is saved until
            you press Add.
          </p>
        )}
      </div>
    );
  }

  if (step.kind === 'reading')
    return (
      <div className="mi mi-reading" role="status" aria-live="polite">
        <img src={step.preview} alt="" className="mi-preview" />
        <div className="mi-spin" aria-hidden />
        <p>Reading the photo…</p>
      </div>
    );

  if (step.kind === 'error')
    return (
      <div className="mi mi-error">
        {step.preview && <img src={step.preview} alt="" className="mi-preview small" />}
        <p role="alert">{step.message}</p>
        <button type="button" className="abtn" onClick={() => setStep({ kind: 'pick' })}>
          Try another photo
        </button>
      </div>
    );

  if (step.kind === 'done') {
    const r = step.result;
    const bits = [
      r.events.length && `${r.events.length} event${r.events.length === 1 ? '' : 's'}`,
      r.items && `${r.items} list item${r.items === 1 ? '' : 's'}`,
      r.meals && `${r.meals} meal${r.meals === 1 ? '' : 's'}`,
    ].filter(Boolean);
    return (
      <div className="mi mi-done" role="status">
        <div className="mi-check" aria-hidden>
          ✓
        </div>
        <h2 className="h2">{bits.length ? `Added ${bits.join(', ')}` : 'Nothing added'}</h2>
        {r.problems.map((p) => (
          <p key={p} className="mi-problem">
            {p}
          </p>
        ))}
        <button type="button" className="abtn ghost" onClick={() => setStep({ kind: 'pick' })}>
          Read another photo
        </button>
      </div>
    );
  }

  const { draft, preview } = step;
  const set = (next: Draft) => setStep({ kind: 'review', preview, draft: next });
  const kept =
    draft.events.filter((e) => e.keep).length +
    draft.items.filter((i) => i.keep).length +
    draft.meals.filter((m) => m.keep).length;
  const upd = <K extends 'events' | 'items' | 'meals'>(
    key: K,
    i: number,
    patch: Partial<Draft[K][number]>,
  ) =>
    set({
      ...draft,
      [key]: draft[key].map((x, j) => (j === i ? { ...x, ...patch } : x)),
    });

  return (
    <div className="mi mi-review">
      <div className="mi-head">
        <img src={preview} alt="The photo" className="mi-preview small" />
        <div>
          <h2 className="h2">Check what was found</h2>
          <p className="amuted">{draft.summary}</p>
        </div>
      </div>

      {draft.events.length > 0 && (
        <section className="mi-group" aria-label="Events found">
          <div className="eyebrow">Calendar</div>
          {draft.events.map((e, i) => (
            <div key={i} className={`mi-row${e.keep ? '' : ' off'}`}>
              <button
                type="button"
                role="checkbox"
                aria-checked={e.keep}
                aria-label={`Add ${e.title}`}
                className={`cb${e.keep ? ' on' : ''}`}
                onClick={() => upd('events', i, { keep: !e.keep })}
              >
                <svg viewBox="0 0 24 24">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </button>
              <div className="mi-fields">
                <input
                  className="ainput"
                  value={e.title}
                  aria-label="Event title"
                  onChange={(ev) => upd('events', i, { title: ev.target.value })}
                />
                <div className="mi-inline">
                  <input
                    type="date"
                    className="ainput"
                    value={e.date}
                    aria-label="Date"
                    onChange={(ev) =>
                      ev.target.value && upd('events', i, { date: ev.target.value })
                    }
                  />
                  {e.allDay ? (
                    <button
                      type="button"
                      className="achip"
                      onClick={() => upd('events', i, { allDay: false, start: '09:00' })}
                    >
                      All day
                    </button>
                  ) : (
                    <>
                      <input
                        type="time"
                        className="ainput"
                        value={e.start ?? '09:00'}
                        aria-label="Start time"
                        onChange={(ev) =>
                          ev.target.value && upd('events', i, { start: ev.target.value })
                        }
                      />
                      <input
                        type="time"
                        className="ainput"
                        value={e.end ?? ''}
                        aria-label="End time"
                        onChange={(ev) => upd('events', i, { end: ev.target.value || undefined })}
                      />
                    </>
                  )}
                </div>
                <input
                  className="ainput"
                  value={e.location ?? ''}
                  placeholder="Where (optional)"
                  aria-label="Place"
                  onChange={(ev) => upd('events', i, { location: ev.target.value || undefined })}
                />
                {boot.people.length > 0 && (
                  <div className="achips" role="group" aria-label="Who">
                    {boot.people.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="achip"
                        aria-pressed={e.personIds.includes(p.id)}
                        aria-checked={e.personIds.includes(p.id)}
                        onClick={() =>
                          upd('events', i, {
                            personIds: e.personIds.includes(p.id)
                              ? e.personIds.filter((x) => x !== p.id)
                              : [...e.personIds, p.id],
                          })
                        }
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
                {e.notes && <small className="amuted">{e.notes}</small>}
              </div>
            </div>
          ))}
        </section>
      )}

      {draft.items.length > 0 && (
        <section className="mi-group" aria-label="List items found">
          <div className="eyebrow">Lists</div>
          {draft.items.map((it, i) => (
            <div key={i} className={`mi-row${it.keep ? '' : ' off'}`}>
              <button
                type="button"
                role="checkbox"
                aria-checked={it.keep}
                aria-label={`Add ${it.text}`}
                className={`cb${it.keep ? ' on' : ''}`}
                onClick={() => upd('items', i, { keep: !it.keep })}
              >
                <svg viewBox="0 0 24 24">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </button>
              <div className="mi-fields row">
                <input
                  className="ainput"
                  value={it.text}
                  aria-label="Item"
                  onChange={(ev) => upd('items', i, { text: ev.target.value })}
                />
                <select
                  className="ainput"
                  value={it.listId ?? `new:${it.listName}`}
                  aria-label="List"
                  onChange={(ev) => {
                    const v = ev.target.value;
                    if (v.startsWith('new:'))
                      upd('items', i, { listId: undefined, listName: v.slice(4) });
                    else upd('items', i, { listId: v, listName: v });
                  }}
                >
                  {!it.listId && <option value={`new:${it.listName}`}>{it.listName} (new)</option>}
                  <ListOptions />
                </select>
              </div>
            </div>
          ))}
        </section>
      )}

      {draft.meals.length > 0 && (
        <section className="mi-group" aria-label="Meals found">
          <div className="eyebrow">Meals</div>
          {draft.meals.map((m, i) => (
            <div key={i} className={`mi-row${m.keep ? '' : ' off'}`}>
              <button
                type="button"
                role="checkbox"
                aria-checked={m.keep}
                aria-label={`Add ${m.title}`}
                className={`cb${m.keep ? ' on' : ''}`}
                onClick={() => upd('meals', i, { keep: !m.keep })}
              >
                <svg viewBox="0 0 24 24">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </button>
              <div className="mi-fields row">
                <input
                  className="ainput"
                  value={m.title}
                  aria-label="Meal"
                  onChange={(ev) => upd('meals', i, { title: ev.target.value })}
                />
                <span className="mi-when">
                  {m.slot === 'dinner'
                    ? 'Dinner'
                    : m.slot === 'lunch'
                      ? 'Lunch'
                      : m.slot === 'breakfast'
                        ? 'Breakfast'
                        : 'Meal'}{' '}
                  {prettyDate(m.date)}
                </span>
              </div>
            </div>
          ))}
        </section>
      )}

      {kept === 0 && draft.events.length + draft.items.length + draft.meals.length === 0 && (
        <p className="amuted">Nothing on this photo looked like an event, a list or a meal.</p>
      )}

      <div className="mi-actions">
        <button type="button" className="abtn ghost" onClick={() => setStep({ kind: 'pick' })}>
          Start over
        </button>
        <button
          type="button"
          className="abtn"
          disabled={kept === 0 || busy}
          onClick={() => void commit(draft)}
        >
          {busy ? 'Adding…' : `Add ${kept} ${kept === 1 ? 'thing' : 'things'}`}
        </button>
      </div>
    </div>
  );
}

/** The household's lists, for the item picker. */
function ListOptions() {
  const [lists, setLists] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    api
      .call('lists')
      .then((r) => setLists(r.lists))
      .catch(() => setLists([]));
  }, []);
  return (
    <>
      {lists.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </>
  );
}

export function Cam() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="mi-cam">
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
