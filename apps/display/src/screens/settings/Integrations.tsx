import type { IntegrationStatus, PluginManifest, SetupField } from '@mantel/shared';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { errorText, googleAuthorizeUrl, googleDisconnect, googleFinish } from './client';
import {
  CopyRow,
  Directions,
  Field,
  GetItHere,
  Result,
  SecretInput,
  Section,
  StatusBadge,
  TextInput,
  Toggle,
} from './controls';

type Outcome = { ok: boolean; message: string } | null;

const CATEGORY_LABEL: Record<PluginManifest['category'], string> = {
  calendar: 'Calendars',
  home: 'Home',
  media: 'Media',
  photos: 'Photos',
  tasks: 'Lists',
  weather: 'Weather',
  info: 'Information',
};

/** Pull a Google OAuth client id and secret out of the JSON the Cloud console downloads. */
export function parseGoogleClientJson(
  text: string,
): { clientId: string; clientSecret: string } | null {
  try {
    const json = JSON.parse(text) as Record<
      string,
      { client_id?: string; client_secret?: string } | undefined
    >;
    const inner = json.web ?? json.installed;
    if (inner?.client_id && inner.client_secret)
      return { clientId: inner.client_id, clientSecret: inner.client_secret };
  } catch {
    // not JSON
  }
  return null;
}

/** Why a value is not acceptable, written for a person; null when it is fine. */
export function problemWith(field: SetupField, value: string): string | null {
  if (!value) return null;
  if (field.pattern) {
    try {
      if (!new RegExp(field.pattern.regex).test(value)) return field.pattern.message;
    } catch {
      return null;
    }
  }
  if (field.type === 'url') {
    try {
      new URL(value);
    } catch {
      return 'This should be a full address, starting with http:// or https://.';
    }
  }
  if (field.type === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'This should be a number.';
    if (field.min !== undefined && n < field.min) return `At least ${field.min}.`;
    if (field.max !== undefined && n > field.max) return `At most ${field.max}.`;
  }
  return null;
}

/** "[text](url)" in a direction line becomes a link. */
export function renderMarkdownLinks(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <a key={m.index} href={m[2]} target="_blank" rel="noopener noreferrer">
        {m[1]}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));

/**
 * One integration, rendered from its plugin manifest: a state badge, the last error in plain
 * words, the setup fields with their Get-it-here links, Save, Test and the master switch.
 * Nothing here knows which integration it is showing; OAuth plugins get a Connect block.
 */
