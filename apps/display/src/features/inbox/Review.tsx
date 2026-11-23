/**
 * The review for one inbox item: the original beside what was read from it. Every candidate is
 * checked and editable (title, date, time, who, which list); Add all, Add selected and Dismiss.
 * The same component runs on the wall (side by side, in the inbox pop-over) and on a phone
 * (stacked, in the companion's Inbox tab).
 */
import type {
  ImportEvent,
  ImportItem,
  ImportMeal,
  InboxCommitResponse,
  InboxItem,
  MealSlot,
} from '@mantel/shared';
import { ApiRequestError } from '@mantel/shared';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';
import { EASE, FAST, STD, motionOr, useMotionPreference } from '../../app/motion';
import { api } from '../../lib/api';
import { useBootstrap } from '../../lib/bootstrap';
import { dropItem, foundCount, itemTitle, originalUrl, patchItem, timeAgo } from './store';
import { SourceIcon } from './icons';

type Picked<T> = T & { keep: boolean };
interface Draft {
  events: Picked<ImportEvent>[];
  items: Picked<ImportItem>[];
  meals: Picked<ImportMeal>[];
}

const draftOf = (item: InboxItem): Draft => ({
  events: item.candidates.events.map((e) => ({ ...e, keep: true })),
  items: item.candidates.items.map((i) => ({ ...i, keep: true })),
  meals: item.candidates.meals.map((m) => ({ ...m, keep: true })),
});

const strip = <T,>(xs: Picked<T>[], all: boolean): T[] =>
  xs.filter((x) => all || x.keep).map(({ keep: _k, ...x }) => x as T);

const SLOTS: Array<{ id: MealSlot; label: string }> = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'other', label: 'Other' },
];

/** The household's lists for the item picker, fetched once. */
let listCache: Array<{ id: string; name: string }> | null = null;
function useLists() {
  const [lists, setLists] = useState(listCache ?? []);
  useEffect(() => {
    if (listCache) return;
    api
      .call('lists')
      .then((r) => {
        listCache = r.lists.map((l) => ({ id: l.id, name: l.name }));
        setLists(listCache);
      })
      .catch(() => setLists([]));
  }, []);
  return lists;
}

