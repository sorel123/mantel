/**
 * Settings, Siri and assistants (v4 O): API tokens, "say it" (natural add) with a live test, the
 * default list, and the copy-and-build guides for Siri Shortcuts, Alexa, Home Assistant and
 * Claude. Every snippet is filled in with this household's address and the token just made.
 * Mounted by `../Optional.tsx`.
 */
import {
  DEFAULT_OPEN_SETTINGS,
  TOKEN_PRESETS,
  TOKEN_SCOPE_LABELS,
  TOKEN_SCOPES,
  type ApiToken,
  type List,
  type OpenSettings,
  type SayResponse,
  type Settings,
  type TokenScope,
} from '@mantel/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { errorText } from '../client';
import {
  Chips,
  Collapse,
  CopyButton,
  CopyRow,
  Field,
  GetItHere,
  Result,
  Section,
  StatusBadge,
  TextInput,
  Toggle,
} from '../controls';
import {
  TOKEN_PLACEHOLDER,
  alexaEndpoint,
  alexaModel,
  assistSentences,
  claudeCommands,
  homeAssistantYaml,
  shortcutRecipes,
} from './snippets';
import './open.css';

const when = (iso: string | null) => {
  if (!iso) return 'never used';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 2) return 'used just now';
  if (mins < 60) return `used ${mins} min ago`;
  if (mins < 48 * 60) return `used ${Math.round(mins / 60)} h ago`;
  return `used ${new Date(iso).toLocaleDateString()}`;
};

/** A block of text to paste somewhere else, with its Copy button. */
function Snippet({ label, text }: { label: string; text: string }) {
  return (
    <div className="open-snippet">
      <div className="open-snippet-head">
        <span className="set-hint">{label}</span>
        <CopyButton text={text} />
      </div>
      <pre className="set-log" tabIndex={0} aria-label={label}>
        {text}
      </pre>
    </div>
  );
}

function TokenRow({ t, onRevoke }: { t: ApiToken; onRevoke: (t: ApiToken) => void }) {
  return (
    <li className={`set-row open-token${t.revokedAt ? ' revoked' : ''}`}>
      <div className="grow">
        <b>{t.name}</b>
        <span className="set-hint">
          <code>{t.prefix}…</code> · {t.scopes.map((s) => TOKEN_SCOPE_LABELS[s].label).join(', ')} ·{' '}
          {t.revokedAt ? 'revoked' : when(t.lastUsedAt)}
        </span>
      </div>
      {!t.revokedAt && (
        <button
          type="button"
          className="set-btn quiet"
          aria-label={`Revoke ${t.name}`}
          onClick={() => onRevoke(t)}
        >
          Revoke
        </button>
      )}
    </li>
  );
}

