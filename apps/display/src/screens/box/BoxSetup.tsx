import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { setGlance } from '../../app/glance';
import { getStoredKey } from '../../lib/api';
import { useThemeMode } from '../../lib/theme';
import { QrCode } from '../setup/Qr';
import './box.css';

/** What `GET /api/box/state` returns (apps/server/src/box). */
interface BoxState {
  box: true;
  port: number;
  role: 'server' | 'screen' | null;
  serverUrl: string | null;
  touch: boolean;
  done: boolean;
  network: {
    available: boolean;
    online: boolean;
    kind: 'ethernet' | 'wifi' | null;
    ssid: string | null;
    address: string | null;
    hasWifi: boolean;
    hotspot: boolean;
  };
  hotspot: { ssid: string; password: string | null; url: string } | null;
  setupUrl: string | null;
  joining: string | null;
  lastError: string | null;
}
interface WifiNetwork {
  ssid: string;
  strength: number;
  secure: boolean;
}

const ON_BOX = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const key = getStoredKey();
  if (key) headers['x-mantel-device-key'] = key;
  const pin = sessionStorage.getItem('mantel.box.pin');
  if (pin) headers['x-mantel-pin'] = pin;
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? 'GET',
    headers,
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const json = (await res.json().catch(() => null)) as
    (T & { error?: { code?: string; message?: string } }) | null;
  if (!res.ok) {
    const err = new Error(json?.error?.message ?? `HTTP ${res.status}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }
  return json as T;
}

type Step = 'network' | 'role' | 'touch' | 'done';

/**
 * `/box`: Mantel OS first-boot setup, on the box's own screen or a phone. Network (Wi-Fi, or the
 * "Mantel setup" hotspot and QR codes when there is none), then whether this box runs Mantel or
 * shows a Mantel elsewhere, then whether the screen has touch (glance mode when not).
 * Later visits change the same things; away from the box they need the admin PIN.
 */
export function BoxSetup() {
  useThemeMode('auto');
  const [state, setState] = useState<BoxState | null>(null);
  const [missing, setMissing] = useState(false);
  const [step, setStep] = useState<Step>('network');
  const [stepChosen, setStepChosen] = useState(false);
  const [doneAtLoad, setDoneAtLoad] = useState<boolean | null>(null);

  const refresh = useCallback(() => {
    call<BoxState>('/box/state')
      .then(setState)
      .catch((err: Error & { status?: number }) => {
        if (err.status === 404) setMissing(true);
      });
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  // Setup finished from a phone: the box's own screen moves on to Mantel.
  useEffect(() => {
    if (!state) return;
    if (doneAtLoad === null) setDoneAtLoad(state.done);
    else if (ON_BOX && !doneAtLoad && state.done) {
      setGlance(!state.touch);
      location.replace('/');
    }
  }, [state, doneAtLoad]);

  // Start where the box is: no network yet → network; online but no role → role.
  useEffect(() => {
    if (!state || stepChosen) return;
    if (state.network.online && !state.network.hotspot) {
      setStep(state.role ? 'network' : 'role');
      setStepChosen(true);
    }
  }, [state, stepChosen]);

  if (missing)
    return (
      <Page>
        <div className="card card-pad">
          <h1 className="h2">Not a Mantel OS box</h1>
          <p className="muted">
            This page sets up a Mantel OS box. This Mantel runs somewhere else.
          </p>
          <a className="btn" href="/">
            Back to the display
          </a>
        </div>
      </Page>
    );
  if (!state)
    return (
      <Page>
        <p className="muted">Starting…</p>
      </Page>
    );

  const go = (s: Step) => {
    setStepChosen(true);
    setStep(s);
  };

  return (
    <Page>
      <header className="box-head">
        <div className="eyebrow">Mantel OS</div>
        <h1 className="h1">{state.role ? 'This box' : 'Set up this box'}</h1>
        <ol className="box-steps" aria-label="Steps">
          {(['network', 'role', 'touch'] as const).map((s, i) => (
            <li key={s} className={s === step ? 'on' : ''}>
              <button type="button" className="btn quiet sm" onClick={() => go(s)}>
                {i + 1}. {s === 'network' ? 'Network' : s === 'role' ? 'Mantel' : 'Screen'}
              </button>
            </li>
          ))}
        </ol>
      </header>
      {step === 'network' && (
        <NetworkStep state={state} onChange={refresh} onNext={() => go('role')} />
      )}
      {step === 'role' && <RoleStep state={state} onDone={() => go('touch')} />}
      {(step === 'touch' || step === 'done') && <TouchStep state={state} />}
      {!ON_BOX && state.role && <PinBox />}
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="box-page">
      <div className="box-shell">{children}</div>
    </div>
  );
}

function NetworkStep({
  state,
  onChange,
  onNext,
}: {
  state: BoxState;
  onChange: () => void;
  onNext: () => void;
}) {
  const n = state.network;
  const [networks, setNetworks] = useState<WifiNetwork[] | null>(null);
  const [pick, setPick] = useState<WifiNetwork | null>(null);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);

  const scan = useCallback((rescan: boolean) => {
    call<{ networks: WifiNetwork[] }>(`/box/wifi${rescan ? '?rescan=1' : ''}`)
      .then((r) => setNetworks(r.networks))
      .catch(() => setNetworks([]));
  }, []);
  const wantList = !n.online || changing;
  useEffect(() => {
    if (wantList && n.hasWifi && networks === null) scan(false);
  }, [wantList, n.hasWifi, networks, scan]);

  const join = async (e: FormEvent) => {
    e.preventDefault();
    if (!pick) return;
    setError(null);
    try {
      await call('/box/wifi', {
        method: 'POST',
        body: { ssid: pick.ssid, password: pick.secure ? password : undefined },
      });
      setSent(pick.ssid);
      setPick(null);
      setPassword('');
      setChanging(false);
      onChange();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!n.available)
    return (
      <section className="card card-pad box-card">
        <h2 className="h2">Network</h2>
        <p className="muted">
          This box cannot manage its network yet. A network cable works; plug one in.
        </p>
        <div className="box-actions">
          <button type="button" className="btn primary lg" onClick={onNext}>
            Next
          </button>
        </div>
      </section>
    );

  return (
    <section className="card card-pad box-card">
      <h2 className="h2">Network</h2>
      {state.joining && <p className="box-status">Joining “{state.joining}”…</p>}
      {sent && !ON_BOX && state.joining === null && !n.online && (
        <p className="muted">
          The box is joining “{sent}”. If your phone lost the “Mantel setup” network, that is
          expected: the box's screen shows how it went. If it could not join, the “Mantel setup”
          network comes back within a minute so you can try again.
        </p>
      )}
      {state.lastError && <p className="box-error">{state.lastError}</p>}

      {n.online ? (
        <div className="box-online">
          <p>
            <strong>Connected</strong>{' '}
            {n.kind === 'ethernet' ? 'by network cable' : `to Wi-Fi “${n.ssid ?? ''}”`}
            {n.address && <span className="muted"> · {n.address}</span>}
          </p>
          {ON_BOX && state.setupUrl && !state.role && (
            <div className="box-qr-row">
              <QrCode text={state.setupUrl} size={140} label="Continue setup on your phone" />
              <p className="muted">
                No keyboard? Scan this with a phone on the same network to carry on there, or open{' '}
                <code>{state.setupUrl}</code>.
              </p>
            </div>
          )}
          <div className="box-actions">
            {n.hasWifi && !changing && (
              <button type="button" className="btn" onClick={() => setChanging(true)}>
                Change Wi-Fi
              </button>
            )}
            <button type="button" className="btn primary lg" onClick={onNext}>
              Next
            </button>
          </div>
        </div>
      ) : state.hotspot && ON_BOX ? (
        <div className="box-hotspot">
          <p>
            No network yet. Set this box up from your phone: join the Wi-Fi network below, then open
            the page.
          </p>
          <div className="box-qr-pair">
            <figure>
              <QrCode
                text={`WIFI:T:WPA;S:${state.hotspot.ssid};P:${state.hotspot.password ?? ''};;`}
                size={180}
                label="Join the Mantel setup Wi-Fi"
              />
              <figcaption>
                <strong>1. Join “{state.hotspot.ssid}”</strong>
                <br />
                Password <code className="tnum">{state.hotspot.password}</code>
              </figcaption>
            </figure>
            <figure>
              <QrCode text={state.hotspot.url} size={180} label="Open setup" />
              <figcaption>
                <strong>2. Open setup</strong>
                <br />
                <code>{state.hotspot.url}</code>
              </figcaption>
            </figure>
          </div>
          <p className="muted">Or plug in a network cable, or a keyboard to pick Wi-Fi here.</p>
        </div>
      ) : !n.hasWifi ? (
        <p className="muted">Plug in a network cable. This box has no Wi-Fi.</p>
      ) : (
        <p className="muted">Pick your Wi-Fi network.</p>
      )}

      {wantList && n.hasWifi && (
        <div className="box-wifi">
          <div className="box-wifi-head">
            <span className="eyebrow">Networks in range</span>
            {!n.hotspot && (
              <button type="button" className="btn sm quiet" onClick={() => scan(true)}>
                Look again
              </button>
            )}
          </div>
          {networks === null ? (
            <p className="muted">Looking…</p>
          ) : networks.length === 0 ? (
            <p className="muted">No networks found.</p>
          ) : (
            <ul className="box-wifi-list">
              {networks.map((w) => (
                <li key={w.ssid}>
                  <button
                    type="button"
                    className={`btn block ${pick?.ssid === w.ssid ? 'selected' : ''}`}
                    onClick={() => {
                      setPick(w);
                      setError(null);
                    }}
                  >
                    <span>{w.ssid}</span>
                    <span className="muted">
                      {w.secure ? '🔒 ' : ''}
                      {bars(w.strength)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {pick && (
            <form className="box-join" onSubmit={join}>
              {pick.secure && (
                <label>
                  <span>Password for “{pick.ssid}”</span>
                  <input
                    className="input"
                    type={show ? 'text' : 'password'}
                    autoComplete="off"
                    autoCapitalize="none"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus
                  />
                </label>
              )}
              {pick.secure && (
                <label className="box-check">
                  <input
                    type="checkbox"
                    checked={show}
                    onChange={(e) => setShow(e.target.checked)}
                  />{' '}
                  Show password
                </label>
              )}
              {error && <p className="box-error">{error}</p>}
              <button
                type="submit"
                className="btn primary lg"
                disabled={pick.secure && password.length < 8}
              >
                Join
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}

function bars(strength: number) {
  return strength >= 70 ? '▂▄▆█' : strength >= 45 ? '▂▄▆' : strength >= 20 ? '▂▄' : '▂';
}

function RoleStep({ state, onDone }: { state: BoxState; onDone: () => void }) {
  const [role, setRole] = useState<'server' | 'screen' | null>(state.role);
  const [url, setUrl] = useState(state.serverUrl ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!role) return;
    setBusy(true);
    setError(null);
    try {
      await call('/box/role', {
        method: 'POST',
        body: { role, serverUrl: role === 'screen' ? url : undefined, touch: state.touch },
      });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card card-pad box-card">
      <h2 className="h2">Where does Mantel run?</h2>
      <div className="box-choices">
        <button
          type="button"
          className={`card tap box-choice ${role === 'server' ? 'on' : ''}`}
          onClick={() => setRole('server')}
        >
          <strong>Run Mantel on this box</strong>
          <span className="muted">
            Everything lives here: calendars, lists, photos, settings. Tablets and phones connect to
            this box. Best for a first Mantel.
          </span>
        </button>
        <button
          type="button"
          className={`card tap box-choice ${role === 'screen' ? 'on' : ''}`}
          onClick={() => setRole('screen')}
        >
          <strong>Show a Mantel I already have</strong>
          <span className="muted">
            This box is only a screen for a Mantel running elsewhere, such as Unraid, Docker or a
            PC.
          </span>
        </button>
      </div>
      {role === 'screen' && (
        <form className="box-join" onSubmit={save}>
          <label>
            <span>Address of your Mantel</span>
            <input
              className="input"
              inputMode="url"
              autoCapitalize="none"
              placeholder="192.168.1.20:8787"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </label>
          <p className="muted">
            It is the address you open on a tablet, shown in that Mantel's Settings › Displays. This
            box will ask for a pairing code from there.
          </p>
        </form>
      )}
      {error && <p className="box-error">{error}</p>}
      <div className="box-actions">
        <button
          type="button"
          className="btn primary lg"
          disabled={!role || busy || (role === 'screen' && !url.trim())}
          onClick={() => void save()}
        >
          {busy ? 'Checking…' : 'Next'}
        </button>
      </div>
    </section>
  );
}

function TouchStep({ state }: { state: BoxState }) {
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const finish = async (touch: boolean) => {
    setError(null);
    try {
      const s = await call<{ role: BoxState['role']; serverUrl: string | null }>('/box/role', {
        method: 'POST',
        body: {
          role: state.role ?? 'server',
          serverUrl: state.serverUrl ?? undefined,
          touch,
          done: true,
        },
      });
      if (!ON_BOX) return setFinished(true);
      setGlance(!touch);
      if (s.role === 'screen' && s.serverUrl)
        location.replace(`${s.serverUrl}/?box=1&glance=${touch ? 0 : 1}`);
      else location.replace(`/?glance=${touch ? 0 : 1}`);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  if (!state.role)
    return (
      <section className="card card-pad box-card">
        <p className="muted">Choose where Mantel runs first.</p>
      </section>
    );
  return (
    <section className="card card-pad box-card">
      <h2 className="h2">Does this screen respond to touch?</h2>
      <p className="muted">
        Without touch, Mantel runs as a glance screen: it moves through its screens by itself, and
        lists, chores and events are changed from the phone app.
      </p>
      <div className="box-choices">
        <button type="button" className="card tap box-choice" onClick={() => void finish(true)}>
          <strong>Yes, it is a touchscreen</strong>
        </button>
        <button type="button" className="card tap box-choice" onClick={() => void finish(false)}>
          <strong>No, it is a monitor or TV</strong>
        </button>
      </div>
      {finished && (
        <p className="box-status">
          All set. The box's screen now opens Mantel
          {state.role === 'screen' ? ' and asks for a pairing code' : ''}.
          {state.role === 'server' && state.setupUrl && (
            <>
              {' '}
              Carry on with Mantel's own setup at{' '}
              <a href={state.setupUrl.replace(/\/box$/, '/setup')}>
                {state.setupUrl.replace(/\/box$/, '/setup')}
              </a>
              .
            </>
          )}
        </p>
      )}
      {error && <p className="box-error">{error}</p>}
    </section>
  );
}

/** Away from the box, once it is set up, changes need the admin PIN. */
function PinBox() {
  const [pin, setPin] = useState(sessionStorage.getItem('mantel.box.pin') ?? '');
  return (
    <section className="card card-pad box-card box-pin">
      <label>
        <span className="muted">Admin PIN (needed to change a box that is already set up)</span>
        <input
          className="input"
          inputMode="numeric"
          type="password"
          value={pin}
          onChange={(e) => {
            setPin(e.target.value);
            sessionStorage.setItem('mantel.box.pin', e.target.value);
          }}
        />
      </label>
    </section>
  );
}
