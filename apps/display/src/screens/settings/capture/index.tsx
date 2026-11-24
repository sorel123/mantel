/**
 * Capture (v4 K): every way something reaches the inbox. Forward to Mantel (a mailbox Mantel
 * checks, and who may send to it), share from a phone (Android's share sheet, and the iPhone
 * "Send to Mantel" Shortcut with its URL and key), and whether text, photos and PDFs can be read.
 */
import type {
  InboxStatusResponse,
  IntegrationStatus,
  PluginManifest,
  Settings,
} from '@mantel/shared';
import { createApiClient } from '@mantel/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { errorText } from '../client';
import { Collapse, CopyRow, Section, StatusBadge, TextInput } from '../controls';
import { IntegrationCard } from '../Integrations';
import './capture.css';

const HEADER = 'x-mantel-device-key';

export function CaptureSection({
  draft,
  set,
}: {
  draft: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  const [status, setStatus] = useState<InboxStatusResponse | null>(null);
  const [mail, setMail] = useState<{ manifest: PluginManifest; status?: IntegrationStatus } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [s, p, i] = await Promise.all([
        api.call('inboxStatus'),
        api.call('plugins'),
        api.call('integrations'),
      ]);
      setStatus(s);
      const manifest = p.plugins.find((m) => m.id === 'mailin');
      if (manifest) setMail({ manifest, status: i.integrations.find((x) => x.id === 'mailin') });
    } catch (err) {
      setError(errorText(err));
    }
  }, []);
  useEffect(() => void load(), [load]);

  const people = draft.people;
  const setEmail = (id: string, email: string) =>
    set(
      'people',
      people.map((p) => (p.id === id ? { ...p, email: email.trim() || undefined } : p)),
    );

  return (
    <Section
      id="capture"
      title="Capture"
      hint="Get school newsletters, invitations and appointments onto the wall in one step. Everything waits in the inbox until someone says yes."
    >
      {error && <p className="set-err">{error}</p>}
      {status && (
        <div className="cap-status" role="status">
          <StatusBadge
            state={status.canRead ? 'connected' : 'not_set_up'}
            text={status.canRead ? 'Can read' : 'Needs a Claude key'}
          />
          <p className="set-hint">
            {status.readMessage}{' '}
            {!status.canRead && <a href="#quips">Add a key in Weather quips</a>}
          </p>
          <span className="cap-count">
            {status.pending ? `${status.pending} waiting in the inbox` : 'The inbox is empty'}
          </span>
        </div>
      )}

      <h3 className="h3 cap-h">Forward to Mantel</h3>
      <p className="set-hint">
        Give Mantel its own email address. Anyone in the family forwards a school email, a party
        invite or a booking to it, and it lands in the inbox. Mail from anyone not on the list is
        ignored{status?.mailIgnored ? ` (${status.mailIgnored} so far)` : ''}.
      </p>
      {mail ? (
        <IntegrationCard
          manifest={mail.manifest}
          status={mail.status}
          onStatus={(s) => {
            setMail({ ...mail, status: s });
            void load();
          }}
        />
      ) : (
        <div className="skeleton" style={{ height: 96 }} />
      )}
      <Collapse title="Use one easy address" hint="So the family only has to remember one.">
        <ol className="set-steps">
          <li>
            <b>A new Gmail address</b> is the simplest: free, private, and only Mantel reads it.
            Make one at{' '}
            <a href="https://accounts.google.com/signup" target="_blank" rel="noreferrer">
              accounts.google.com/signup
            </a>{' '}
            (for example <code>smithfamily.mantel@gmail.com</code>), turn on 2-Step Verification,
            then make an app password.
          </li>
          <li>
            <b>Already have a family Gmail?</b> Add <code>+mantel</code> before the @ (
            <code>smithfamily+mantel@gmail.com</code>): Gmail delivers it to the same mailbox. Make
            a filter for that address that skips the inbox and labels it Mantel, and set the Folder
            (under Advanced) to <code>Mantel</code>.
          </li>
          <li>
            <b>iCloud Mail:</b> add an alias in iCloud Settings, Mail, and sign in here with your
            Apple Account email and an app-specific password from{' '}
            <a href="https://account.apple.com/account/manage" target="_blank" rel="noreferrer">
              account.apple.com
            </a>
            .
          </li>
          <li>
            <b>Ask the school</b> to add the Mantel address to its mailing list, and add the
            school's domain (like <code>@lincoln.k12.example</code>) to "Also accept mail from".
          </li>
        </ol>
      </Collapse>

      <div className="set-sub">
        <div className="set-label">
          Who can send
          <span className="set-hint">
            Each person's own email address. Mail they forward to Mantel is read; nobody else's is.
          </span>
        </div>
        {people.length === 0 ? (
          <p className="set-hint">Add people in the People section first.</p>
        ) : (
          <div className="cap-people">
            {people.map((p) => (
              <label key={p.id} className="cap-person">
                <span className="av sm" style={{ ['--pc' as string]: p.color }}>
                  {p.initial}
                </span>
                <span className="cap-name">{p.name}</span>
                <TextInput
                  type="email"
                  label={`${p.name}'s email`}
                  value={p.email ?? ''}
                  placeholder="name@example.com"
                  onChange={(v) => setEmail(p.id, v)}
                />
              </label>
            ))}
          </div>
        )}
      </div>

      <h3 className="h3 cap-h">Share from a phone</h3>
      <ShareFromPhone />

      <h3 className="h3 cap-h">Siri</h3>
      <p className="set-hint">
        Events added with Siri to an iCloud or Google calendar Mantel already shows appear on the
        wall with no setup. "Hey Siri, add dentist Tuesday at 3 to the Family calendar" is enough.
      </p>
    </Section>
  );
}