export function InboxReview({
  item,
  layout,
  onCommitted,
  onDismissed,
}: {
  item: InboxItem;
  layout: 'wall' | 'phone';
  onCommitted: (r: InboxCommitResponse) => void;
  onDismissed: (item: InboxItem) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(item));
  const [busy, setBusy] = useState<'add' | 'all' | 'dismiss' | 'retry' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A new item, or this one finished reading: start from what was found.
  const fresh = `${item.id}:${item.status}`;
  useEffect(() => {
    setDraft(draftOf(item));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh]);

  const total = draft.events.length + draft.items.length + draft.meals.length;
  const kept =
    draft.events.filter((e) => e.keep).length +
    draft.items.filter((i) => i.keep).length +
    draft.meals.filter((m) => m.keep).length;

  const commit = async (all: boolean) => {
    setBusy(all ? 'all' : 'add');
    setError(null);
    try {
      const result = await api.call('inboxCommit', {
        params: { id: item.id },
        body: {
          events: strip(draft.events, all),
          items: strip(draft.items, all),
          meals: strip(draft.meals, all),
        },
      });
      onCommitted(result);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not reach Mantel. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async () => {
    setBusy('dismiss');
    try {
      await api.call('inboxDelete', { params: { id: item.id } });
      dropItem(item.id);
      onDismissed(item);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not reach Mantel. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const retry = async () => {
    setBusy('retry');
    try {
      patchItem((await api.call('inboxRetry', { params: { id: item.id } })).item);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not reach Mantel.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className={`ibx-review ${layout}`} aria-label={`Review ${itemTitle(item)}`}>
      <header className="ibx-rhead">
        <SourceIcon source={item.source} kind={item.original.kind} />
        <div className="grow">
          <h2 className="h3 ibx-title">{itemTitle(item)}</h2>
          <p className="muted ibx-sub">
            {[item.from, timeAgo(item.createdAt)].filter(Boolean).join(' · ')}
          </p>
        </div>
      </header>

      <div className="ibx-split">
        <Original item={item} layout={layout} />

        <div className="ibx-found">
          {item.status === 'reading' ? (
            <Reading />
          ) : item.status === 'failed' ? (
            <div className="ibx-failed" role="alert">
              <p>{item.error ?? 'Could not read this.'}</p>
              <button
                type="button"
                className="btn sm"
                disabled={!!busy}
                onClick={() => void retry()}
              >
                {busy === 'retry' ? 'Trying…' : 'Try again'}
              </button>
            </div>
          ) : (
            <>
              <p className="ibx-summary">{item.summary}</p>
              {total === 0 && (
                <p className="empty">Nothing here looked like an event, a list item or a meal.</p>
              )}
              <Candidates draft={draft} setDraft={setDraft} />
            </>
          )}
          {error && (
            <p className="ibx-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>

      <footer className="ibx-actions">
        <button
          type="button"
          className="btn ghost"
          disabled={!!busy}
          onClick={() => void dismiss()}
        >
          {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
        </button>
        <span className="grow" />
        {item.status === 'ready' && total > 0 && (
          <>
            {kept < total && (
              <button
                type="button"
                className="btn"
                disabled={!!busy || kept === 0}
                onClick={() => void commit(false)}
              >
                {busy === 'add' ? 'Adding…' : `Add selected (${kept})`}
              </button>
            )}
            <button
              type="button"
              className="btn primary"
              disabled={!!busy}
              onClick={() => void commit(true)}
            >
              {busy === 'all' ? 'Adding…' : total === 1 ? 'Add it' : `Add all ${total}`}
            </button>
          </>
        )}
      </footer>
    </article>
  );
}

function Reading() {
  return (
    <div className="ibx-reading" role="status" aria-live="polite">
      <p className="ibx-summary">Reading it now…</p>
      {[0, 1, 2].map((i) => (
        <div key={i} className="ibx-skel">
          <span className="skeleton" style={{ width: 28, height: 28 }} />
          <span className="skeleton grow" style={{ height: 18 }} />
        </div>
      ))}
    </div>
  );
}

function Original({ item, layout }: { item: InboxItem; layout: 'wall' | 'phone' }) {
  const [open, setOpen] = useState(layout === 'wall');
  const o = item.original;
  const url = originalUrl(item);
  let body: ReactNode;
  if (o.kind === 'image')
    body = <img className="ibx-img" src={url} alt={`The original: ${o.name ?? 'photo'}`} />;
  else if (o.kind === 'pdf')
    body = (
      <div className="ibx-pdf">
        {layout === 'wall' && (
          <div className="ibx-pdf-frame">
            <div className="ibx-pdf-cover">
              <SourceIcon source={item.source} kind="pdf" />
              <b>{o.name ?? 'A PDF'}</b>
              <span>{Math.max(1, Math.round(o.size / 1024))} KB</span>
            </div>
            <iframe title={`The original: ${o.name ?? 'PDF'}`} src={`${url}#toolbar=0&view=FitH`} />
          </div>
        )}
        <a className="btn sm ghost" href={url} target="_blank" rel="noreferrer">
          Open the PDF
        </a>
      </div>
    );
  else if (o.kind === 'ics')
    body = (
      <div className="ibx-doc">
        <SourceIcon source={item.source} kind="ics" />
        <p>
          <b>{o.name ?? 'Calendar file'}</b>
          <br />
          <span className="muted">A calendar file, read directly.</span>
        </p>
      </div>
    );
  else body = <pre className="ibx-text">{o.text}</pre>;

  if (layout === 'phone' && o.kind !== 'image')
    return (
      <section className="ibx-orig" aria-label="The original">
        <button
          type="button"
          className="ibx-orig-toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Hide the original' : 'Show the original'}
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: STD, ease: EASE }}
              style={{ overflow: 'hidden' }}
            >
              {body}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    );
  return (
    <section className="ibx-orig" aria-label="The original">
      {body}
    </section>
  );
}

function Check({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      className={`cb${on ? ' on' : ''}`}
      onClick={onToggle}
    >
      <svg viewBox="0 0 24 24">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </button>
  );
}

function Row({ on, children }: { on: boolean; children: ReactNode }) {
  const reduced = useMotionPreference();
  return (
    <motion.div
      className={`ibx-row${on ? '' : ' off'}`}
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={motionOr(reduced, { duration: FAST, ease: EASE })}
    >
      {children}
    </motion.div>
  );
}

function Candidates({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft) => void }) {
  const boot = useBootstrap();
  const lists = useLists();
  const upd = <K extends keyof Draft>(key: K, i: number, patch: Partial<Draft[K][number]>) =>
    setDraft({ ...draft, [key]: draft[key].map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  return (
    <>
      {draft.events.length > 0 && (
        <section className="ibx-group" aria-label="Events found">
          <div className="eyebrow">Calendar</div>
          {draft.events.map((e, i) => (
            <Row key={i} on={e.keep}>
              <Check
                on={e.keep}
                label={`Add ${e.title}`}
                onToggle={() => upd('events', i, { keep: !e.keep })}
              />
              <div className="ibx-fields">
                <input
                  className="input"
                  value={e.title}
                  aria-label="Event title"
                  onChange={(ev) => upd('events', i, { title: ev.target.value })}
                />
                <div className="ibx-inline">
                  <input
                    type="date"
                    className="input"
                    value={e.date}
                    aria-label="Date"
                    onChange={(ev) =>
                      ev.target.value && upd('events', i, { date: ev.target.value })
                    }
                  />
                  {e.allDay ? (
                    <button
                      type="button"
                      className="chip neutral ibx-allday"
                      aria-label="All day. Tap to set a time"
                      onClick={() =>
                        upd('events', i, {
                          allDay: false,
                          start: '09:00',
                          end: undefined,
                          endDate: undefined,
                        })
                      }
                    >
                      All day
                    </button>
                  ) : (
                    <>
                      <input
                        type="time"
                        className="input"
                        value={e.start ?? '09:00'}
                        aria-label="Start time"
                        onChange={(ev) =>
                          ev.target.value && upd('events', i, { start: ev.target.value })
                        }
                      />
                      <input
                        type="time"
                        className="input"
                        value={e.end ?? ''}
                        aria-label="End time"
                        onChange={(ev) => upd('events', i, { end: ev.target.value || undefined })}
                      />
                      <button
                        type="button"
                        className="btn sm quiet"
                        onClick={() =>
                          upd('events', i, { allDay: true, start: undefined, end: undefined })
                        }
                      >
                        All day
                      </button>
                    </>
                  )}
                </div>
                {e.endDate && e.allDay && (
                  <small className="muted">Until {pretty(e.endDate)}</small>
                )}
                <input
                  className="input"
                  value={e.location ?? ''}
                  placeholder="Where (optional)"
                  aria-label="Place"
                  onChange={(ev) => upd('events', i, { location: ev.target.value || undefined })}
                />
                {boot.people.length > 0 && (
                  <div className="ibx-people" role="group" aria-label="Who">
                    {boot.people.map((p) => {
                      const on = e.personIds.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className="ibx-person"
                          aria-pressed={on}
                          style={{ ['--pc' as string]: p.color }}
                          onClick={() =>
                            upd('events', i, {
                              personIds: on
                                ? e.personIds.filter((x) => x !== p.id)
                                : [...e.personIds, p.id],
                            })
                          }
                        >
                          {p.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                {e.notes && <small className="muted">{e.notes}</small>}
              </div>
            </Row>
          ))}
        </section>
      )}

      {draft.items.length > 0 && (
        <section className="ibx-group" aria-label="List items found">
          <div className="eyebrow">Lists</div>
          {draft.items.map((it, i) => (
            <Row key={i} on={it.keep}>
              <Check
                on={it.keep}
                label={`Add ${it.text}`}
                onToggle={() => upd('items', i, { keep: !it.keep })}
              />
              <div className="ibx-fields ibx-pair">
                <input
                  className="input"
                  value={it.text}
                  aria-label="Item"
                  onChange={(ev) => upd('items', i, { text: ev.target.value })}
                />
                <select
                  className="input"
                  value={it.listId ?? `new:${it.listName}`}
                  aria-label="List"
                  onChange={(ev) => {
                    const v = ev.target.value;
                    if (v.startsWith('new:'))
                      upd('items', i, { listId: undefined, listName: v.slice(4) });
                    else
                      upd('items', i, {
                        listId: v,
                        listName: lists.find((l) => l.id === v)?.name ?? v,
                      });
                  }}
                >
                  {!it.listId && (
                    <option value={`new:${it.listName}`}>{it.listName} (new list)</option>
                  )}
                  {it.listId && !lists.some((l) => l.id === it.listId) && (
                    <option value={it.listId}>{it.listName}</option>
                  )}
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
            </Row>
          ))}
        </section>
      )}

      {draft.meals.length > 0 && (
        <section className="ibx-group" aria-label="Meals found">
          <div className="eyebrow">Meals</div>
          {draft.meals.map((m, i) => (
            <Row key={i} on={m.keep}>
              <Check
                on={m.keep}
                label={`Add ${m.title}`}
                onToggle={() => upd('meals', i, { keep: !m.keep })}
              />
              <div className="ibx-fields">
                <input
                  className="input"
                  value={m.title}
                  aria-label="Meal"
                  onChange={(ev) => upd('meals', i, { title: ev.target.value })}
                />
                <div className="ibx-inline">
                  <input
                    type="date"
                    className="input"
                    value={m.date}
                    aria-label="Meal date"
                    onChange={(ev) => ev.target.value && upd('meals', i, { date: ev.target.value })}
                  />
                  <select
                    className="input"
                    value={m.slot}
                    aria-label="Meal"
                    onChange={(ev) => upd('meals', i, { slot: ev.target.value as MealSlot })}
                  >
                    {SLOTS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </Row>
          ))}
        </section>
      )}
    </>
  );
}

const pretty = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
};

/** One row in a list of inbox items. */
export function InboxRow({
  item,
  selected,
  onOpen,
}: {
  item: InboxItem;
  selected?: boolean;
  onOpen: () => void;
}) {
  const n = foundCount(item);
  return (
    <button
      type="button"
      className={`ibx-item${selected ? ' selected' : ''}`}
      aria-current={selected ? 'true' : undefined}
      onClick={onOpen}
    >
      <SourceIcon source={item.source} kind={item.original.kind} />
      <span className="ibx-item-text">
        <b>{itemTitle(item)}</b>
        <small className="muted">
          {[item.from, timeAgo(item.createdAt)].filter(Boolean).join(' · ')}
        </small>
      </span>
      <span className={`ibx-badge ${item.status}`}>
        {item.status === 'reading'
          ? 'Reading…'
          : item.status === 'failed'
            ? 'Could not read'
            : item.status === 'added'
              ? 'Added'
              : n
                ? `${n} to add`
                : 'Nothing found'}
      </span>
    </button>
  );
}
