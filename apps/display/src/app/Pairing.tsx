import { ApiRequestError } from '@mantel/shared';
import { useState, type FormEvent } from 'react';
import { api, setDeviceKey } from '../lib/api';

/** Shown when the server rejects this display. The code is printed in the server log. */
export function Pairing({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { deviceKey } = await api.call('pair', {
        body: { code, name: navigator.platform || 'Display' },
      });
      setDeviceKey(deviceKey);
      onPaired();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not reach the server');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="pair card" onSubmit={submit}>
      <div>
        <div className="eyebrow">Pair this display</div>
        <h1 className="h2" style={{ marginTop: 8 }}>
          Enter the 6-digit code from the server log
        </h1>
      </div>
      <input
        className="input code"
        inputMode="numeric"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        aria-label="Pairing code"
        autoFocus
      />
      {error && <div className="err">{error}</div>}
      <button type="submit" className="btn primary block" disabled={code.length !== 6 || busy}>
        {busy ? 'Pairing…' : 'Pair'}
      </button>
    </form>
  );
}
