/**
 * v4 workstream L: "Share this list with…". Each Mantel list can be kept in step with one list
 * in Apple Reminders (through the Mac helper), Todoist or a Home Assistant to-do list, both
 * ways. Mounted under Lists and chores (`/settings#lists`) by `Optional.tsx`.
 */
import {
  LIST_SYNC_NAMES,
  type List,
  type ListLink,
  type ListSyncProviderId,
  type ListSyncResponse,
  type RemoteList,
} from '@mantel/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../lib/api';
import { errorText } from '../client';
import { Collapse, CopyRow, StatusBadge } from '../controls';
import './lists.css';

const ORDER: ListSyncProviderId[] = ['reminders', 'todoist', 'ha-todo'];
const BLURB: Record<ListSyncProviderId, string> = {
  reminders: 'iPhone, iPad and Mac. Siri adds here.',
  todoist: 'A Todoist project.',
  'ha-todo': 'Google Tasks, Bring!, AnyList, Alexa and more.',
};

const badge = (l: ListLink) =>
  l.state === 'ok'
    ? ('connected' as const)
    : l.state === 'error'
      ? ('error' as const)
      : ('pending' as const);
const badgeText: Record<ListLink['state'], string> = {
  ok: 'In step',
  syncing: 'Syncing',
  waiting: 'Waiting',
  error: 'Problem',
};

