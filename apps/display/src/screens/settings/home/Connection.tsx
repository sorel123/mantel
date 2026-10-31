import type { HomeConnectionStatus, HomeTestResult } from '@mantel/shared';
import { useEffect, useState } from 'react';
import { Field, TextInput, Toggle } from '../controls';

const STATE_LABEL: Record<HomeConnectionStatus['state'], string> = {
  disabled: 'Off',
  not_set_up: 'Not set up',
  connecting: 'Connecting',
  connected: 'Connected',
  error: 'Problem',
};

/** Where to make a token: HA's own profile page when we know the address, else the docs. */
export function tokenPage(url: string): string {
  const base = url.trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/\s]+/.test(base)
    ? `${base}/profile/security`
    : 'https://www.home-assistant.io/docs/authentication/#your-account-profile';
}

/**
 * The connection card: the on/off switch, the address, the token (never shown once saved), a
 * Test button that answers in one sentence, and Save. Saving applies at once; no restart.
 */
export function ConnectionCard({
  status,
  onSave,
  onTest,
}: {
  status: HomeConnectionStatus;
  onSave: (patch: { enabled?: boolean; url?: string; token?: string }) => Promise<void>;
  onTest: (req: { url: string; token?: string }) => Promise<HomeTestResult>;
}) {
  const [url, setUrl] = useState(status.url);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [result, setResult] = useState<HomeTestResult | null>(null);

  // A save elsewhere (or the first load) refreshes the address shown.
  useEffect(() => setUrl(status.url), [status.url]);

  const dirty = url.trim() !== status.url || token.trim() !== '';

  const test = async () => {
    setBusy('test');
    try {
      setResult(
        await onTest({ url: url.trim(), ...(token.trim() ? { token: token.trim() } : {}) }),
      );
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    setBusy('save');
    try {
      await onSave({ url: url.trim(), ...(token.trim() ? { token: token.trim() } : {}) });
      setToken('');
      setResult(null);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="hs-connection">
      <Toggle
        label="Show Home Assistant on the wall"
        hint="Off hides the Home screen and the doorbell pop-over."
        checked={status.enabled}
        onChange={(enabled) => void onSave({ enabled })}
      />
      <div className={`hs-status is-${status.state}`} role="status">
        <span className="hs-state">{STATE_LABEL[status.state]}</span>
        <span className="hs-summary">{status.summary}</span>
        {status.source === 'env' && (
          <span className="set-hint">Address and token come from the environment for now.</span>
        )}
      </div>
      <Field label="Address" hint="Home Assistant as this computer reaches it.">
        <TextInput
          label="Home Assistant address"
          placeholder="http://homeassistant.local:8123"
          value={url}
          onChange={setUrl}
        />
      </Field>
      <div className="set-field">
        <span className="set-label">
          Long-lived access token
          <span className="set-hint">
            {status.hasToken
              ? 'Saved. Paste a new one to replace it. '
              : 'Paste it once; it is stored on the server. '}
            <a href={tokenPage(url)} target="_blank" rel="noreferrer">
              Get it here
            </a>
            {' (your profile, Security tab, "Create token").'}
          </span>
        </span>
        <input
          className="set-input hs-token"
          type="password"
          autoComplete="off"
          aria-label="Long-lived access token"
          placeholder={status.hasToken ? '••••••••••••••••' : 'eyJhbGciOi…'}
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </div>
      <div className="set-row hs-actions">
        <button
          type="button"
          className="set-btn"
          disabled={busy !== null || !url.trim()}
          onClick={() => void test()}
        >
          {busy === 'test' ? 'Testing…' : 'Test'}
        </button>
        <button
          type="button"
          className="set-btn primary"
          disabled={busy !== null || !dirty}
          onClick={() => void save()}
        >
          {busy === 'save' ? 'Saving…' : 'Save connection'}
        </button>
        {result && (
          <span className={`hs-result ${result.ok ? 'ok' : 'bad'}`} role="status">
            {result.message}
          </span>
        )}
      </div>
    </div>
  );
}
