import { ApiRequestError } from '@mantel/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { api, setDeviceKey } from '../lib/api';

/**
 * Shown when the server rejects this display. It takes the admin PIN (4 to 8 digits) or the
 * one-time 6-digit code from Settings › Displays (or the server log). On a fresh install, with
 * no PIN set yet, it offers the setup wizard instead.
 */
export function Pairing({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [firstRun, setFirstRun] = useState(false);
  const [showCode, setShowCode] = useState(false);

  useEffect(() => {
    api
      .call('setupState')
      .then((s) => setFirstRun(s.firstRun && !s.completed))
      .catch(() => setFirstRun(false));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { deviceKey } = await pairWith(code);
      setDeviceKey(deviceKey);
      onPaired();
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.status === 403
            ? 'That PIN or code is not right. The PIN is the one chosen during setup; a code comes from Settings › Displays and works once.'
            : err.message
          : 'Could not reach the server',
      );
    } finally {
      setBusy(false);
    }
  };

  if (firstRun && !showCode)
    return (
      <div className="pair card">
        <div>
          <div className="eyebrow">Welcome to Mantel</div>
          <h1 className="h2" style={{ marginTop: 8 }}>
            Nothing is set up yet
          </h1>
          <p className="muted" style={{ marginTop: 10 }}>
            Ten minutes of setup: your home, the family, calendars, and anything else you want on
            the wall. You can change all of it later in Settings.
          </p>
        </div>
        <a className="btn primary block lg" href="/setup">
          Set up Mantel
        </a>
        <button type="button" className="btn quiet block" onClick={() => setShowCode(true)}>
          I have a pairing code
        </button>
      </div>
    );

  return (
    <form className="pair card" onSubmit={submit}>
      <div>
        <div className="eyebrow">Pair this display</div>
        <h1 className="h2" style={{ marginTop: 8 }}>
          Enter the admin PIN, or a pairing code
        </h1>
        <p className="muted small" style={{ marginTop: 8 }}>
          The PIN was chosen during setup. A one-time code comes from Settings › Displays on a
          paired display.
        </p>
      </div>
      <input
        className="input code"
        inputMode="numeric"
        maxLength={8}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        aria-label="PIN or pairing code"
        autoFocus
      />
      {error && <div className="err">{error}</div>}
      <button type="submit" className="btn primary block" disabled={code.length < 4 || busy}>
        {busy ? 'Pairing…' : 'Pair'}
      </button>
    </form>
  );
}

/**
 * Six digits may be a code or a PIN: try the code first (it is spent on use), then the PIN.
 * Everything else is a PIN.
 */
export async function pairWith(digits: string, name = navigator.platform || 'Display') {
  if (digits.length === 6) {
    try {
      return await api.call('pair', { body: { code: digits, name } });
    } catch (err) {
      if (!(err instanceof ApiRequestError && [400, 403].includes(err.status))) throw err;
    }
  }
  return api.call('pair', { body: { pin: digits, name } });
}