function ShareFromPhone() {
  const url = `${location.origin}/api/inbox/upload`;
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);

  const makeKey = async () => {
    setBusy(true);
    setTest(null);
    try {
      setKey((await api.call('inboxShortcutKey')).key);
    } catch (err) {
      setTest({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    if (!key) return;
    setBusy(true);
    try {
      const client = createApiClient({ baseUrl: '', deviceKey: key });
      const s = await client.call('inboxStatus');
      setTest({
        ok: true,
        text: `The key works. The Shortcut can send to this Mantel (${s.pending} waiting now).`,
      });
    } catch (err) {
      setTest({ ok: false, text: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="set-hint">
        <b>Android:</b> install the phone app (Settings, Phone app), then choose Share and{' '}
        <b>Mantel</b> in any app: Gmail, Files, Photos, Chrome. It opens the Inbox tab.
      </p>
      <Collapse
        title="iPhone: the Send to Mantel shortcut"
        hint="Two minutes, once per iPhone. Then Share, Send to Mantel, from any app."
      >
        <ol className="set-steps">
          <li>
            Make a key for the shortcut. It is shown once; you can take it away later in Displays.
            <div className="cap-key">
              {key ? (
                <CopyRow label="Key" value={key} />
              ) : (
                <button
                  type="button"
                  className="set-btn primary"
                  disabled={busy}
                  onClick={() => void makeKey()}
                >
                  {busy ? 'Making…' : 'Make a key for the shortcut'}
                </button>
              )}
              {key && (
                <button
                  type="button"
                  className="set-btn sm"
                  disabled={busy}
                  onClick={() => void runTest()}
                >
                  Test
                </button>
              )}
            </div>
            {test && (
              <p className={test.ok ? 'set-ok' : 'set-err'} role="status">
                {test.text}
              </p>
            )}
          </li>
          <li>
            Open <b>Shortcuts</b>, tap <b>+</b>, and name it <b>Send to Mantel</b>. Tap the <b>ⓘ</b>{' '}
            and turn on <b>Show in Share Sheet</b>.
          </li>
          <li>
            Add the action <b>Get Contents of URL</b>, and paste the address:
            <CopyRow label="URL" value={url} />
          </li>
          <li>
            Tap <b>Show More</b>. Method: <b>POST</b>. Under Headers, add one:
            <CopyRow label="Header" value={HEADER} />
            and paste the key as its value.
          </li>
          <li>
            Request Body: <b>Form</b>. Add a field of type <b>File</b>, name it
            <CopyRow label="Field" value="file" />
            and pick <b>Shortcut Input</b> as its value.
          </li>
          <li>
            Add <b>Show Notification</b> with <b>Contents of URL</b>, so you see "Sent to Mantel".
          </li>
          <li>
            Try it: in Mail or Files, Share a PDF and pick Send to Mantel. Photos from the camera
            are HEIC; if Mantel says it cannot open one, add <b>Convert Image</b> (JPEG) before Get
            Contents of URL.
          </li>
        </ol>
      </Collapse>
    </>
  );
}
