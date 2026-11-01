import {
  ApiRequestError,
  SETUP_STEPS,
  type Settings,
  type SetupState,
  type SetupStep,
} from '@mantel/shared';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { pairWith } from '../../app/Pairing';
import { api, getStoredKey, setDeviceKey } from '../../lib/api';
import { useThemeMode } from '../../lib/theme';
import { CalendarsSection } from '../settings/Calendars';
import { errorText, getHealthDetails } from '../settings/client';
import { CopyRow, Result, Section, TextInput } from '../settings/controls';
import { HomeSection } from '../settings/Home';
import { IntegrationCard } from '../settings/Integrations';
import { useIntegrations } from '../settings';
import { People } from '../settings/sections';
import '../settings/settings.css';
import { QrCode } from './Qr';
import './setup.css';

const STEP_INFO: Record<SetupStep, { title: string; blurb: string; optional?: boolean }> = {
  welcome: {
    title: 'Welcome',
    blurb: 'Choose the PIN that pairs tablets and phones and opens Settings.',
  },
  home: { title: 'Your home', blurb: 'Where the house is, for weather, sunrise and the clock.' },
  people: { title: 'People', blurb: 'Everyone gets a colour on the calendar.' },
  calendars: { title: 'Calendars', blurb: 'Google, iCloud, or both.', optional: true },
  homeassistant: {
    title: 'Home Assistant',
    blurb: 'Lights, locks and the doorbell on the wall.',
    optional: true,
  },
  extras: {
    title: 'Photos and extras',
    blurb: 'Photos, leave-by times, pollen, humour.',
    optional: true,
  },
  wall: { title: 'Put it on the wall', blurb: 'Open Mantel on the tablet and pair it.' },
};

type Load =
  | { status: 'loading' }
  | { status: 'unpaired' }
  | { status: 'error'; message: string }
  | { status: 'ready'; saved: Settings; version: string };

/**
 * The first-run wizard at `/setup`: the Settings sections in order, one per step, with the
 * display itself running behind as a preview. Every step can be skipped and finished later in
 * Settings; progress is saved on the server so another browser can pick it up.
 */
