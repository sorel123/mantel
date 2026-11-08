/**
 * Phone app: where the companion lives (`/app`), how to put it on a home screen, which phones
 * get notifications, and whether Magic Import can read photos. The companion itself is in
 * `screens/companion/`; this is the wall's view of it.
 */
import { PUSH_EVENT_LABELS, type PushSubscriptionInfo } from '@mantel/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { errorText } from '../client';
import { Collapse, CopyRow, RemoveButton, Section, StatusBadge } from '../controls';
import { QrCode } from '../../setup/Qr';

type ImportStatus = { ready: boolean; mock: boolean; model: string; message: string };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'never');

export function CompanionSection() {
  const origin = `${location.origin}/`;
  const appUrl = `${origin}app`;
  const secure =
    location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

  const [subs, setSubs] = useState<PushSubscriptionInfo[] | null>(null);
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([api.call('pushSubscriptions'), api.call('importStatus')]);
      setSubs(p.subscriptions);
      setStatus(s);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);
  useEffect(() => void load(), [load]);

  const forget = async (s: PushSubscriptionInfo) => {
    try {
      await api.call('pushDelete', { params: { id: s.id } });
      setSubs((all) => all?.filter((x) => x.id !== s.id) ?? null);
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Section
      id="companion"
      title="Phone app"
      hint="The family's remote: lists, calendar, meals, chores and notes for the wall, from a phone."
    >
      <div className="set-help-top">
        <div className="set-help-qr">
          <QrCode text={appUrl} size={132} label={`QR code for ${appUrl}`} />
          <span className="set-hint">Scan on a phone</span>
        </div>
        <div className="grow">
          <CopyRow label="The phone app" value={appUrl} />
          <p className="set-hint">
            Each phone pairs once with the admin PIN. The old <code>/add</code> address still works
            and opens the same app.
          </p>
        </div>
      </div>

      <Collapse title="Put it on the home screen" hint="One minute per phone.">
        <ol className="set-steps">
          <li>
            <b>iPhone:</b> open the address in Safari, tap Share, then <b>Add to Home Screen</b>.
            Open Mantel from the new icon.
          </li>
          <li>
            <b>Android:</b> open it in Chrome, tap the menu, then <b>Install app</b> (or Add to Home
            screen).
          </li>
          <li>Pair with the PIN once. The app remembers the phone from then on.</li>
        </ol>
      </Collapse>

      <h3 className="h3">Notifications</h3>
      <p className="set-hint">
        A phone turns notifications on from the bell in the app and picks what it hears about: the
        doorbell, chores, leave-by times, rewards and wall notes. Phones hear about everyone's
        chores but their own.
      </p>
      {!secure && (
        <p className="set-note">
          Notifications need a secure address. Phones can only subscribe when Mantel is opened over{' '}
          <b>https</b> (or on the computer that runs it, as <code>localhost</code>). On an iPhone
          the app must also be on the home screen (iOS 16.4 or later).
        </p>
      )}
      {subs === null ? (
        <p className="set-hint">{error ?? 'Loading…'}</p>
      ) : subs.length === 0 ? (
        <p className="set-hint">No phone has turned notifications on yet.</p>
      ) : (
        <ul className="set-list" aria-label="Phones with notifications">
          {subs.map((s) => (
            <li key={s.id} className="set-row">
              <div className="grow">
                <b>{s.deviceName}</b>
                <span className="set-hint">
                  {s.events.map((e) => PUSH_EVENT_LABELS[e].label).join(', ') || 'Nothing chosen'}
                  {' · last sent '}
                  {when(s.lastSentAt)}
                  {s.lastError ? ` · problem: ${s.lastError}` : ''}
                </span>
              </div>
              <RemoveButton
                label={`Stop notifying ${s.deviceName}`}
                onClick={() => void forget(s)}
              />
            </li>
          ))}
        </ul>
      )}

      <h3 className="h3">Magic Import</h3>
      <div className="set-row">
        <div className="grow">
          <p className="set-hint">
            A photo of a flyer, a schedule or a shopping list becomes events, list items and meals
            to check over before anything is added. It uses the Claude key from{' '}
            <a className="set-link" href="#quips">
              Weather quips
            </a>
            . <b>The photo is sent to Anthropic</b> to be read; it is not kept on this server.
          </p>
        </div>
        {status ? (
          <StatusBadge
            state={status.ready ? 'connected' : 'not_set_up'}
            text={status.ready ? (status.mock ? 'Mock' : 'Ready') : 'Needs a key'}
          />
        ) : (
          <StatusBadge state="pending" />
        )}
      </div>
      {status && !status.ready && <p className="set-hint">{status.message}</p>}
    </Section>
  );
}
