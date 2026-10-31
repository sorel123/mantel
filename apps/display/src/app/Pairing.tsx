import { ApiRequestError } from '@mantel/shared';
import { useState, type FormEvent } from 'react';
import { api, setDeviceKey } from '../lib/api';

/** Shown when the server rejects this display. The code is printed in the server log. */
export function Pairing({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const { deviceKey } = await api.call('pair', {
        body: { code, name: navigator.platform || 'Display' },
      });
      setDeviceKey(deviceKey);
      onPaired();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not reach the server');
    }
  };

  return (
    <form className="pair card" onSubmit={submit}>
      <div className="eyebrow">Pair this display</div>
      <h1 className="h2">Enter the 6-digit code from the server log</h1>
      <input
        inputMode="numeric"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        aria-label="Pairing code"
        autoFocus
      />
      {error && <div className="err">{error}</div>}
      <button type="submit" disabled={code.length !== 6}>
        Pair
      </button>
    </form>
  );
}