export function IntegrationCard({
  manifest,
  status,
  onStatus,
  advanced = false,
  open: initiallyOpen,
  extra,
}: {
  manifest: PluginManifest;
  status: IntegrationStatus | undefined;
  onStatus: (s: IntegrationStatus) => void;
  /** Show the fields marked advanced instead of the normal ones. */
  advanced?: boolean;
  /** Start with the form open (the wizard, or a Fix link). */
  open?: boolean;
  /** Anything the caller wants under the fields (the calendar picker, C's room picker). */
  extra?: ReactNode;
}) {
  const allFields = manifest.fields.filter((f) => f.advanced === advanced);
  const state = status?.state ?? 'not_set_up';
  const enabled = status?.enabled ?? true;
  const [open, setOpen] = useState(initiallyOpen ?? state !== 'connected');
  const [config, setConfig] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'save' | 'test' | 'toggle' | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  // Start the form from the stored (non-secret) values, or the manifest defaults.
  const storedConfig = JSON.stringify(status?.config ?? {});
  useEffect(() => {
    const stored = JSON.parse(storedConfig) as Record<string, unknown>;
    const next: Record<string, string> = {};
    for (const f of allFields) {
      const v = stored[f.key] ?? f.default;
      if (v !== undefined && v !== null) next[f.key] = String(v);
    }
    setConfig(next);
    setSecrets({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest.id, storedConfig]);

  const isSecret = (f: SetupField) => f.type === 'secret';
  const valueOf = (f: SetupField) => (isSecret(f) ? (secrets[f.key] ?? '') : (config[f.key] ?? ''));
  const hasValue = (f: SetupField) =>
    isSecret(f)
      ? Boolean(secrets[f.key]) || Boolean(status?.hasSecrets.includes(f.key))
      : Boolean(config[f.key]);
  // `dependsOn` hides a field until another has the right value.
  const shown = (f: SetupField) => {
    if (!f.dependsOn) return true;
    const other = allFields.find((x) => x.key === f.dependsOn!.key);
    const v = other ? valueOf(other) : str(status?.config[f.dependsOn.key]);
    return f.dependsOn.equals === undefined ? Boolean(v) : v === str(f.dependsOn.equals);
  };
  const fields = allFields.filter(shown);
  const editable = fields.filter((f) => !f.readOnly);

  const dirty = useMemo(
    () =>
      Object.values(secrets).some(Boolean) ||
      editable.some((f) => !isSecret(f) && (config[f.key] ?? '') !== str(status?.config[f.key])),
    [config, secrets, editable, status],
  );
  const missing = editable.filter((f) => f.required && !hasValue(f));
  const problems = new Map(
    editable.map((f) => [f.key, problemWith(f, valueOf(f))] as const).filter(([, p]) => p !== null),
  );

  const patch = () => {
    const patchConfig: Record<string, string | number | boolean | null> = {};
    for (const f of editable) {
      if (isSecret(f)) continue;
      const v = config[f.key] ?? '';
      if (v === str(status?.config[f.key])) continue;
      patchConfig[f.key] =
        v === '' ? null : f.type === 'number' ? Number(v) : f.type === 'toggle' ? v === 'true' : v;
    }
    const patchSecrets: Record<string, string> = {};
    for (const [k, v] of Object.entries(secrets)) if (v) patchSecrets[k] = v;
    return {
      ...(Object.keys(patchConfig).length ? { config: patchConfig } : {}),
      ...(Object.keys(patchSecrets).length ? { secrets: patchSecrets } : {}),
    };
  };

  const save = async () => {
    setBusy('save');
    setOutcome(null);
    try {
      const { integration } = await api.call('integrationPut', {
        params: { id: manifest.id },
        // Saving a field turns the integration on; the switch turns it off.
        body: { ...patch(), ...(status && !status.enabled ? { enabled: true } : {}) },
      });
      onStatus(integration);
      setSecrets({});
      setOutcome({ ok: !integration.lastError, message: integration.lastError ?? 'Saved.' });
    } catch (err) {
      setOutcome({ ok: false, message: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    setOutcome(null);
    try {
      // Unsaved values are tested as typed; saved ones otherwise.
      const body = dirty ? patch() : undefined;
      setOutcome(await api.call('integrationTest', { params: { id: manifest.id }, body }));
    } catch (err) {
      setOutcome({ ok: false, message: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (next: boolean) => {
    setBusy('toggle');
    try {
      const { integration } = await api.call('integrationPut', {
        params: { id: manifest.id },
        body: { enabled: next },
      });
      onStatus(integration);
      setOutcome({
        ok: true,
        message: next
          ? `${manifest.name} is on.`
          : `${manifest.name} is off. Its parts leave the display.`,
      });
    } catch (err) {
      setOutcome({ ok: false, message: errorText(err) });
    } finally {
      setBusy(null);
    }
  };

  /** A pasted or dropped Google client JSON fills both client fields wherever it lands. */
  const fillFromJson = (text: string) => {
    const parsed = parseGoogleClientJson(text);
    const idField = allFields.find((f) => /clientid/i.test(f.key));
    const secretField = allFields.find((f) => /clientsecret/i.test(f.key));
    if (!parsed || !idField || !secretField) return false;
    setConfig((c) => ({ ...c, [idField.key]: parsed.clientId }));
    setSecrets((s) => ({ ...s, [secretField.key]: parsed.clientSecret }));
    setOutcome({
      ok: true,
      message: 'Client ID and secret read from the downloaded file. Save to keep them.',
    });
    return true;
  };

  const showForm = open || state === 'error' || state === 'not_set_up';
  const nothingToSetUp = manifest.connect === 'none' || editable.length === 0;

  return (
    <article
      className={`set-int card inset state-${enabled ? state : 'disabled'}`}
      aria-label={manifest.name}
      data-plugin={manifest.id}
    >
      <header className="set-int-head">
        <div className="grow">
          <div className="set-int-title">
            <h3 className="h3">{manifest.name}</h3>
            <StatusBadge state={enabled ? state : 'disabled'} />
            <span className="set-hint set-int-cat">{CATEGORY_LABEL[manifest.category]}</span>
          </div>
          <p className="set-hint">{status?.summary || manifest.description}</p>
        </div>
        <div className="set-pair">
          {status && state !== 'not_set_up' && !nothingToSetUp && (
            <button
              type="button"
              className="set-btn quiet"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={showForm}
            >
              {showForm ? 'Hide' : 'Edit'}
            </button>
          )}
          {manifest.optional && (
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label={`${manifest.name} on`}
              disabled={!status || busy === 'toggle'}
              className={`sw${enabled ? ' on' : ''}`}
              onClick={() => void toggle(!enabled)}
            />
          )}
        </div>
      </header>

      {status?.lastError && (
        <p className="set-err" role="alert">
          {status.lastError}
          {!showForm && (
            <>
              {' '}
              <button type="button" className="set-linkbtn" onClick={() => setOpen(true)}>
                Fix
              </button>
            </>
          )}
        </p>
      )}

      {showForm && (
        <div className={`set-int-body${manifest.directions.length ? ' with-aside' : ''}`}>
          <div className="set-int-fields">
            {nothingToSetUp && fields.length === 0 && (
              <p className="set-hint">Nothing to set up. {manifest.description}</p>
            )}
            {fields.map((f) =>
              f.readOnly ? (
                <CopyRow
                  key={f.key}
                  label={f.help ? `${f.label}. ${f.help}` : f.label}
                  value={str(status?.config[f.key]) || '…'}
                />
              ) : (
                <FieldInput
                  key={f.key}
                  field={f}
                  value={valueOf(f)}
                  isSet={Boolean(status?.hasSecrets.includes(f.key))}
                  source={status?.sources[f.key]}
                  problem={problems.get(f.key) ?? null}
                  onChange={(v) => {
                    setOutcome(null);
                    if (isSecret(f)) setSecrets((s) => ({ ...s, [f.key]: v }));
                    else setConfig((c) => ({ ...c, [f.key]: v }));
                  }}
                  onPasteText={fillFromJson}
                />
              ),
            )}
            {manifest.connect === 'oauth' && status && (
              <OAuthBlock
                manifest={manifest}
                status={status}
                onStatus={onStatus}
                setOutcome={setOutcome}
                ready={missing.length === 0 && !dirty}
              />
            )}
            {!nothingToSetUp && (
              <div className="set-int-actions">
                <button
                  type="button"
                  className="set-btn primary"
                  disabled={!dirty || missing.length > 0 || problems.size > 0 || busy !== null}
                  onClick={() => void save()}
                >
                  {busy === 'save' ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  className="set-btn"
                  disabled={busy !== null || !status || missing.length > 0}
                  onClick={() => void test()}
                >
                  {busy === 'test' ? 'Testing…' : 'Test'}
                </button>
                {missing.length > 0 && (
                  <span className="set-hint">
                    Fill in {missing.map((f) => f.label).join(', ')} to save.
                  </span>
                )}
                {manifest.docs && (
                  <GetItHere
                    label="Guide"
                    url={`https://github.com/sorel123/mantel/blob/main/docs/${manifest.docs}`}
                  />
                )}
              </div>
            )}
            <Result result={outcome} />
            {extra}
          </div>
          {manifest.directions.length > 0 && (
            <Directions
              steps={manifest.directions.map((d) => ({ text: renderMarkdownLinks(d) }))}
            />
          )}
        </div>
      )}
    </article>
  );
}

function FieldInput({
  field: f,
  value,
  isSet,
  source,
  problem,
  onChange,
  onPasteText,
}: {
  field: SetupField;
  value: string;
  isSet: boolean;
  source?: 'store' | 'env';
  problem: string | null;
  onChange: (v: string) => void;
  onPasteText: (text: string) => boolean;
}) {
  const hint = (
    <>
      {f.help}
      {f.getItHere && (
        <>
          {f.help ? ' ' : ''}
          <GetItHere label={f.getItHere.label} url={f.getItHere.url} />
        </>
      )}
      {source === 'env' && f.env && <> · from the environment variable {f.env}</>}
      {problem && <span className="set-invalid"> {problem}</span>}
    </>
  );
  if (f.type === 'toggle')
    return (
      <Toggle
        label={f.label}
        hint={hint}
        checked={value === 'true'}
        onChange={(v) => onChange(String(v))}
      />
    );
  if (f.type === 'select')
    return (
      <Field label={f.label} hint={hint}>
        <select
          className="set-input"
          aria-label={f.label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Choose…</option>
          {(f.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
    );
  if (f.type === 'secret')
    return (
      <Field label={f.label} hint={hint} stack>
        <SecretInput
          label={f.label}
          isSet={isSet}
          value={value}
          onChange={onChange}
          placeholder={f.placeholder}
          onPasteText={onPasteText}
        />
      </Field>
    );
  if (f.type === 'file-json')
    return (
      <Field label={f.label} hint={hint} stack>
        <JsonDrop
          label={f.label}
          value={value}
          onChange={onChange}
          onPasteText={onPasteText}
          placeholder={f.placeholder}
        />
      </Field>
    );
  return (
    <Field label={f.label} hint={hint} stack>
      <TextInput
        label={f.label}
        value={value}
        placeholder={f.placeholder}
        type={f.type === 'url' ? 'url' : 'text'}
        inputMode={f.type === 'number' ? 'decimal' : f.type === 'url' ? 'url' : 'text'}
        onChange={onChange}
        onPasteText={onPasteText}
        className="grow"
      />
    </Field>
  );
}

/** A text box that also takes the downloaded JSON file dropped on it, picked, or pasted. */
function JsonDrop({
  label,
  value,
  onChange,
  onPasteText,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onPasteText: (text: string) => boolean;
  placeholder?: string;
}) {
  const [over, setOver] = useState(false);
  const take = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    if (!onPasteText(text)) onChange(text.trim());
  };
  return (
    <div
      className={`set-drop${over ? ' over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void take(e.dataTransfer.files[0]);
      }}
    >
      <TextInput
        label={label}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        onPasteText={onPasteText}
        className="grow"
      />
      <label className="set-btn sm" title="Or drop the downloaded .json file anywhere on this box">
        Use downloaded file
        <input
          type="file"
          accept="application/json,.json"
          hidden
          aria-label={`${label} from a file`}
          onChange={(e) => void take(e.target.files?.[0])}
        />
      </label>
    </div>
  );
}

/**
 * Sign in with Google (or any OAuth plugin): starts the consent flow and takes the paste-back
 * when the server has no https address. The redirect URI is one of the manifest's read-only
 * fields, so it already shows above with its Copy button.
 */
function OAuthBlock({
  manifest,
  status,
  onStatus,
  setOutcome,
  ready,
}: {
  manifest: PluginManifest;
  status: IntegrationStatus;
  onStatus: (s: IntegrationStatus) => void;
  setOutcome: (o: Outcome) => void;
  /** Client fields saved; the Connect button is useful. */
  ready: boolean;
}) {
  const [pasteUrl, setPasteUrl] = useState('');
  const [pasting, setPasting] = useState(false);
  const [busy, setBusy] = useState(false);
  const account = status.config.account ? String(status.config.account) : null;
  const connected = status.state === 'connected';

  const connect = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      const start = await googleAuthorizeUrl();
      if (start.pasteBack) {
        setPasting(true);
        window.open(start.url, '_blank', 'noopener');
      } else location.assign(start.url);
    } catch (err) {
      setOutcome({ ok: false, message: humanOAuthError(errorText(err)) });
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    try {
      await googleFinish(pasteUrl);
      setPasting(false);
      setPasteUrl('');
      onStatus({ ...status, state: 'connected', lastError: null, summary: 'Signed in. Syncing…' });
      setOutcome({
        ok: true,
        message: `${manifest.name} is connected. Your calendars appear below in a moment.`,
      });
    } catch (err) {
      setOutcome({ ok: false, message: humanOAuthError(errorText(err)) });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await googleDisconnect();
      onStatus({
        ...status,
        state: 'not_set_up',
        summary: 'Signed out.',
        config: { ...status.config, account: null },
      });
    } catch (err) {
      setOutcome({ ok: false, message: errorText(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="set-oauth">
      <div className="set-int-actions">
        <button
          type="button"
          className={`set-btn${connected ? '' : ' primary'}`}
          disabled={busy || !ready}
          onClick={() => void connect()}
        >
          {busy ? 'Opening…' : connected ? 'Sign in again' : `Connect ${manifest.name}`}
        </button>
        {connected && (
          <button
            type="button"
            className="set-btn quiet"
            disabled={busy}
            onClick={() => void disconnect()}
          >
            Disconnect
          </button>
        )}
        {account && <span className="set-hint">Signed in as {account}</span>}
        {!ready && <span className="set-hint">Save the client ID and secret first.</span>}
      </div>
      {pasting && (
        <div className="set-paste">
          <p className="set-hint">
            After you press Allow, Google sends the browser to a <code>localhost</code> address that
            will not load from this computer. That is expected: copy the whole address from the
            browser bar and paste it here.
          </p>
          <span className="set-pair grow">
            <TextInput
              label="Address from the browser bar"
              className="grow"
              value={pasteUrl}
              placeholder="http://localhost:8787/api/calendar/google/callback?code=…"
              onChange={setPasteUrl}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pasteUrl) void finish();
              }}
            />
            <button
              type="button"
              className="set-btn primary"
              disabled={!pasteUrl || busy}
              onClick={() => void finish()}
            >
              Finish
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

/** Google's error strings, rewritten for a person. */
export function humanOAuthError(message: string): string {
  if (/redirect_uri_mismatch/i.test(message))
    return 'Google says this redirect URI is not on the client. Copy it again from above and add it under Authorised redirect URIs, then try again.';
  if (/invalid_client/i.test(message))
    return 'Google does not recognise the client ID or secret. Check both against the Cloud console.';
  if (/access_denied/i.test(message))
    return 'The sign-in was cancelled. Try again and press Allow.';
  if (/invalid_grant|expired/i.test(message))
    return 'That sign-in link has expired. Press Connect again for a fresh one.';
  if (/no code/i.test(message))
    return 'That address has no code in it. Copy the whole address from the browser bar after you press Allow.';
  if (/GOOGLE_CLIENT_ID/i.test(message)) return 'Save the client ID and secret first.';
  return message;
}

/** The Integrations section: every plugin as a card. */
export function IntegrationsSection({
  plugins,
  statuses,
  onStatus,
  exclude = [],
}: {
  plugins: PluginManifest[];
  statuses: Record<string, IntegrationStatus>;
  onStatus: (s: IntegrationStatus) => void;
  /** Plugins that have their own section (calendars, Home Assistant). */
  exclude?: string[];
}) {
  const shown = plugins.filter((p) => !exclude.includes(p.id));
  return (
    <Section
      id="integrations"
      title="Integrations"
      hint="Each service the wall uses. Turn one off and its parts leave the display; nothing needs a restart. Calendars and Home Assistant have their own pages."
    >
      {shown.length === 0 && (
        <p className="set-hint">The server has not reported its integrations yet.</p>
      )}
      <div className="set-int-grid">
        {shown.map((p) => (
          <IntegrationCard
            key={p.id}
            manifest={p}
            status={statuses[p.id]}
            onStatus={onStatus}
            open={false}
          />
        ))}
      </div>
    </Section>
  );
}

/** Fields every plugin marked advanced, in one place with the source of each value. */
export function AdvancedSection({
  plugins,
  statuses,
  onStatus,
}: {
  plugins: PluginManifest[];
  statuses: Record<string, IntegrationStatus>;
  onStatus: (s: IntegrationStatus) => void;
}) {
  const withAdvanced = plugins.filter((p) => p.fields.some((f) => f.advanced));
  return (
    <Section
      id="advanced"
      title="Advanced"
      hint="Intervals, limits and the environment overrides. Values from an environment variable say so; a saved value wins over it."
    >
      {withAdvanced.length === 0 && <p className="set-hint">Nothing advanced to set.</p>}
      <div className="set-int-grid">
        {withAdvanced.map((p) => (
          <IntegrationCard
            key={p.id}
            manifest={p}
            status={statuses[p.id]}
            onStatus={onStatus}
            advanced
            open
          />
        ))}
      </div>
    </Section>
  );
}
