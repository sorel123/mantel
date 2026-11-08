/** The phone's own settings: notifications on or off, which events, whose phone this is. */
import { PUSH_EVENT_LABELS, PushEventKind } from '@mantel/shared';
import { useState } from 'react';
import { useBootstrap } from '../../lib/bootstrap';
import { Avatar } from '../lists/Avatar';
import { DEFAULT_EVENTS, SUPPORT_TEXT, usePush } from './push';

export function NotificationsSheet({ onClose }: { onClose: () => void }) {
  const boot = useBootstrap();
  const push = usePush();
  const [result, setResult] = useState<string | null>(null);
  const [events, setEvents] = useState<PushEventKind[]>(DEFAULT_EVENTS);
  const [personId, setPersonId] = useState<string | null>(null);
  const on = !!push.mine;
  const chosen = push.mine?.events ?? events;
  const whose = push.mine ? push.mine.personId : personId;

  const toggleEvent = (k: PushEventKind) => {
    const next = chosen.includes(k) ? chosen.filter((x) => x !== k) : [...chosen, k];
    if (push.mine) void push.update({ events: next });
    else setEvents(next);
  };
  const choosePerson = (id: string | null) => {
    if (push.mine) void push.update({ personId: id });
    else setPersonId(id);
  };

  return (
    <div className="csheet-scrim" onClick={onClose}>
      <section
        className="csheet card"
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="arow">
          <h2 className="h2">Notifications</h2>
          <button type="button" className="ax" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        {!push.support.ok ? (
          <p className="amuted">{SUPPORT_TEXT[push.support.reason]}</p>
        ) : (
          <div className="arow">
            <span>
              <b>{on ? 'On for this phone' : 'Off'}</b>
              <br />
              <small className="amuted">
                {on ? 'Mantel can reach this phone.' : 'The doorbell, chores and leave-by times.'}
              </small>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label="Notifications"
              className={`sw${on ? ' on' : ''}`}
              disabled={push.busy || push.mine === undefined}
              onClick={() => (on ? void push.disable() : void push.enable(events, personId))}
            />
          </div>
        )}
        {push.error && (
          <p className="qa-err" role="alert">
            {push.error}
          </p>
        )}

        <div className="eyebrow">Tell me about</div>
        <ul className="litems">
          {PushEventKind.options.map((k) => (
            <li key={k} className="aitem">
              <button
                type="button"
                className={`litem${chosen.includes(k) ? ' done' : ''}`}
                role="checkbox"
                aria-checked={chosen.includes(k)}
                onClick={() => toggleEvent(k)}
              >
                <span className="cb">
                  <svg viewBox="0 0 24 24">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                </span>
                <span className="tx plain">
                  {PUSH_EVENT_LABELS[k].label}
                  <small className="amuted"> {PUSH_EVENT_LABELS[k].hint}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>

        {boot.people.length > 0 && (
          <>
            <div className="eyebrow">Whose phone is this?</div>
            <p className="amuted small">Your own chores do not buzz you.</p>
            <div className="achips" role="radiogroup" aria-label="Whose phone">
              <button
                type="button"
                role="radio"
                aria-checked={!whose}
                className="achip"
                onClick={() => choosePerson(null)}
              >
                Shared
              </button>
              {boot.people.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={whose === p.id}
                  className="achip"
                  onClick={() => choosePerson(p.id)}
                >
                  <Avatar person={p} size="sm" />
                  {p.name}
                </button>
              ))}
            </div>
          </>
        )}

        {on && (
          <div className="arow">
            <button
              type="button"
              className="abtn small ghost"
              onClick={() => void push.test().then((r) => setResult(r.message))}
            >
              Send a test
            </button>
            <span className="amuted small" role="status">
              {result}
            </span>
          </div>
        )}
        <p className="amuted small">
          {boot.device?.name ? `This phone is paired as "${boot.device.name}". ` : ''}
          Manage paired phones in{' '}
          <a href="/settings#displays" target="_blank" rel="noreferrer">
            Settings › Displays
          </a>
          .
        </p>
      </section>
    </div>
  );
}