export function OpenSection({
  draft,
  set,
}: {
  draft: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  const value: OpenSettings = draft.open ?? DEFAULT_OPEN_SETTINGS;
  const change = (patch: Partial<OpenSettings>) => set('open', { ...value, ...patch });
  const base = location.origin;
  const https = location.protocol === 'https:';

  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [lists, setLists] = useState<List[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [t, l] = await Promise.all([api.call('openTokens'), api.call('lists')]);
      setTokens(t.tokens);
      setLists(l.lists);
    } catch (err) {
      setError(errorText(err));
      setTokens([]);
    }
  }, []);
  useEffect(() => void load(), [load]);

  /* ---- making a token ---- */
  const [making, setMaking] = useState(false);
  const [name, setName] = useState('Siri');
  const [scopes, setScopes] = useState<TokenScope[]>(['read', 'capture']);
  const [pin, setPin] = useState('');
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);
  const [made, setMade] = useState<{ ok: boolean; message: string } | null>(null);
  const preset = (id: string) => {
    const p = TOKEN_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setName(p.name);
    setScopes(p.scopes);
    setMaking(true);
  };
  const create = async () => {
    setMade(null);
    try {
      const r = await api.call('openTokenCreate', { body: { name: name.trim(), scopes, pin } });
      setSecret({ name: r.token.name, value: r.secret });
      setTokens((all) => [r.token, ...(all ?? [])]);
      setMaking(false);
      setPin('');
    } catch (err) {
      setMade({ ok: false, message: errorText(err) });
    }
  };
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const [revokePin, setRevokePin] = useState('');
  const [revoked, setRevoked] = useState<{ ok: boolean; message: string } | null>(null);
  const revoke = async () => {
    if (!revoking) return;
    try {
      await api.call('openTokenRevoke', { params: { id: revoking.id }, body: { pin: revokePin } });
      setRevoked({ ok: true, message: `${revoking.name} can no longer reach Mantel.` });
      setRevoking(null);
      setRevokePin('');
      await load();
    } catch (err) {
      setRevoked({ ok: false, message: errorText(err) });
    }
  };
  const token = secret?.value ?? TOKEN_PLACEHOLDER;

  /* ---- trying a phrase ---- */
  const [phrase, setPhrase] = useState('milk and eggs');
  const [tried, setTried] = useState<SayResponse | null>(null);
  const [trying, setTrying] = useState(false);
  const [sayError, setSayError] = useState<string | null>(null);
  const tryPhrase = async (dryRun: boolean) => {
    setTrying(true);
    setSayError(null);
    try {
      setTried(await api.call('say', { body: { text: phrase, dryRun, source: 'text' } }));
    } catch (err) {
      setSayError(errorText(err));
    } finally {
      setTrying(false);
    }
  };

  const live = (tokens ?? []).filter((t) => !t.revokedAt);
  const claude = claudeCommands(base, token);

  return (
    <Section
      id="open"
      title="Siri and assistants"
      hint="Add to Mantel by voice from Siri, Alexa or Home Assistant, let Claude read and add to the family calendar, and give other apps a key of their own."
    >
      {/* ---------- tokens ---------- */}
      <h3 className="h3">Tokens</h3>
      <p className="set-hint">
        Each assistant or app gets its own token, and only the parts of Mantel it needs. A token is
        shown once; revoke it here and it stops at once. Displays and phones keep their own pairing.
      </p>
      <div className="open-presets" role="group" aria-label="Make a token for">
        {TOKEN_PRESETS.map((p) => (
          <button key={p.id} type="button" className="set-btn" onClick={() => preset(p.id)}>
            New token for {p.name}
          </button>
        ))}
        <button
          type="button"
          className="set-btn quiet"
          onClick={() => {
            setName('');
            setScopes(['read']);
            setMaking(true);
          }}
        >
          Custom…
        </button>
      </div>

      {making && (
        <div className="open-make card" role="group" aria-label="New token">
          <Field label="Name" hint="Where it will be used.">
            <TextInput label="Token name" value={name} onChange={setName} maxLength={60} />
          </Field>
          <div className="set-sub">
            <div className="set-label">
              What it may do
              <span className="set-hint">
                {scopes.map((s) => TOKEN_SCOPE_LABELS[s].hint).join(' ')}
              </span>
            </div>
            <Chips
              label="Scopes"
              options={TOKEN_SCOPES.map((s) => ({ value: s, text: TOKEN_SCOPE_LABELS[s].label }))}
              selected={scopes}
              onChange={setScopes}
            />
          </div>
          <Field label="Admin PIN" hint="Tokens are made behind the PIN.">
            <TextInput
              label="Admin PIN"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={setPin}
              maxLength={12}
            />
          </Field>
          <div className="set-pair">
            <button
              type="button"
              className="set-btn primary"
              disabled={!name.trim() || scopes.length === 0}
              onClick={() => void create()}
            >
              Make token
            </button>
            <button type="button" className="set-btn quiet" onClick={() => setMaking(false)}>
              Cancel
            </button>
          </div>
          <Result result={made} />
        </div>
      )}

      {secret && (
        <div className="open-secret" role="status">
          <p>
            <b>{secret.name}</b>: copy this token now. It is not shown again. The guides below
            already have it filled in.
          </p>
          <CopyRow label="Token" value={secret.value} />
        </div>
      )}

      {tokens === null ? (
        <ul className="set-list open-skeleton" aria-label="Loading tokens">
          <li className="set-row skeleton" />
          <li className="set-row skeleton" />
        </ul>
      ) : tokens.length === 0 ? (
        <p className="set-hint open-empty">
          {error ?? 'No tokens yet. Make one for Siri, Home Assistant or Claude above.'}
        </p>
      ) : (
        <ul className="set-list" aria-label="Tokens">
          {tokens.map((t) => (
            <TokenRow
              key={t.id}
              t={t}
              onRevoke={(x) => {
                setRevoked(null);
                setRevoking(x);
              }}
            />
          ))}
        </ul>
      )}
      {revoking && (
        <div className="open-make card" role="group" aria-label={`Revoke ${revoking.name}`}>
          <Field label={`Revoke ${revoking.name}?`} hint="Anything using it stops at once.">
            <TextInput
              label="Admin PIN"
              type="password"
              inputMode="numeric"
              value={revokePin}
              onChange={setRevokePin}
              maxLength={12}
            />
          </Field>
          <div className="set-pair">
            <button type="button" className="set-btn danger" onClick={() => void revoke()}>
              Revoke
            </button>
            <button type="button" className="set-btn quiet" onClick={() => setRevoking(null)}>
              Keep it
            </button>
          </div>
        </div>
      )}
      <Result result={revoked} />

      {/* ---------- say it ---------- */}
      <h3 className="h3">Say it</h3>
      <p className="set-hint">
        Everything below sends a phrase to Mantel, which works out what it means: "milk and eggs"
        goes on the list, "dentist Tuesday at 3" on the calendar, "tacos Thursday" on the meal plan,
        "note: back at 5" on the wall. It works with no Claude key; with one saved in{' '}
        <a className="set-link" href="#quips">
          Weather quips
        </a>
        , Claude reads the phrases the rules are unsure about.
      </p>
      <div className="open-try">
        <TextInput
          label="Try a phrase"
          value={phrase}
          onChange={setPhrase}
          maxLength={300}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void tryPhrase(true);
          }}
        />
        <button
          type="button"
          className="set-btn"
          disabled={!phrase.trim() || trying}
          onClick={() => void tryPhrase(true)}
        >
          Test
        </button>
        <button
          type="button"
          className="set-btn primary"
          disabled={!phrase.trim() || trying}
          onClick={() => void tryPhrase(false)}
        >
          Add it
        </button>
      </div>
      {tried && (
        <p className={`set-result ${tried.ok ? 'ok' : 'bad'} open-said`} role="status">
          “{tried.speech}”
          <span className="set-hint">
            {' '}
            {tried.action.kind === 'items'
              ? 'List items'
              : tried.action.kind === 'event'
                ? 'Calendar event'
                : tried.action.kind === 'meal'
                  ? 'Meal plan'
                  : tried.action.kind === 'note'
                    ? 'Wall note'
                    : 'Nothing'}
            {' · read by '}
            {tried.parser === 'claude' ? 'Claude' : 'Mantel'}
          </span>
        </p>
      )}
      <Result result={sayError ? { ok: false, message: sayError } : null} />
      <Field label="Plain items go to" hint="When no list is named: 'milk and eggs'.">
        <select
          className="set-input"
          aria-label="Default list"
          value={value.defaultListId ?? ''}
          onChange={(e) => change({ defaultListId: e.target.value || null })}
        >
          <option value="">Grocery (automatic)</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </Field>
      <Toggle
        label="Let Claude help"
        hint="With a Claude key, long or unclear phrases go to Claude to read. Off: Mantel's own rules only, nothing leaves the house."
        checked={value.claudeParsing}
        onChange={(claudeParsing) => change({ claudeParsing })}
      />

      {/* ---------- Siri ---------- */}
      <h3 className="h3" id="open-siri">
        Siri and Shortcuts
      </h3>
      <p className="set-note">
        <b>Calendar events need no setup.</b> If you say "Hey Siri, add dentist Tuesday at 3" and
        Siri puts it on an iCloud or Google calendar Mantel already shows, it appears on the wall on
        its own. The shortcuts below are for lists, meals, notes and hearing the day.
      </p>
      {!https && (
        <p className="set-hint">
          Shortcuts reach Mantel at <code>{base}</code> while the phone is on the home Wi-Fi. Away
          from home it needs an address that works from outside, such as a Tailscale or Nabu Casa
          link.
        </p>
      )}
      {shortcutRecipes(base, token).map((r) => (
        <Collapse key={r.id} title={r.title} hint={`${r.phrase}. ${r.summary}`}>
          <ol className="set-steps">
            {r.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          {r.fields.map((f) => (
            <CopyRow key={f.label} label={f.label} value={f.value} />
          ))}
        </Collapse>
      ))}

      {/* ---------- Alexa ---------- */}
      <h3 className="h3" id="open-alexa">
        Alexa
      </h3>
      <p className="set-hint">
        Amazon stopped letting other apps read or write Alexa's shopping list in July 2024, so
        "Alexa, add milk to my shopping list" stays inside Amazon. Two things work today:
      </p>
      <Collapse
        title="Calendar: link your calendar in the Alexa app"
        hint="Nothing to build. Events Alexa adds show on the wall."
      >
        <ol className="set-steps">
          <li>
            In the Alexa app, open <b>More › Settings › Calendar</b> and add the iCloud, Google or
            Microsoft calendar Mantel shows.
          </li>
          <li>
            Set it as the calendar new events go to. Now "Alexa, add swim lessons Saturday at 10"
            lands on the wall within a minute or two.
          </li>
        </ol>
      </Collapse>
      <Collapse
        title={'Lists, meals and notes: "Alexa, ask Mantel to add milk"'}
        hint="A private Alexa skill that talks to Mantel. About 10 minutes, free, no AWS account."
      >
        <ol className="set-steps">
          <li>
            Mantel must be reachable over <b>https</b> from the internet (Nabu Casa, a Cloudflare
            tunnel or Tailscale Funnel). Use that address below in place of <code>{base}</code> if
            it differs.
          </li>
          <li>
            Sign in at the Alexa developer console with the same Amazon account as your Echo, and
            create a skill: Custom model, <b>Provision your own</b> backend, start from scratch.
          </li>
          <li>
            Under <b>Interaction Model › JSON Editor</b>, paste the model below and Save, then
            Build.
          </li>
          <li>
            Under <b>Endpoint</b>, choose HTTPS, paste the endpoint below as the Default Region and
            pick "My development endpoint has a certificate from a trusted certificate authority".
          </li>
          <li>
            Under <b>Test</b>, set testing to Development. Every Echo on your account can now use
            it. Say "Alexa, ask Mantel to add milk and eggs" or "Alexa, ask Mantel what's on today".
          </li>
        </ol>
        <GetItHere
          label="Alexa developer console"
          url="https://developer.amazon.com/alexa/console/ask"
        />
        <CopyRow label="Endpoint" value={alexaEndpoint(base, token)} />
        <Snippet label="Interaction model (JSON Editor)" text={alexaModel()} />
      </Collapse>

      {/* ---------- Home Assistant ---------- */}
      <h3 className="h3" id="open-homeassistant">
        Home Assistant
      </h3>
      <Collapse
        title="Mantel in Home Assistant"
        hint="Sensors (dinner tonight, next event, chores, stars, grocery count), a calendar per Mantel calendar, events when chores are done, and mantel.say."
      >
        <ol className="set-steps">
          <li>
            In Home Assistant open <b>HACS</b> (the Marketplace), add the custom repository{' '}
            <code>https://github.com/sorel123/mantel</code> as an Integration, and install Mantel.
            Restart Home Assistant.
          </li>
          <li>
            <b>Settings › Devices and services › Add integration › Mantel.</b> Paste the address and
            a token made for Home Assistant.
          </li>
        </ol>
        <CopyRow label="Mantel address" value={base} />
        <CopyRow label="Token" value={token} />
      </Collapse>
      <Collapse
        title="Assist and automations"
        hint={
          '"Add milk to Mantel" through Home Assistant Assist, or any automation, with no integration needed.'
        }
      >
        <Snippet label="configuration.yaml" text={homeAssistantYaml(base, token)} />
        <Snippet label="custom_sentences/en/mantel.yaml" text={assistSentences()} />
        <p className="set-hint">
          Restart Home Assistant, then say or type "add milk and eggs to Mantel" in Assist. Alexa
          routines can also run a Home Assistant script that calls{' '}
          <code>rest_command.mantel_say</code> with a fixed phrase ("Alexa, we're out of milk").
        </p>
      </Collapse>

      {/* ---------- Claude ---------- */}
      <h3 className="h3" id="open-claude">
        Claude
      </h3>
      <Collapse
        title="Let Claude read and add to the family wall"
        hint="Mantel speaks MCP: Claude can check the agenda, lists, meals and chores, and add events, items, meals and notes."
      >
        <CopyRow label="MCP address" value={claude.url} />
        <CopyRow label="Header" value={claude.header} />
        <Snippet label="Claude Code" text={claude.claudeCode} />
        <Snippet label="Claude Desktop (claude_desktop_config.json)" text={claude.desktopJson} />
        <p className="set-hint">
          Claude on the web and phone adds custom connectors by address, which needs Mantel on an
          https address reachable from the internet. Give Claude a token with only what it should
          do.
        </p>
      </Collapse>

      <div className="set-row">
        <div className="grow">
          <span className="set-hint">
            {live.length} token{live.length === 1 ? '' : 's'} in use
          </span>
        </div>
        <StatusBadge
          state={live.length ? 'connected' : 'not_set_up'}
          text={live.length ? 'Open' : 'No tokens yet'}
        />
      </div>
    </Section>
  );
}