export function ListSharingSection() {
  const [lists, setLists] = useState<List[] | null>(null);
  const [sync, setSync] = useState<ListSyncResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([api.call('lists'), api.call('listSync')]);
      setLists(l.lists);
      setSync(s);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);
  useEffect(() => {
    void load();
    // Keep the status fresh while Settings is open (the Mac helper checks in every few seconds).
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    setNote(null);
    try {
      await fn();
      if (done) setNote(done);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
      void load();
    }
  };

  const linkOf = (listId: string) => sync?.links.find((l) => l.listId === listId);

  return (
    <section className="set-sec card ls-sec" id="list-sharing" aria-labelledby="list-sharing-title">
      <div className="set-sec-head">
        <div>
          <h2 className="h2" id="list-sharing-title">
            Share lists with other apps
          </h2>
          <p className="set-hint">
            Keep a list in step with Apple Reminders, Todoist or a Home Assistant to-do list. Ticks,
            adds and renames go both ways.
          </p>
        </div>
      </div>

      <div className="ls-explain">
        <p>
          <strong>Why not Apple Notes?</strong> Notes has no way for other apps to read or change a
          note, so nothing can stay in step with it. Apple Reminders is the Apple route: it syncs
          over iCloud to every iPhone, iPad and Mac, and shared family lists work too.
        </p>
        <p>
          <strong>Hey Siri, add milk to Groceries.</strong> Siri adds to Reminders, so once your
          Groceries list is shared here it lands on the wall a few seconds later, with nothing else
          to set up. Alexa reaches the wall the same way through Home Assistant’s Alexa lists.
        </p>
      </div>

      {error && (
        <p className="set-err" role="alert">
          {error}
        </p>
      )}
      {note && (
        <p className="set-result good" role="status">
          {note}
        </p>
      )}

      <div className="ls-rows">
        {!lists &&
          [0, 1, 2].map((i) => <div key={i} className="skeleton ls-skel" aria-hidden="true" />)}
        {lists && lists.length === 0 && (
          <p className="empty">No lists yet. Add one above, then share it here.</p>
        )}
        {lists?.map((l) => {
          const link = linkOf(l.id);
          return (
            <div className="ls-row" key={l.id}>
              <div className="ls-head">
                <div className="grow">
                  <div className="ls-name">{l.name}</div>
                  {link ? (
                    <div className="ls-link">
                      <span className="ls-arrows" aria-hidden="true">
                        ⇄
                      </span>{' '}
                      {LIST_SYNC_NAMES[link.provider]} · <strong>{link.remoteName}</strong>
                      <StatusBadge state={badge(link)} text={badgeText[link.state]} />
                      <div className="set-hint">{link.summary}</div>
                    </div>
                  ) : (
                    <div className="set-hint">Only on Mantel</div>
                  )}
                </div>
                {link ? (
                  <>
                    <button
                      type="button"
                      className="set-btn"
                      disabled={busy !== null}
                      onClick={() =>
                        void act(
                          `sync-${l.id}`,
                          () => api.call('listSyncNow', { params: { id: l.id } }),
                          `${l.name} synced.`,
                        )
                      }
                    >
                      {busy === `sync-${l.id}` ? 'Syncing…' : 'Sync now'}
                    </button>
                    <button
                      type="button"
                      className="set-btn quiet"
                      disabled={busy !== null}
                      onClick={() =>
                        void act(
                          `unlink-${l.id}`,
                          () => api.call('listUnlink', { params: { id: l.id } }),
                          `${l.name} is no longer shared. Both lists keep their items.`,
                        )
                      }
                    >
                      Stop sharing
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="set-btn primary"
                    aria-expanded={picking === l.id}
                    onClick={() => setPicking(picking === l.id ? null : l.id)}
                  >
                    Share this list with…
                  </button>
                )}
              </div>
              {picking === l.id && sync && (
                <Picker
                  list={l}
                  sync={sync}
                  onCancel={() => setPicking(null)}
                  onPick={(provider, remote) => {
                    setPicking(null);
                    void act(
                      `link-${l.id}`,
                      () =>
                        api.call('listLink', {
                          params: { id: l.id },
                          body: { provider, remoteListId: remote.id, remoteName: remote.name },
                        }),
                      `${l.name} is now shared with ${LIST_SYNC_NAMES[provider]} “${remote.name}”.`,
                    );
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      <MacHelp sync={sync} />
    </section>
  );
}

function Picker({
  list,
  sync,
  onPick,
  onCancel,
}: {
  list: List;
  sync: ListSyncResponse;
  onPick: (provider: ListSyncProviderId, remote: RemoteList) => void;
  onCancel: () => void;
}) {
  const providers = ORDER.map((id) => sync.providers.find((p) => p.id === id)!).filter(Boolean);
  const [provider, setProvider] = useState<ListSyncProviderId>(
    providers.find((p) => p.ready)?.id ?? 'reminders',
  );
  const [remote, setRemote] = useState<RemoteList[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const info = providers.find((p) => p.id === provider)!;
  const taken = new Set(
    sync.links.filter((l) => l.provider === provider).map((l) => l.remoteListId),
  );
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Newer browsers return a promise from scrollIntoView; an effect must not return it.
    void ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, []);

  useEffect(() => {
    setRemote(null);
    setError(null);
    if (!info.ready) return;
    let live = true;
    api
      .call('listSyncRemote', { params: { provider } })
      .then((r) => live && setRemote(r.lists))
      .catch((err: unknown) => live && setError(errorText(err)));
    return () => {
      live = false;
    };
  }, [provider, info.ready]);

  return (
    <div className="ls-picker" ref={ref} role="group" aria-label={`Share ${list.name} with`}>
      <div className="ls-services">
        {providers.map((p) => (
          <button
            key={p.id}
            type="button"
            className="ls-service"
            aria-pressed={p.id === provider}
            onClick={() => setProvider(p.id)}
          >
            <span className="ls-service-name">{p.name}</span>
            <span className="ls-service-blurb">{BLURB[p.id]}</span>
            <span
              className={`ls-dot${p.ready ? ' on' : ''}`}
              aria-label={p.ready ? 'Ready' : 'Needs setting up'}
            />
          </button>
        ))}
      </div>

      {!info.ready ? (
        <div className="ls-setup">
          <p>{info.summary}</p>
          <a className="set-btn" href={info.setup}>
            Set up {info.name}
          </a>
        </div>
      ) : error ? (
        <p className="set-err">{error}</p>
      ) : !remote ? (
        <div className="ls-remote">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton ls-skel" aria-hidden="true" />
          ))}
        </div>
      ) : remote.length === 0 ? (
        <p className="empty">{info.name} has no lists yet. Make one there, then come back.</p>
      ) : (
        <>
          <p className="set-hint">
            Pick the {info.name} list to keep in step with {list.name}. Items on both are merged;
            ones with the same name are matched, not copied twice.
          </p>
          <div className="ls-remote">
            {remote.map((r) => (
              <button
                key={r.id}
                type="button"
                className="ls-remote-btn"
                disabled={taken.has(r.id)}
                onClick={() => onPick(provider, r)}
              >
                <span className="ls-name">{r.name}</span>
                {(taken.has(r.id) || r.detail) && (
                  <span className="set-hint">
                    {taken.has(r.id) ? 'Already shared with another list' : r.detail}
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="set-row">
        <button type="button" className="set-btn quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Setting up the Mac helper, and the Shortcuts recipe for households without a Mac. */
function MacHelp({ sync }: { sync: ListSyncResponse | null }) {
  const [code, setCode] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reminders = sync?.providers.find((p) => p.id === 'reminders');
  const origin = location.origin;

  const showCode = () =>
    api
      .call('pairingCode')
      .then((r) => setCode(r.code))
      .catch((err: unknown) => setError(errorText(err)));
  const makeKey = async () => {
    try {
      const { code: c } = await api.call('pairingCode');
      const r = await api.call('pair', { body: { code: c, name: 'Reminders Shortcut' } });
      setKey(r.deviceKey);
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div className="ls-help">
      <Collapse
        title="Apple Reminders on a Mac"
        hint={reminders?.ready ? reminders.summary : 'Two minutes to set up'}
        open={
          !!reminders && !reminders.ready && !!sync?.links.some((l) => l.provider === 'reminders')
        }
      >
        <ol className="ls-steps">
          <li>
            Download <strong>MantelReminders-mac.zip</strong> from the{' '}
            <a
              href="https://github.com/sorel123/mantel/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
            >
              latest release
            </a>{' '}
            on the Mac and drag <em>Mantel Reminders</em> into Applications.
          </li>
          <li>
            The first time, right-click it and choose <strong>Open</strong>, then Open again. It
            isn’t notarised by Apple yet, so a double-click is refused once.
          </li>
          <li>
            Allow access to Reminders, then enter this address and a pairing code:
            <CopyRow label="Mantel address" value={origin} />
            {code ? (
              <div className="set-row">
                <span className="set-code">{code}</span>
                <span className="set-hint">Valid for 15 minutes</span>
              </div>
            ) : (
              <button type="button" className="set-btn" onClick={() => void showCode()}>
                Show a pairing code
              </button>
            )}
          </li>
          <li>
            Turn on <strong>Open at login</strong> in its menu. It syncs while the Mac is awake;
            changes made meanwhile catch up when it wakes.
          </li>
        </ol>
      </Collapse>
      <Collapse
        title="No Mac? Use a Shortcut (one way)"
        hint="Reminders to Mantel, every hour or so"
      >
        <p className="set-hint">
          An iPhone Shortcuts automation can send a Reminders list to Mantel on a schedule. It only
          goes one way: new reminders are added here, and ones that left Reminders are ticked here.
          Changes on the wall don’t go back.
        </p>
        <ol className="ls-steps">
          <li>
            Make a key for the Shortcut:{' '}
            {key ? (
              <CopyRow label="Key (keep it private)" value={key} />
            ) : (
              <button type="button" className="set-btn" onClick={() => void makeKey()}>
                Make a key
              </button>
            )}
          </li>
          <li>
            In Shortcuts, add <em>Find Reminders</em> where List is your list and Is Completed is
            off, then <em>Get Details of Reminders</em> › Title.
          </li>
          <li>
            Add <em>Get Contents of URL</em>: method POST, this address, header{' '}
            <code>x-mantel-device-key</code> with the key, and a JSON body with <code>list</code>{' '}
            (the Mantel list’s name) and <code>items</code> (the titles).
            <CopyRow label="Address" value={`${origin}/api/lists/sync/shortcut`} />
          </li>
          <li>
            In Automation, run it every hour, or when you leave or arrive home. Turn off Ask Before
            Running.
          </li>
        </ol>
        {error && <p className="set-err">{error}</p>}
      </Collapse>
    </div>
  );
}