export function SetupWizard() {
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [draft, setDraft] = useState<Settings | null>(null);
  const [step, setStep] = useState<SetupStep>(() => {
    const wanted = new URLSearchParams(location.search).get('step');
    return (SETUP_STEPS as readonly string[]).includes(wanted ?? '')
      ? (wanted as SetupStep)
      : 'welcome';
  });
  const [saving, setSaving] = useState<string | null>(null);
  const integrations = useIntegrations();
  useThemeMode(draft?.theme ?? 'auto');

  const loadSettings = useCallback(() => {
    Promise.all([api.call('settings'), api.call('bootstrap')])
      .then(([settings, boot]) => {
        setLoad({ status: 'ready', saved: settings, version: boot.version });
        setDraft(settings);
        integrations.reload();
      })
      .catch((err: unknown) => {
        if (err instanceof ApiRequestError && err.status === 401) setLoad({ status: 'unpaired' });
        else setLoad({ status: 'error', message: errorText(err) });
      });
  }, [integrations]);

  useEffect(() => {
    api
      .call('setupState')
      .then(setSetup)
      .catch(() => setSetup({ firstRun: false, pinSet: true, completed: false, steps: {} }));
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const index = SETUP_STEPS.indexOf(step);
  const paired = load.status === 'ready';
  /** A fresh install chooses its PIN before anything else. */
  const fresh = setup ? setup.firstRun && !setup.pinSet : false;

  /** Record a step and move on. Settings edits are saved first. */
  const advance = async (state: 'done' | 'skipped') => {
    setSaving(null);
    try {
      if (
        state === 'done' &&
        draft &&
        load.status === 'ready' &&
        JSON.stringify(draft) !== JSON.stringify(load.saved)
      ) {
        setSaving('Saving…');
        const next = await api.call('settingsPut', { body: draft });
        setLoad({ ...load, saved: next });
        setDraft(next);
      }
      if (paired) {
        const s = await api
          .call('setupStatePut', { body: { steps: { [step]: state } } })
          .catch(() => null);
        if (s) setSetup(s);
      }
      const nextStep = SETUP_STEPS[index + 1];
      if (nextStep) setStep(nextStep);
      setSaving(null);
      window.scrollTo({ top: 0 });
    } catch (err) {
      setSaving(errorText(err));
    }
  };

  const finish = async () => {
    try {
      if (paired)
        await api.call('setupStatePut', { body: { steps: { wall: 'done' }, completed: true } });
    } catch {
      // Finishing is best effort; Settings works either way.
    }
    location.assign('/settings');
  };

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  const previewSrc = useMemo(
    () => `/?mode=${draft?.theme === 'dusk' ? 'dusk' : 'daylight'}`,
    [draft?.theme],
  );

  return (
    <div className="setup-page">
      <iframe
        className="setup-preview"
        src={previewSrc}
        title="The display, as it looks now"
        tabIndex={-1}
        aria-hidden="true"
      />
      <div className="setup-scrim" />
      <div className="setup-shell">
        <aside className="setup-rail card">
          <div className="eyebrow">Set up Mantel</div>
          <ol className="setup-steps">
            {SETUP_STEPS.map((id, i) => {
              const s = setup?.steps[id];
              return (
                <li
                  key={id}
                  aria-current={id === step ? 'step' : undefined}
                  className={s ? `is-${s}` : ''}
                >
                  <button
                    type="button"
                    onClick={() => (paired || i === 0 ? setStep(id) : undefined)}
                    disabled={!paired && i > 0}
                  >
                    <span className="setup-num tnum">{i + 1}</span>
                    <span>
                      {STEP_INFO[id].title}
                      <span className="set-hint">
                        {s === 'done'
                          ? 'Done'
                          : s === 'skipped'
                            ? 'Skipped'
                            : STEP_INFO[id].optional
                              ? 'Optional'
                              : ''}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <a className="set-btn quiet" href="/settings">
            Open Settings instead
          </a>
        </aside>

        <main className="setup-main" aria-live="polite">
          <header className="setup-head">
            <div className="eyebrow">
              Step {index + 1} of {SETUP_STEPS.length}
            </div>
            <h1 className="h1">{STEP_INFO[step].title}</h1>
            <p className="muted">{STEP_INFO[step].blurb}</p>
          </header>

          <div key={step} className="set-section-anim setup-body">
            {step === 'welcome' && (
              <WelcomeStep
                setup={setup}
                paired={paired}
                onPaired={() => {
                  setSetup((s) => (s ? { ...s, firstRun: false, pinSet: true } : s));
                  loadSettings();
                }}
                onSetup={setSetup}
              />
            )}
            {step !== 'welcome' && load.status === 'unpaired' && (
              <Section title="Pair this browser first" hint="Go back to Welcome and enter the PIN.">
                <button
                  type="button"
                  className="set-btn primary"
                  onClick={() => setStep('welcome')}
                >
                  Back to Welcome
                </button>
              </Section>
            )}
            {step !== 'welcome' && load.status === 'error' && (
              <Section title="Can't reach the server" hint={load.message}>
                <button type="button" className="set-btn primary" onClick={loadSettings}>
                  Retry
                </button>
              </Section>
            )}
            {draft && step === 'home' && <HomeSection draft={draft} set={set} />}
            {draft && step === 'people' && (
              <People value={draft.people} calendars={[]} onChange={(v) => set('people', v)} />
            )}
            {paired && step === 'calendars' && (
              <CalendarsSection
                plugins={integrations.plugins}
                statuses={integrations.statuses}
                onStatus={integrations.onStatus}
                wizard
              />
            )}
            {paired && step === 'homeassistant' && (
              <Section
                id="homeassistant"
                title="Home Assistant"
                hint="Optional. Skip this if you do not run Home Assistant; the Home screen stays off the dock."
              >
                {integrations.plugins
                  .filter((p) => p.id === 'homeassistant')
                  .map((p) => (
                    <IntegrationCard
                      key={p.id}
                      manifest={p}
                      status={integrations.statuses[p.id]}
                      onStatus={integrations.onStatus}
                      open
                    />
                  ))}
                {integrations.plugins.length === 0 && <p className="set-hint">Loading…</p>}
              </Section>
            )}
            {paired && step === 'extras' && (
              <Section
                id="extras"
                title="Photos and extras"
                hint="Each one is optional and explains what it adds. Weather needs nothing; it is already on."
              >
                <div className="set-int-grid">
                  {integrations.plugins
                    .filter((p) => p.step === 'extras')
                    .map((p) => (
                      <IntegrationCard
                        key={p.id}
                        manifest={p}
                        status={integrations.statuses[p.id]}
                        onStatus={integrations.onStatus}
                        open={false}
                      />
                    ))}
                </div>
              </Section>
            )}
            {step === 'wall' && <WallStep />}
          </div>

          <footer className="setup-foot">
            <button
              type="button"
              className="set-btn quiet"
              disabled={index === 0}
              onClick={() => setStep(SETUP_STEPS[index - 1]!)}
            >
              Back
            </button>
            <span className="set-bar-msg">{saving}</span>
            {step !== 'welcome' && step !== 'wall' && STEP_INFO[step].optional && (
              <button type="button" className="set-btn" onClick={() => void advance('skipped')}>
                Skip for now
              </button>
            )}
            {step === 'welcome' ? (
              <button
                type="button"
                className="set-btn primary"
                disabled={!paired || fresh}
                onClick={() => void advance('done')}
              >
                Continue
              </button>
            ) : step === 'wall' ? (
              <button type="button" className="set-btn primary" onClick={() => void finish()}>
                Finish and open Settings
              </button>
            ) : (
              <button
                type="button"
                className="set-btn primary"
                disabled={!paired || saving === 'Saving…'}
                onClick={() => void advance('done')}
              >
                {saving === 'Saving…' ? 'Saving…' : 'Save and continue'}
              </button>
            )}
          </footer>
        </main>
      </div>
    </div>
  );
}

/** Welcome: choose the admin PIN on a fresh install, or enter it to pick up where setup left off. */
function WelcomeStep({
  setup,
  paired,
  onPaired,
  onSetup,
}: {
  setup: SetupState | null;
  paired: boolean;
  onPaired: () => void;
  onSetup: (s: SetupState) => void;
}) {
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const fresh = setup ? setup.firstRun && !setup.pinSet : false;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      if (fresh) {
        if (pin !== again) throw new Error('The two PINs do not match.');
        await api.call('adminPin', { body: { pin } });
      }
      if (!getStoredKey() || !paired) {
        const { deviceKey } = await pairWith(pin, 'Setup browser');
        setDeviceKey(deviceKey);
      }
      setResult({
        ok: true,
        message: fresh
          ? 'PIN set. This browser is now the admin.'
          : 'Paired. Carry on where you left off.',
      });
      onPaired();
    } catch (err) {
      // Two browsers on first run: if the other one just set the PIN, ask for it instead.
      const now = fresh ? await api.call('setupState').catch(() => null) : null;
      if (now?.pinSet) {
        onSetup(now);
        setResult({
          ok: false,
          message: 'A PIN was just set from another browser. Enter it here to continue.',
        });
      } else setResult({ ok: false, message: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  if (paired && !fresh)
    return (
      <Section
        title="This browser is paired"
        hint="Walk through the steps on the left in order, or jump to one. Each is saved as you go."
      >
        <p className="set-hint">
          The display behind this page is live: as you fill things in, it updates. Phones and
          tablets pair with the PIN you chose.
        </p>
      </Section>
    );

  return (
    <form onSubmit={submit}>
      <Section
        title={fresh ? 'Choose an admin PIN' : 'Enter the admin PIN'}
        hint={
          fresh
            ? '4 to 8 digits. It pairs tablets and phones, opens Settings from the wall, and is all a guest would need to change things, so pick one the kids do not know.'
            : 'The PIN chosen when Mantel was first set up. Enter it to continue the setup from this browser.'
        }
      >
        <div className="set-field stack">
          <span className="set-label">PIN</span>
          <TextInput
            label="Admin PIN"
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(v) => setPin(v.replace(/\D/g, '').slice(0, 8))}
            placeholder="••••"
            autoFocus
            className="set-pin"
          />
        </div>
        {fresh && (
          <div className="set-field stack">
            <span className="set-label">Once more</span>
            <TextInput
              label="Admin PIN again"
              type="password"
              inputMode="numeric"
              value={again}
              onChange={(v) => setAgain(v.replace(/\D/g, '').slice(0, 8))}
              placeholder="••••"
              className="set-pin"
            />
          </div>
        )}
        <div className="set-int-actions">
          <button
            type="submit"
            className="set-btn primary"
            disabled={busy || pin.length < 4 || (fresh && again.length < 4)}
          >
            {busy ? 'Working…' : fresh ? 'Set the PIN' : 'Pair this browser'}
          </button>
        </div>
        <Result result={result} />
      </Section>
    </form>
  );
}

/** The last step: how to get a tablet showing the wall. */
function WallStep() {
  const [publicUrl, setPublicUrl] = useState(location.origin);
  useEffect(() => {
    getHealthDetails()
      .then((h) => {
        if (h.publicUrl && !/localhost|127\.0\.0\.1/.test(h.publicUrl))
          setPublicUrl(h.publicUrl.replace(/\/$/, ''));
      })
      .catch(() => undefined);
  }, []);
  const url = `${publicUrl}/`;
  return (
    <Section
      title="Open Mantel on the tablet"
      hint="Scan the code or type the address, enter the PIN you chose, and the wall is up. Then make the tablet stay on it."
    >
      <div className="set-help-top">
        <div className="set-help-qr">
          <QrCode text={url} size={168} label={`QR code for ${url}`} />
          <span className="set-hint">Scan on the tablet</span>
        </div>
        <div className="grow">
          <CopyRow label="Address to open on the tablet" value={url} />
          <CopyRow label="Phones add to lists here" value={`${url}add`} />
          {/localhost|127\.0\.0\.1/.test(publicUrl) && (
            <p className="set-hint">
              This address only works on this computer. From a tablet use this computer’s network
              address instead, for example <code>http://192.168.1.10:8787/</code>, and set it as the
              Public URL in Settings › Advanced so Google sign-in and QR codes use it.
            </p>
          )}
        </div>
      </div>
      <ol className="set-steps">
        <li>
          <b>iPad:</b> a tablet only shows Mantel; this computer has to stay on to run it. Open the
          address in Safari, Share, Add to Home Screen, then open Mantel from the icon and enter the
          PIN. Turn Auto-Lock off and start Guided Access so it stays put.
        </li>
        <li>
          <b>Surface or Windows PC:</b> Chrome in kiosk mode on its own Windows account. If the same
          PC runs Mantel, use <code>http://localhost:8787/</code>.
        </li>
        <li>
          <b>Android tablet:</b> Fully Kiosk Browser with this address as the start page.
        </li>
      </ol>
      <p className="set-hint">
        The full guides, with every setting named, are in Settings › Help. Hold the clock in the
        dock for a second to reach Settings from the wall.
      </p>
    </Section>
  );
}
