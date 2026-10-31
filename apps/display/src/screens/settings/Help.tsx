import { useEffect, useState } from 'react';
import { Collapse, CopyRow, Section } from './controls';
import { QrCode } from '../setup/Qr';

const KIOSK_URL = () => `${location.origin}/`;

/**
 * Help: the kiosk guides for an iPad, a Surface and an Android tablet, the Google sign-in
 * walkthrough, and where the phone page is. The repo's docs are the long version.
 */
export function HelpSection({ publicUrl }: { publicUrl?: string }) {
  const [origin, setOrigin] = useState(KIOSK_URL());
  useEffect(
    () => setOrigin(publicUrl ? `${publicUrl.replace(/\/$/, '')}/` : KIOSK_URL()),
    [publicUrl],
  );
  const addUrl = `${origin}add`;
  return (
    <Section
      id="help"
      title="Help"
      hint="Everything to put a tablet on the wall and get phones adding to the lists. Each guide opens in place."
    >
      <div className="set-help-top">
        <div className="set-help-qr">
          <QrCode text={origin} size={132} label={`QR code for ${origin}`} />
          <span className="set-hint">Scan on the tablet</span>
        </div>
        <div className="grow">
          <CopyRow label="Open this address on the tablet or a phone" value={origin} />
          <CopyRow label="The phone page for lists and chores" value={addUrl} />
          <p className="set-hint">
            A tablet pairs with the admin PIN (or a one-time code from Displays). Phones use the
            same PIN on the /add page.
          </p>
        </div>
      </div>

      <Collapse
        title="iPad in kiosk mode"
        hint="Guided Access keeps it in Mantel. About 10 minutes."
      >
        <ol className="set-steps">
          <li>
            In Safari open <code>{origin}</code>, then Share, <b>Add to Home Screen</b>. Open Mantel
            from the new icon: it runs full screen. Pair it there with the PIN.
          </li>
          <li>
            Settings, Display &amp; Brightness, Auto-Lock: <b>Never</b>.
          </li>
          <li>
            Settings, Accessibility, <b>Guided Access</b>: on. Set a passcode and Display Auto-Lock
            to Never.
          </li>
          <li>
            Open Mantel, triple-click the top button, Start. Triple-click and the passcode to leave.
          </li>
          <li>
            Brightness: Safari cannot set the backlight, so Mantel dims on screen. For the real
            backlight add Shortcuts automations (Time of Day, Set Brightness) matching the schedule
            steps.
          </li>
          <li>
            Battery: turn on the 80% charging limit if your iPad has it, or use a smart plug Home
            Assistant switches below 40% and above 80%.
          </li>
        </ol>
      </Collapse>

      <Collapse
        title="Surface or Windows PC in kiosk mode"
        hint="Chrome in kiosk mode on its own Windows account."
      >
        <ol className="set-steps">
          <li>
            Settings, Accounts, Other users: add a local account named <b>Mantel</b> (no Microsoft
            account) and sign in to it once.
          </li>
          <li>
            Sign in automatically: turn off “only allow Windows Hello sign-in”, then Win+R,{' '}
            <code>netplwiz</code>, untick “Users must enter a user name and password”.
          </li>
          <li>
            Settings, System, Power: screen and sleep <b>Never</b> when plugged in. Notifications
            off. Active hours covering the day.
          </li>
          <li>
            Install Chrome, open <code>{origin}</code>, pair with the PIN, close Chrome.
          </li>
          <li>
            Win+R, <code>shell:startup</code>, New, Shortcut, location:
            <CopyRow
              label="Shortcut location (one line)"
              value={`"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk ${origin} --no-first-run --disable-pinch --overscroll-history-navigation=0 --noerrdialogs --disable-session-crashed-bubble`}
            />
            Sign out and in: Mantel fills the screen. Alt+F4 leaves kiosk mode.
          </li>
          <li>
            If the same Surface also runs the Mantel server, use <code>http://localhost:8787/</code>{' '}
            in the shortcut; Google then accepts the redirect with no paste-back.
          </li>
          <li>
            Backlight: the brightness helper in <code>deploy/kiosk/surface</code> follows the
            schedule. Battery Limit in the UEFI or Smart Charging keeps the battery healthy.
          </li>
        </ol>
      </Collapse>

      <Collapse title="Android tablet in kiosk mode" hint="Fully Kiosk Browser does all of it.">
        <ol className="set-steps">
          <li>
            Install <b>Fully Kiosk Browser</b> from the Play Store.
          </li>
          <li>
            Start URL: <code>{origin}</code>. Settings, Web Content: enable JavaScript and local
            storage. Device Management: keep screen on, screen brightness from the schedule if you
            like.
          </li>
          <li>
            Kiosk Mode: on, with a PIN. Fully Kiosk’s remote admin lets you reload it from a phone.
          </li>
          <li>Open Mantel in it and pair with the PIN.</li>
        </ol>
      </Collapse>

      <Collapse
        title="Google sign-in walkthrough"
        hint="Google makes every household create its own client. Ten minutes, once."
      >
        <ol className="set-steps">
          <li>
            Open the{' '}
            <a
              href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google Calendar API page
            </a>
            . Create a project if asked (any name), then press <b>Enable</b>.
          </li>
          <li>
            Open{' '}
            <a
              href="https://console.cloud.google.com/auth/overview"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google Auth Platform
            </a>
            . Set the audience to <b>External</b>, fill the app name and your email, then press{' '}
            <b>Publish app</b>. Without publishing, Google signs you out after 7 days.
          </li>
          <li>
            Open{' '}
            <a
              href="https://console.cloud.google.com/auth/clients"
              target="_blank"
              rel="noopener noreferrer"
            >
              Clients
            </a>
            , Create client, type <b>Web application</b>. Under Authorised redirect URIs add the
            address shown on the Google card in Calendars (it has a Copy button).
          </li>
          <li>
            Press Create. Download the JSON, or copy the client ID and secret. Drop the file on the
            Client ID field in Calendars, or paste both. Save.
          </li>
          <li>
            Press <b>Connect Google Calendar</b>. Google shows an “unverified app” warning: expected
            for a household app; press Continue, then Allow.
          </li>
          <li>
            If the server has a plain <code>http://192.168…</code> address, the browser lands on a{' '}
            <code>localhost</code> page that does not load. Copy the whole address from the browser
            bar into the paste box and press Finish. With an https address (or the server on the
            same computer at localhost) this step disappears.
          </li>
        </ol>
      </Collapse>

      <Collapse
        title="iCloud calendars"
        hint="An app-specific password, not your Apple ID password."
      >
        <ol className="set-steps">
          <li>
            Sign in at{' '}
            <a
              href="https://account.apple.com/account/manage"
              target="_blank"
              rel="noopener noreferrer"
            >
              account.apple.com
            </a>
            , Sign-In and Security, <b>App-Specific Passwords</b>, Generate.
          </li>
          <li>
            Name it Mantel, copy the password, paste it on the iCloud card in Calendars with the
            Apple ID email. Press Test, then Save.
          </li>
          <li>
            Calendars shared with that Apple ID appear once the invitation is accepted on an iPhone
            or Mac.
          </li>
        </ol>
      </Collapse>
    </Section>
  );
}
